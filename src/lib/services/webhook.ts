import { tx } from "../db";
import { audit } from "../audit";
import { settleCheckoutPaid, failCheckout } from "./settlement";
import { reconcileExternalRefund } from "./refunds";

/** The subset of a Stripe event this app reads. */
export type ProviderEvent = { id: string; type: string; data: { object: any } };

/**
 * Processes one *signature-verified* event in a single transaction:
 * the event id is recorded first (unique), so duplicate or concurrent deliveries do nothing.
 * Returns refunds created during processing; the caller sends them to the provider after commit.
 */
export async function processProviderEvent(event: ProviderEvent): Promise<{ duplicate: boolean; refundIds: string[] }> {
  return tx(async (c) => {
    const ins = await c.query("insert into stripe_events(id, type) values ($1,$2) on conflict (id) do nothing returning id", [event.id, event.type]);
    if (ins.rowCount === 0) return { duplicate: true, refundIds: [] };

    const refundIds: string[] = [];
    const o = event.data.object;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        if (o.payment_status !== "paid") break; // async method still pending; wait for async_payment_succeeded
        const r = await settleCheckoutPaid(c, {
          sessionId: o.id,
          paymentIntentId: typeof o.payment_intent === "string" ? o.payment_intent : (o.payment_intent?.id ?? null),
          amountTotal: o.amount_total,
          currency: o.currency,
        });
        if (r.outcome === "bid_rejected") refundIds.push(r.refundId);
        break;
      }
      case "checkout.session.async_payment_failed":
        await failCheckout(c, o.id, "failed", "async_payment_failed");
        break;
      case "checkout.session.expired":
        await failCheckout(c, o.id, "expired", "checkout_session_expired");
        break;
      case "charge.refunded": {
        const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id;
        if (pi) await reconcileExternalRefund(c, pi, o.amount_refunded);
        break;
      }
      case "charge.dispute.created": {
        const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id;
        const p = pi ? (await c.query("select * from payments where stripe_payment_intent_id = $1 for update", [pi])).rows[0] : null;
        if (!p) break;
        await c.query("update payments set status = 'disputed' where id = $1", [p.id]);
        await c.query("insert into ledger_entries(payment_id, business_id, user_id, entry_type, amount_cents, currency, ref) values ($1,$2,$3,'dispute_opened',$4,$5,$6)", [p.id, p.business_id, p.user_id, -o.amount, p.currency, o.id]);
        if (p.kind === "bid") await c.query("update bids set status = 'void', reject_reason = 'disputed' where payment_id = $1 and status = 'active'", [p.id]);
        await audit(c, { action: "payment.disputed", entityType: "payment", entityId: p.id, meta: { disputeId: o.id } });
        break;
      }
      case "charge.dispute.closed": {
        const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id;
        const p = pi ? (await c.query("select * from payments where stripe_payment_intent_id = $1 for update", [pi])).rows[0] : null;
        if (!p) break;
        if (o.status === "won") {
          await c.query("update payments set status = case when refunded_cents > 0 then 'partially_refunded'::payment_status else 'paid'::payment_status end where id = $1", [p.id]);
          await c.query("insert into ledger_entries(payment_id, business_id, user_id, entry_type, amount_cents, currency, ref) values ($1,$2,$3,'dispute_won',$4,$5,$6)", [p.id, p.business_id, p.user_id, o.amount, p.currency, o.id]);
        } else {
          await c.query("insert into ledger_entries(payment_id, business_id, user_id, entry_type, amount_cents, currency, ref, note) values ($1,$2,$3,'dispute_lost',0,$4,$5,$6)", [p.id, p.business_id, p.user_id, p.currency, o.id, `dispute closed: ${o.status}`]);
        }
        await audit(c, { action: "payment.dispute_closed", entityType: "payment", entityId: p.id, meta: { disputeId: o.id, status: o.status } });
        break;
      }
      default:
        break; // ignored event types are still recorded above
    }
    await c.query("update stripe_events set processed_at = now() where id = $1", [event.id]);
    return { duplicate: false, refundIds };
  });
}
