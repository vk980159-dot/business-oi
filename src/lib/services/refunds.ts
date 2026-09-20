import type { PoolClient } from "pg";
import { tx, pool } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { assertCan, type Role } from "../permissions";
import type { PaymentGateway } from "../payments/gateway";
import { createRefundRow } from "./settlement";

type Actor = { id: string; role: Role };

/** Admin-initiated refund (full by default). Permission is enforced here, not only in the UI. */
export async function requestRefund(
  gateway: PaymentGateway,
  actor: Actor,
  input: { paymentId: string; amountCents?: number; reason: string; ip?: string | null },
) {
  assertCan(actor.role, "payments.refund");
  if (!input.reason.trim()) throw new AppError("reason_required", "A refund reason is required.");
  const refundId = await tx(async (c) => {
    const p = (await c.query("select * from payments where id = $1 for update", [input.paymentId])).rows[0];
    if (!p) throw new AppError("not_found", "Payment not found.");
    if (p.status !== "paid" && p.status !== "partially_refunded") throw new AppError("not_refundable", `A payment that is "${p.status}" cannot be refunded.`);
    if (!p.stripe_payment_intent_id) throw new AppError("not_refundable", "Payment has no provider reference.");
    const pending = (await c.query("select coalesce(sum(amount_cents),0)::int as s from refunds where payment_id = $1 and status = 'pending'", [p.id])).rows[0].s;
    const refundable = p.amount_cents - p.refunded_cents - pending;
    const amount = input.amountCents ?? refundable;
    if (!Number.isInteger(amount) || amount <= 0 || amount > refundable) throw new AppError("refund_exceeds", `At most ${refundable} cents can still be refunded on this payment.`);
    const id = await createRefundRow(c, { paymentId: p.id, amountCents: amount, reason: input.reason.trim(), automatic: false, requestedBy: actor.id });
    await audit(c, { actorId: actor.id, action: "refund.requested", entityType: "refund", entityId: id, meta: { paymentId: p.id, amount }, ip: input.ip });
    return id;
  });
  return processRefund(gateway, refundId);
}

/** Sends a pending refund to the provider, then finalises it. Safe to call repeatedly. */
export async function processRefund(gateway: PaymentGateway, refundId: string): Promise<{ status: "succeeded" | "failed" | "skipped" }> {
  const r = (
    await pool().query(
      "select r.*, p.stripe_payment_intent_id as pi from refunds r join payments p on p.id = r.payment_id where r.id = $1",
      [refundId],
    )
  ).rows[0];
  if (!r || r.status !== "pending") return { status: "skipped" };
  try {
    const out = await gateway.refund({ paymentIntentId: r.pi, amountCents: r.amount_cents, refundId });
    await tx((c) => applyRefundSucceeded(c, refundId, out.stripeRefundId));
    return { status: "succeeded" };
  } catch (e) {
    await tx(async (c) => {
      await c.query("update refunds set status = 'failed', failure_reason = $2, updated_at = now() where id = $1 and status = 'pending'", [refundId, (e as Error).message.slice(0, 500)]);
      await audit(c, { action: "refund.failed", entityType: "refund", entityId: refundId, meta: { error: (e as Error).message } });
    });
    return { status: "failed" };
  }
}

export async function retryRefund(gateway: PaymentGateway, actor: Actor, refundId: string) {
  assertCan(actor.role, "payments.refund");
  const ok = await pool().query("update refunds set status = 'pending', failure_reason = null, updated_at = now() where id = $1 and status = 'failed' returning id", [refundId]);
  if (ok.rowCount === 0) throw new AppError("not_retryable", "Only failed refunds can be retried.");
  await audit(pool(), { actorId: actor.id, action: "refund.retried", entityType: "refund", entityId: refundId });
  return processRefund(gateway, refundId);
}

/** Records a completed refund: payment totals, ledger entry, and consequences for bids/listings. */
export async function applyRefundSucceeded(c: PoolClient, refundId: string, stripeRefundId: string | null) {
  const r = (await c.query("select * from refunds where id = $1 for update", [refundId])).rows[0];
  if (!r || r.status === "succeeded") return;
  const p = (await c.query("select * from payments where id = $1 for update", [r.payment_id])).rows[0];
  const total = p.refunded_cents + r.amount_cents;
  const full = total >= p.amount_cents;
  await c.query("update refunds set status = 'succeeded', stripe_refund_id = $2, failure_reason = null, updated_at = now() where id = $1", [refundId, stripeRefundId]);
  await c.query("update payments set refunded_cents = $2, status = case when status = 'disputed' then status when $3 then 'refunded'::payment_status else 'partially_refunded'::payment_status end where id = $1", [p.id, total, full]);
  await c.query(
    "insert into ledger_entries(payment_id, business_id, user_id, entry_type, amount_cents, currency, ref, note) values ($1,$2,$3,'refund',$4,$5,$6,$7)",
    [p.id, p.business_id, p.user_id, -r.amount_cents, p.currency, stripeRefundId ?? `refund:${refundId}`, r.reason],
  );
  if (full) {
    if (p.kind === "bid") {
      await c.query("update bids set status = 'void', reject_reason = coalesce(reject_reason, 'refunded') where payment_id = $1 and status in ('active','pending_payment')", [p.id]);
    } else {
      await c.query("update businesses set status = 'suspended', status_note = 'Listing fee refunded', updated_at = now() where id = $1 and status in ('pending_approval','approved')", [p.business_id]);
    }
  }
  await audit(c, { action: "refund.succeeded", entityType: "refund", entityId: refundId, meta: { paymentId: p.id, amountCents: r.amount_cents, full } });
}

/**
 * A refund made outside the app (Stripe dashboard). `amountRefunded` is the charge's cumulative total.
 * In-flight refunds we created ourselves are subtracted first so the same refund is never counted twice.
 */
export async function reconcileExternalRefund(c: PoolClient, paymentIntentId: string, amountRefunded: number) {
  const p = (await c.query("select * from payments where stripe_payment_intent_id = $1 for update", [paymentIntentId])).rows[0];
  if (!p) return;
  const pending = (await c.query("select coalesce(sum(amount_cents),0)::int as s from refunds where payment_id = $1 and status = 'pending'", [p.id])).rows[0].s;
  const diff = amountRefunded - (p.refunded_cents + pending);
  if (diff <= 0) return;
  const id = await createRefundRow(c, { paymentId: p.id, amountCents: Math.min(diff, p.amount_cents - p.refunded_cents), reason: "Refund issued outside Business.oi (Stripe dashboard)", automatic: false });
  await applyRefundSucceeded(c, id, `ext:${paymentIntentId}:${amountRefunded}`);
}
