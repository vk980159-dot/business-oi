-- Business.oi initial schema. Money is always integer cents.
create extension if not exists citext;

-- ───────────── users & sessions ─────────────
create type user_role as enum ('user', 'support', 'admin');
create type user_status as enum ('active', 'suspended');

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text,                       -- null reserved for OAuth-only accounts
  name text not null,
  role user_role not null default 'user',
  status user_status not null default 'active',
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,          -- sha256 of the cookie token; raw token is never stored
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

-- ───────────── catalog ─────────────
create table countries (
  code char(2) primary key,
  name text not null,
  active boolean not null default true
);

create table categories (
  id serial primary key,
  slug text not null unique,
  name text not null,
  active boolean not null default true
);

-- ───────────── businesses ─────────────
create type business_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'suspended');
create type verification_status as enum ('unverified', 'pending', 'verified');

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  slug text not null unique,
  name text not null,
  category_id int not null references categories(id),
  country_code char(2) not null references countries(code),
  city text not null,
  address text not null,
  phone text not null,                      -- E.164
  email citext not null,
  website text,
  description text not null,
  services text[] not null default '{}',
  keywords text[] not null default '{}',
  logo_url text,
  image_urls text[] not null default '{}',
  opening_hours jsonb not null default '{}',
  social_links jsonb not null default '{}',
  timezone text not null default 'UTC',
  status business_status not null default 'draft',
  status_note text,
  verification_status verification_status not null default 'unverified',
  verified_at timestamptz,
  verified_by uuid references users(id),
  approved_at timestamptz,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_owner_idx on businesses(owner_id);
create index businesses_search_idx on businesses using gin(search_vector);
create index businesses_filter_idx on businesses(status, country_code, category_id);

create function businesses_search_vector() returns trigger language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(new.services, ' ') || ' ' || array_to_string(new.keywords, ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.city, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(new.description, '')), 'D');
  return new;
end $$;
create trigger businesses_search_vector_trg before insert or update on businesses
  for each row execute function businesses_search_vector();

-- ───────────── payments ─────────────
create type payment_kind as enum ('listing', 'bid');
create type payment_status as enum
  ('pending', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded', 'disputed');

create sequence invoice_seq;

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  business_id uuid not null references businesses(id),
  kind payment_kind not null,
  amount_cents integer not null check (amount_cents > 0),
  currency char(3) not null default 'usd',
  status payment_status not null default 'pending',
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  checkout_url text,
  expires_at timestamptz,
  terms_accepted_at timestamptz,
  paid_at timestamptz,
  failure_reason text,
  refunded_cents integer not null default 0,
  invoice_number text unique,
  created_at timestamptz not null default now(),
  check (refunded_cents >= 0 and refunded_cents <= amount_cents)
);
create index payments_business_idx on payments(business_id);
create index payments_user_idx on payments(user_id);
-- Duplicate-payment protection: one open listing checkout, and one live paid listing fee, per business.
create unique index payments_one_open_listing on payments(business_id) where kind = 'listing' and status = 'pending';
create unique index payments_one_paid_listing on payments(business_id)
  where kind = 'listing' and status in ('paid', 'partially_refunded', 'disputed');

-- ───────────── bids ─────────────
create type bid_status as enum ('pending_payment', 'active', 'rejected', 'void');

create table bids (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  payment_id uuid not null unique references payments(id),
  amount_cents integer not null check (amount_cents > 0),
  status bid_status not null default 'pending_payment',
  reject_reason text,
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index bids_business_idx on bids(business_id);
create index bids_active_idx on bids(amount_cents desc, activated_at) where status = 'active';
create unique index bids_one_open_per_business on bids(business_id) where status = 'pending_payment';

-- Live standings. Only approved businesses; only unexpired active bids count.
-- Order: highest bid, then earliest activation of that bid, then earliest approval, then id.
create view business_standings as
with current_bid as (
  select distinct on (business_id) business_id, amount_cents, activated_at
  from bids
  where status = 'active' and expires_at > now()
  order by business_id, amount_cents desc, activated_at asc
)
select
  b.id as business_id,
  coalesce(cb.amount_cents, 0) as bid_cents,
  cb.activated_at as bid_activated_at,
  row_number() over (
    order by coalesce(cb.amount_cents, 0) desc, cb.activated_at asc nulls last, b.approved_at asc nulls last, b.id asc
  )::int as rank
from businesses b
left join current_bid cb on cb.business_id = b.id
where b.status = 'approved';

-- ───────────── ledger, refunds, webhooks ─────────────
create type ledger_type as enum ('charge', 'refund', 'dispute_opened', 'dispute_won', 'dispute_lost');

create table ledger_entries (
  id bigserial primary key,
  payment_id uuid not null references payments(id),
  business_id uuid not null references businesses(id),
  user_id uuid not null references users(id),
  entry_type ledger_type not null,
  amount_cents integer not null,            -- signed: charge > 0, refund / dispute_opened < 0
  currency char(3) not null,
  ref text,                                 -- provider id (payment intent, refund, dispute)
  note text,
  created_at timestamptz not null default now()
);
create unique index ledger_type_ref_uniq on ledger_entries(entry_type, ref) where ref is not null;
create index ledger_payment_idx on ledger_entries(payment_id);

create type refund_status as enum ('pending', 'succeeded', 'failed');

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  status refund_status not null default 'pending',
  automatic boolean not null default false,
  stripe_refund_id text unique,
  failure_reason text,
  requested_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_payment_idx on refunds(payment_id);

create table stripe_events (
  id text primary key,                      -- Stripe event id: webhook idempotency key
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ───────────── config, audit, misc ─────────────
create table settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id bigserial primary key,
  actor_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  meta jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_logs(created_at desc);

-- Ledger and audit log are append-only, enforced by the database, not by application code.
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (% not allowed)', tg_table_name, tg_op;
end $$;
create trigger ledger_append_only before update or delete on ledger_entries
  for each row execute function forbid_mutation();
create trigger audit_append_only before update or delete on audit_logs
  for each row execute function forbid_mutation();

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create type review_status as enum ('pending', 'published', 'hidden');
create table reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id),
  rating int not null check (rating between 1 and 5),
  body text not null,
  status review_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

-- ───────────── default settings (all admin-configurable) ─────────────
insert into settings(key, value) values
  ('listing_fee_cents',     '2500'),
  ('starting_bid_cents',    '300'),
  ('min_increment_cents',   '300'),
  ('max_bid_cents',         '10000000'),
  ('bid_duration_days',     '30'),
  ('checkout_hold_minutes', '30'),
  ('currency',              '"usd"'),
  ('refund_policy',         '"DRAFT: Listing fees are refundable only if the listing is rejected. Ranking bids are refunded automatically if the bid cannot be placed (for example, you were outbid while paying). Otherwise ranking bids are non-refundable once active. Replace with reviewed policy before launch."');
