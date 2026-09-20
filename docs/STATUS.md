# Status: what is built, tested, and not done

Legend: **Tested** = automated test against real PostgreSQL. **Smoke** = checked over HTTP against a production build. **Unverified** = code exists, not exercised.

## Built and tested
| Area | Evidence |
|---|---|
| Schema, append-only ledger + audit log | Tested (DB rejects UPDATE/DELETE) |
| Bid rules ($3 start, +$3 increment, spec A/B example, next-minimum, expiry, self-outbid block, suspended/unapproved can't bid) | Tested |
| Concurrent bids (8 simultaneous $3 → exactly 1 active, 7 auto-refunds queued; racing ladders stay valid) | Tested |
| Listing payment flow ($25 → pending_approval → approved, invoice number, terms acceptance, no double checkout) | Tested |
| Webhook signature verification (missing / wrong secret / tampered / stale timestamp), replay + 5× concurrent duplicate delivery, 500-then-retry | Tested; signature and replay also Smoke on a live server |
| Amount-mismatch protection | Tested |
| Refunds (full, partial, over-refund blocked, provider failure + retry, dashboard-initiated reconciliation), disputes | Tested (with a fake gateway) |
| RBAC (user / support / admin), self-lockout protection, session revocation | Tested |
| Auth (bcrypt, hashed session tokens, expiry, suspension, uniform bad-credential error), rate limiter | Tested |
| Input validation (URL schemes, E.164 phones, time zones, password limits), SQL-injection / LIKE-wildcard inputs to search | Tested |
| Search (bid-ordered, filters: country/city/category/verified/top-N, keyword/service/category/country text, pagination) | Tested |
| Admin revenue stats from the ledger | Tested |
| SEO: title, meta description, canonical, OG, JSON-LD (escaped), sitemap, robots | Smoke |
| Access control on pages/routes (admin 404 for non-admins, dashboard redirect, invoice ownership) | Smoke |
| Main public, owner and admin pages (about 30 URLs) return expected statuses under anonymous / owner / admin sessions with real data; no server errors logged. Not every page state was viewed (e.g. admin actions on a pending listing) | Smoke |

Totals: 66 automated tests passing; `tsc --noEmit` clean; `next build` succeeds.

## Built but NOT verified
* **Stripe Checkout session creation and real refunds against Stripe.** The sandbox had no Stripe keys or network path to Stripe. Everything downstream of Stripe is tested with a fake gateway and synthetic signed events. Run one full test-mode purchase before trusting it.
* **Server-action forms in a browser** (register, login, listing form, bid form, admin buttons), including the cookie flow and Next's Origin (CSRF) check. Page rendering is verified; form submission over a real browser is not. I probed with hand-built requests and could not faithfully reproduce React's action encoding, so I am not claiming this passed.
* **Mobile layout.** Responsive Tailwind classes are used; no device or screenshot testing was done.

## Not implemented
* Google sign-in (needs OAuth credentials)
* Password reset and email verification; any transactional email (approval, outbid, payment notices)
* Image **upload** (listings take https image URLs)
* Review submission and moderation UI (reviews are displayed and stored; nothing creates them yet)
* Business reporting/abuse flow (a mailto link only) and in-app support requests
* Multiple currencies (one platform currency; the column exists on payments), localisation/translations
* Tax calculation; PDF invoices (printable HTML)
* Admin 2FA, CSP header, Redis/edge rate limiting, error monitoring
* True push updates: the live board polls every 4 s
* Per-category or per-country ladders (single global ladder)

## Decisions made that you should confirm
1. Each bid is a separate full-amount payment (not a hold, not incremental).
2. Bids last 30 days (admin-configurable).
3. A paid bid that's outbid before settlement is auto-refunded in full.
4. Rejecting a listing does not auto-refund; an admin refunds it (a fully refunded listing is suspended).
5. Owners can keep editing an approved listing without re-approval (admins can suspend).
6. Verification is admin-only; owners can only request it.
