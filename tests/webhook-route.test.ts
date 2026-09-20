import { beforeEach, afterAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { pool } from "../src/lib/db";
import { POST } from "../src/app/api/webhooks/stripe/route";
import { __setGatewayForTests } from "../src/lib/payments";
import { startBidCheckout } from "../src/lib/services/checkout";
import { FakeGateway, makeApprovedBusiness, resetDb } from "./helpers";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
let gw: FakeGateway;
beforeEach(async () => { await resetDb(); gw = new FakeGateway(); __setGatewayForTests(gw); });
afterAll(async () => { __setGatewayForTests(undefined); await pool().end(); });

const signed = (payload: string, secret = SECRET, ts?: number) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: ts });
const call = (payload: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers }));
const evt = (id: string, sessionId: string, amount: number, pi = "pi_1") =>
  JSON.stringify({ id, object: "event", type: "checkout.session.completed", data: { object: { id: sessionId, payment_status: "paid", payment_intent: pi, amount_total: amount, currency: "usd" } } });

async function pendingBid(name: string) {
  const b = await makeApprovedBusiness(gw, name);
  await startBidCheckout(gw, { userId: b.owner.id, userEmail: b.owner.email, businessId: b.business.id, amountCents: 300 });
  const p = (await pool().query("select p.* from payments p join bids x on x.payment_id=p.id where p.business_id=$1", [b.business.id])).rows[0];
  return { ...b, payment: p };
}

describe("POST /api/webhooks/stripe", () => {
  it("rejects a missing signature, a wrong secret, a tampered body, and a stale timestamp", async () => {
    const { payment } = await pendingBid("A");
    const body = evt("evt_1", payment.stripe_session_id, 300);
    expect((await call(body)).status).toBe(400);
    expect((await call(body, { "stripe-signature": signed(body, "whsec_wrong") })).status).toBe(400);
    expect((await call(body.replace("300", "1"), { "stripe-signature": signed(body) })).status).toBe(400);
    expect((await call(body, { "stripe-signature": signed(body, SECRET, Math.floor(Date.now() / 1000) - 3600) })).status).toBe(400);
    // nothing was activated by any of the rejected calls
    expect((await pool().query("select status from payments where id=$1", [payment.id])).rows[0].status).toBe("pending");
    expect((await pool().query("select count(*)::int n from stripe_events")).rows[0].n).toBe(0);
  });

  it("accepts a correctly signed event, activates the bid, and treats a replay as a duplicate", async () => {
    const { payment, business } = await pendingBid("A");
    const body = evt("evt_ok", payment.stripe_session_id, 300);
    const r1 = await call(body, { "stripe-signature": signed(body) });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ received: true, duplicate: false });
    expect((await pool().query("select status from bids where payment_id=$1", [payment.id])).rows[0].status).toBe("active");
    const r2 = await call(body, { "stripe-signature": signed(body) });
    expect(await r2.json()).toEqual({ received: true, duplicate: true });
    expect((await pool().query("select count(*)::int n from ledger_entries where payment_id=$1", [payment.id])).rows[0].n).toBe(1);
    expect(business.id).toBeTruthy();
  });

  it("a losing bid delivered through the route is refunded automatically after commit", async () => {
    const a = await pendingBid("A"); const b = await pendingBid("B");
    const ea = evt("evt_a", a.payment.stripe_session_id, 300, "pi_a");
    const eb = evt("evt_b", b.payment.stripe_session_id, 300, "pi_b");
    await call(ea, { "stripe-signature": signed(ea) });
    await call(eb, { "stripe-signature": signed(eb) });
    expect(gw.refunds).toHaveLength(1);
    expect(gw.refunds[0]).toMatchObject({ paymentIntentId: "pi_b", amountCents: 300 });
    expect((await pool().query("select status from payments where id=$1", [b.payment.id])).rows[0].status).toBe("refunded");
  });

  it("returns 500 (so Stripe retries) if processing throws, and records nothing", async () => {
    const { payment } = await pendingBid("A");
    await pool().query("alter table ledger_entries add constraint boom check (amount_cents < 0) not valid"); // make settlement fail for new rows only
    const body = evt("evt_boom", payment.stripe_session_id, 300);
    const r = await call(body, { "stripe-signature": signed(body) });
    expect(r.status).toBe(500);
    expect((await pool().query("select count(*)::int n from stripe_events")).rows[0].n).toBe(0);
    expect((await pool().query("select status from payments where id=$1", [payment.id])).rows[0].status).toBe("pending");
    await pool().query("alter table ledger_entries drop constraint boom");
    expect((await call(body, { "stripe-signature": signed(body) })).status).toBe(200); // retry succeeds
  });
});
