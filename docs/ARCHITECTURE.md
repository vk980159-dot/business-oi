# Architecture

## Request flow
Browser → Next.js server components / server actions → `src/lib/services/*` → PostgreSQL. Stripe talks to `/api/webhooks/stripe`.
Server actions are thin wrappers: authenticate → permission check → zod validation → service call. Services re-check permissions (`assertCan`) so authorization never lives only in the UI.

## Data model (db/migrations/001_init.sql)
`users, sessions` · `countries, categories` · `businesses` (status: draft → pending_approval → approved | rejected | suspended; separate `verification_status`) ·
`payments` (kind: listing | bid) · `bids` · `ledger_entries` (append-only) · `refunds` · `stripe_events` (webhook idempotency) · `settings` (admin config) · `audit_logs` (append-only) · `rate_limits` · `reviews`.
View `business_standings` computes the live ladder.

## Bid payment model (decisions to confirm)
1. **Each bid is its own payment of the full bid amount** through Stripe Checkout. It is not a card hold and not an incremental top-up.
2. Creating a checkout makes a `pending_payment` bid. **It has no effect on rankings.**
3. On the verified `checkout.session.completed` webhook, one transaction: locks the payment row → verifies amount/currency → records the charge in the ledger → takes a global advisory lock → re-validates the bid against the *current* top (must be ≥ highest + increment, business approved, not already #1) → activates it or rejects it.
4. A paid bid that fails re-validation (someone else's bid landed first) is **automatically refunded in full**; the refund is sent to Stripe after the transaction commits.
5. Active bids expire after `bid_duration_days`; expiry is evaluated at query time, so no cron is required for correctness.
6. Ladder order: highest active bid → earliest activation of that bid → earliest approval → id. The ladder is a single global ladder.

## Concurrency and idempotency
* `pg_advisory_xact_lock` serialises all bid activations (tested with 8 simultaneous identical bids: exactly one wins).
* `stripe_events.id` primary key: duplicate/concurrent deliveries of one event are no-ops; a failure rolls back the event row so Stripe's retry reprocesses it.
* Partial unique indexes: one open listing checkout per business, one live paid listing fee per business, one open bid checkout per business.
* Stripe idempotency keys (`checkout:<paymentId>`, `refund:<refundId>`) protect against network retries.

## Money integrity
* Integer cents everywhere. `ledger_entries` is append-only (DB trigger); refunds/disputes are negative entries; revenue reports are derived from it.
* Amount and currency reported by Stripe must equal what was created, else the payment is flagged `failed` with `amount_mismatch` and an audit entry, and nothing is granted.
* Refunds made in the Stripe dashboard are reconciled from `charge.refunded` without double counting in-flight refunds.

## Security
bcrypt (cost 12) password hashes; random session tokens stored only as SHA-256; httpOnly + SameSite=Lax cookies (Secure in production); server actions are Origin-checked by Next.js (CSRF); zod validation on every form; parameterised SQL everywhere; React output escaping plus escaped JSON-LD; Postgres-backed rate limits; RBAC (`user`, `support`, `admin`) enforced in services; unauthorised admin routes return 404; security headers in `next.config.mjs`; no card data ever touches the server.
