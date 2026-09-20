import type { PoolClient } from "pg";
import { tx, pool } from "../db";
import { AppError } from "../errors";
import { getSettings, formatMoney } from "../settings";
import { audit } from "../audit";
import type { PaymentGateway } from "../payments/gateway";
import { getLadderInfo } from "./ranking";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

type PreparedPayment = { id: string; reuseUrl?: string; amountCents: number; currency: string; expiresAt: Date; staleSessionId?: string | null };

/** Creates the Stripe session for a payment row that has none yet, or fails the row if Stripe rejects it. */
async function attachSession(
  gateway: PaymentGateway,
  p: PreparedPayment,
  meta: { businessId: string; userEmail: string; productName: string; description: string },
): Promise<string> {
  try {
    const s = await gateway.createCheckout({
      paymentId: p.id,
      amountCents: p.amountCents,
      currency: p.currency,
      productName: meta.productName,
      description: meta.description,
      customerEmail: meta.userEmail,
      successUrl: `${appUrl()}/dashboard/business/${meta.businessId}?checkout=processing`,
      cancelUrl: `${appUrl()}/dashboard/business/${meta.businessId}?checkout=canceled`,
      expiresAt: p.expiresAt,
    });
    await pool().query("update payments set stripe_session_id = $2, checkout_url = $3 where id = $1", [p.id, s.sessionId, s.url]);
    return s.url;
  } catch (e) {
    await pool().query("update payments set status = 'failed', failure_reason = $2 where id = $1 and status = 'pending'", [
      p.id,
      `checkout_creation_failed: ${(e as Error).message}`.slice(0, 500),
    ]);
    await pool().query("update bids set status = 'void', reject_reason = 'checkout_creation_failed' where payment_id = $1 and status = 'pending_payment'", [p.id]);
    throw new AppError("checkout_failed", "We couldn't start checkout. You have not been charged. Please try again.");
  }
}

async function lockOwnedBusiness(c: PoolClient, businessId: string, userId: string) {
  const biz = (await c.query("select * from businesses where id = $1 and owner_id = $2 for update", [businessId, userId])).rows[0];
  if (!biz) throw new AppError("not_found", "Business not found.");
  return biz;
}

/** $25 (configurable) listing fee. Returns the hosted checkout URL. */
export async function startListingCheckout(
  gateway: PaymentGateway,
  a: { userId: string; userEmail: string; businessId: string; acceptTerms: boolean },
): Promise<string> {
  if (!a.acceptTerms) throw new AppError("terms_required", "Please accept the listing terms to continue.");

  const prepared = await tx(async (c) => {
    const biz = await lockOwnedBusiness(c, a.businessId, a.userId);
    if (biz.status !== "draft") throw new AppError("invalid_state", "The listing fee for this business has already been paid.");
    const s = await getSettings(c);
    const open = (await c.query("select * from payments where business_id = $1 and kind = 'listing' and status = 'pending'", [a.businessId])).rows[0];
    if (open) {
      if (open.checkout_url && new Date(open.expires_at) > new Date()) {
        return { id: open.id, reuseUrl: open.checkout_url as string, amountCents: open.amount_cents, currency: open.currency, expiresAt: open.expires_at } as PreparedPayment;
      }
      await c.query("update payments set status = 'expired' where id = $1", [open.id]);
    }
    const ins = await c.query(
      `insert into payments(user_id, business_id, kind, amount_cents, currency, terms_accepted_at, expires_at)
       values ($1,$2,'listing',$3,$4, now(), now() + make_interval(mins => $5)) returning id, amount_cents, currency, expires_at`,
      [a.userId, a.businessId, s.listingFeeCents, s.currency, s.checkoutHoldMinutes],
    );
    const r = ins.rows[0];
    await audit(c, { actorId: a.userId, action: "payment.listing.created", entityType: "payment", entityId: r.id, meta: { amountCents: r.amount_cents } });
    return { id: r.id, amountCents: r.amount_cents, currency: r.currency, expiresAt: r.expires_at } as PreparedPayment;
  });

  if (prepared.reuseUrl) return prepared.reuseUrl;
  const biz = (await pool().query("select name from businesses where id = $1", [a.businessId])).rows[0];
  return attachSession(gateway, prepared, {
    businessId: a.businessId,
    userEmail: a.userEmail,
    productName: "Business.oi listing fee",
    description: `Listing fee for ${biz.name} (${formatMoney(prepared.amountCents, prepared.currency)})`,
  });
}

