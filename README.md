# Business.oi

Global business listing + competitive ranking platform. Next.js 15 (App Router) · TypeScript · Tailwind · PostgreSQL · Stripe Checkout.

**Status: working MVP, Stripe TEST MODE only.** See `docs/STATUS.md` for exactly what is built, tested, and not yet done.

## Run locally

```bash
cp .env.example .env            # fill in DATABASE_URL and Stripe TEST keys
npm install
npm run db:migrate              # applies db/migrations/*.sql
npm run db:seed                 # 250 countries, 20 categories, first admin from SEED_ADMIN_*
npm run dev                     # http://localhost:3000

# in another terminal, forward Stripe test webhooks:
stripe listen --forward-to localhost:3000/api/webhooks/stripe   # copy the whsec_... into STRIPE_WEBHOOK_SECRET
```

## Tests

Tests run against a **real PostgreSQL** (they drop and recreate the `public` schema, so point them at a throwaway DB).

```bash
# vitest.config.ts sets DATABASE_URL=postgres://bizoi:bizoi@localhost:5432/bizoi_test
createdb bizoi_test
npm test            # 66 tests
npm run typecheck
npm run build
```

## Layout

```
db/migrations/        SQL schema (ledger + audit log are append-only via triggers)
scripts/              migrate, seed
src/lib/services/     ranking, checkout, settlement, refunds, webhook, business, moderation, search, stats
src/lib/payments/     gateway interface + Stripe implementation
src/lib/actions/      server actions (thin: auth → validate → service)
src/app/              pages and route handlers (webhook, ranking API, invoices, CSV)
tests/                vitest suites (bidding, payments, search, security, webhook route)
docs/                 architecture, deployment, Search Console, status
```

## Safety switches

* A `sk_live_` key is refused unless `ALLOW_LIVE_PAYMENTS=true`. Leave it unset until legal review, merchant verification and full testing are complete.
* Payments only become "paid", and bids only become active, from a signature-verified Stripe webhook, never from the browser redirect.
