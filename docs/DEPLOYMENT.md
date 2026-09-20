# Deployment

## Requirements
Node 20+, PostgreSQL 13+ (needs `citext`; `gen_random_uuid()` is built in), a Stripe account, HTTPS hosting (Vercel, Fly.io, Render, AWS…). Because the bid-activation lock is in Postgres, you can run several app instances safely.

## Environment variables
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Add `DATABASE_SSL=true` for hosts that require TLS. |
| `APP_URL` | Public origin, e.g. `https://business.oi`. Used for canonical URLs, sitemap, Stripe return URLs. |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Test keys until go-live. |
| `ALLOW_LIVE_PAYMENTS` | Must be `true` before a `sk_live_` key is accepted. |
| `SUPPORT_EMAIL`, `SELLER_LEGAL_NAME`, `SELLER_ADDRESS` | Shown on legal pages and invoices. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First admin, used by `npm run db:seed` only (12+ chars). |

## Steps
1. Provision Postgres; set env vars; `npm run db:migrate && npm run db:seed`.
2. `npm run build && npm start` (or deploy to your platform).
3. Stripe Dashboard → Developers → Webhooks → add `https://<APP_URL>/api/webhooks/stripe` and subscribe to:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Test with card `4242 4242 4242 4242`. Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
5. The app relies on `X-Forwarded-For` for rate limiting; deploy behind a proxy that sets it.

## Before going live (do not skip)
* Legal review of Terms, Privacy, Refund, Bidding and Verification pages (currently drafts) and of the pay-to-rank model in each target market, including consumer-protection and tax rules.
* Stripe account fully verified; decide tax handling (invoices currently show no tax).
* Add: password reset + email verification, admin 2FA, transactional email, a CSP, error monitoring, database backups.
* Full test-mode run through every flow in a browser, on mobile.
* Only then set a live key **and** `ALLOW_LIVE_PAYMENTS=true`.