/**
 * Ranking bid. This only creates a *pending* bid and a checkout. The bid never affects rankings
 * until the payment is confirmed by a verified webhook and re-validated under the ranking lock.
 */
export async function startBidCheckout(
  gateway: PaymentGateway,
  a: { userId: string; userEmail: string; businessId: string; amountCents: number },
): Promise<string> {
  if (!Number.isInteger(a.amountCents)) throw new AppError("invalid_amount", "Enter a valid amount.");

  const prepared = await tx(async (c) => {
    const biz = await lockOwnedBusiness(c, a.businessId, a.userId);
    if (biz.status !== "approved") throw new AppError("not_approved", "Only approved listings can place ranking bids.");
    const s = await getSettings(c);
    const info = await getLadderInfo(c);
    if (info.leaderBusinessId === a.businessId) throw new AppError("already_leading", "You already hold the #1 position.");
    if (a.amountCents < info.minNextCents) {
      throw new AppError("below_minimum", `The minimum valid bid right now is ${formatMoney(info.minNextCents, s.currency)}.`);
    }
    if (a.amountCents > s.maxBidCents) throw new AppError("above_maximum", `The maximum bid is ${formatMoney(s.maxBidCents, s.currency)}.`);

    let staleSessionId: string | null = null;
    const open = (
      await c.query(
        `select b.id as bid_id, p.* from bids b join payments p on p.id = b.payment_id
         where b.business_id = $1 and b.status = 'pending_payment'`,
        [a.businessId],
      )
    ).rows[0];
    if (open) {
      if (open.amount_cents === a.amountCents && open.checkout_url && new Date(open.expires_at) > new Date()) {
        return { id: open.id, reuseUrl: open.checkout_url as string, amountCents: open.amount_cents, currency: open.currency, expiresAt: open.expires_at } as PreparedPayment;
      }
      await c.query("update payments set status = 'expired' where id = $1 and status = 'pending'", [open.id]);
      await c.query("update bids set status = 'void', reject_reason = 'replaced_by_new_bid' where id = $1", [open.bid_id]);
      staleSessionId = open.stripe_session_id;
    }

    const pay = (
      await c.query(
        `insert into payments(user_id, business_id, kind, amount_cents, currency, terms_accepted_at, expires_at)
         values ($1,$2,'bid',$3,$4, now(), now() + make_interval(mins => $5)) returning id, amount_cents, currency, expires_at`,
        [a.userId, a.businessId, a.amountCents, s.currency, s.checkoutHoldMinutes],
      )
    ).rows[0];
    await c.query("insert into bids(business_id, payment_id, amount_cents) values ($1,$2,$3)", [a.businessId, pay.id, a.amountCents]);
    await audit(c, { actorId: a.userId, action: "bid.created", entityType: "payment", entityId: pay.id, meta: { amountCents: a.amountCents, businessId: a.businessId } });
    return { id: pay.id, amountCents: pay.amount_cents, currency: pay.currency, expiresAt: pay.expires_at, staleSessionId } as PreparedPayment;
  });

  if (prepared.reuseUrl) return prepared.reuseUrl;
  if (prepared.staleSessionId) await gateway.expireCheckout(prepared.staleSessionId);
  const biz = (await pool().query("select name from businesses where id = $1", [a.businessId])).rows[0];
  return attachSession(gateway, prepared, {
    businessId: a.businessId,
    userEmail: a.userEmail,
    productName: "Business.oi ranking bid",
    description: `Ranking bid of ${formatMoney(prepared.amountCents, prepared.currency)} for ${biz.name}`,
  });
}
