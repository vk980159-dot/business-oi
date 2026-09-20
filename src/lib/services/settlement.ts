import type { PoolClient } from "pg";
import { audit } from "../audit";
import { activateBid } from "./ranking";

export type SettleResult =
  | { outcome: "unknown_session" | "already_processed" | "amount_mismatch" }
  | { outcome: "listing_paid" }
  | { outcome: "bid_active" }
  | { outcome: "bid_rejected"; reason: string; refundId: string };

/** Inserts a pending refund row. The caller processes it against the provider after commit. */
export async function createRefundRow(
  c: PoolClient,
  a: { paymentId: string; amountCents: number; reason: string; automatic: boolean; requestedBy?: string | null },
): Promise<string> {
  const r = await c.query(
    "insert into refunds(payment_id, amount_cents, reason, automatic, requested_by) values ($1,$2,$3,$4,$5) returning id",
    [a.paymentId, a.amountCents, a.reason, a.automatic, a.requestedBy ?? null],
  );
  return r.rows[0].id;
}

/**
 * Called only from the verified-webhook path, inside a transaction.
 * Idempotent: a payment is settled at most once.
 */
export async function settleCheckoutPaid(
  c: PoolClient,
  e: { sessionId: string; paymentIntentId: string | null; amountTotal: number; currency: string },
): Promise<SettleResult> {
  const p = (await c.query("select * from payments where stripe_session_id = $1 for update", [e.sessionId])).rows[0];
  if (!p) return { outcome: "unknown_session" };
  if (p.status !== "pending" && p.status !== "expired") return { outcome: "already_processed" };

  // Never trust an amount we didn't create. Money arrived but we can't attribute it: flag for manual reconciliation.
  if (p.amount_cents !== e.amountTotal || p.currency !== e.currency.toLowerCase()) {
    await c.query("update payments set status = 'failed', failure_reason = $2 where id = $1", [
      p.id,
      `amount_mismatch: expected ${p.amount_cents} ${p.currency}, provider reported ${e.amountTotal} ${e.currency}`,
    ]);
    await c.query("update bids set status = 'void', reject_reason = 'amount_mismatch' where payment_id = $1 and status = 'pending_payment'", [p.id]);
    await audit(c, { action: "payment.anomaly", entityType: "payment", entityId: p.id, meta: { expected: p.amount_cents, got: e.amountTotal, sessionId: e.sessionId } });
    return { outcome: "amount_mismatch" };
  }

  await c.query(
    `update payments set status = 'paid', paid_at = now(), failure_reason = null, stripe_payment_intent_id = $2,
       invoice_number = 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0')
     where id = $1`,
    [p.id, e.paymentIntentId],
  );
  await c.query(
    "insert into ledger_entries(payment_id, business_id, user_id, entry_type, amount_cents, currency, ref) values ($1,$2,$3,'charge',$4,$5,$6)",
    [p.id, p.business_id, p.user_id, p.amount_cents, p.currency, e.paymentIntentId ?? e.sessionId],
  );
  await audit(c, { action: "payment.paid", entityType: "payment", entityId: p.id, meta: { kind: p.kind, amountCents: p.amount_cents } });

  if (p.kind === "listing") {
    await c.query("update businesses set status = 'pending_approval', updated_at = now() where id = $1 and status = 'draft'", [p.business_id]);
    return { outcome: "listing_paid" };
  }

  const bid = (await c.query("select id, status from bids where payment_id = $1", [p.id])).rows[0];
  let reason: string | null = null;
  if (!bid) reason = "bid_missing";
  else if (bid.status !== "pending_payment") reason = "checkout_expired_before_payment";
  else {
    const res = await activateBid(c, bid.id);
    if (res.activated) {
      await audit(c, { action: "bid.activated", entityType: "bid", entityId: bid.id, meta: { paymentId: p.id } });
      return { outcome: "bid_active" };
    }
    reason = res.reason;
  }
  // If the bid was pending, activateBid already marked it rejected. Otherwise (void/expired), record why it didn't apply.
  if (bid && bid.status !== "pending_payment") {
    await c.query("update bids set status = 'rejected', reject_reason = $2 where id = $1", [bid.id, reason]);
  }
  // Paid but cannot take effect (e.g. outbid while paying): refund in full automatically.
  const refundId = await createRefundRow(c, { paymentId: p.id, amountCents: p.amount_cents, reason: `Bid not placed: ${reason}`, automatic: true });
  await audit(c, { action: "bid.rejected_auto_refund", entityType: "payment", entityId: p.id, meta: { reason, refundId } });
  return { outcome: "bid_rejected", reason: reason!, refundId };
}

export async function failCheckout(c: PoolClient, sessionId: string, status: "failed" | "expired", reason: string) {
  const p = (await c.query("select * from payments where stripe_session_id = $1 for update", [sessionId])).rows[0];
  if (!p || p.status !== "pending") return false;
  await c.query("update payments set status = $2, failure_reason = $3 where id = $1", [p.id, status, reason]);
  await c.query("update bids set status = 'void', reject_reason = $2 where payment_id = $1 and status = 'pending_payment'", [p.id, reason]);
  await audit(c, { action: `payment.${status}`, entityType: "payment", entityId: p.id, meta: { reason } });
  return true;
}
