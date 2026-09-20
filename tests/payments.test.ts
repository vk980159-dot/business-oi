import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/lib/db";
import { createBusiness } from "../src/lib/services/business";
import { startListingCheckout, startBidCheckout } from "../src/lib/services/checkout";
import { approveBusiness, rejectBusiness } from "../src/lib/services/moderation";
import { requestRefund, retryRefund, processRefund } from "../src/lib/services/refunds";
import { processProviderEvent } from "../src/lib/services/webhook";
import { getBusinessStanding } from "../src/lib/services/ranking";
import { adminStats } from "../src/lib/services/stats";
import { FakeGateway, bizInput, makeApprovedBusiness, makeUser, payViaWebhookLogic, placeAndPayBid, resetDb } from "./helpers";

let gw: FakeGateway;
beforeEach(async () => { await resetDb(); gw = new FakeGateway(); });
afterAll(() => pool().end());

const q = async (sql: string, p: unknown[] = []) => (await pool().query(sql, p)).rows;

describe("listing payment flow", () => {
  it("draft → paid → pending_approval → approved, with invoice number and ledger entry", async () => {
    const owner = await makeUser(); const admin = await makeUser("admin");
    const b = await createBusiness(pool(), owner.id, bizInput());
    expect((await q("select status from businesses where id=$1", [b.id]))[0].status).toBe("draft");
    const url = await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    expect(url).toContain("https://checkout.test/");
    const pay = (await q("select * from payments where business_id=$1", [b.id]))[0];
    expect(pay.amount_cents).toBe(2500);
    expect(pay.terms_accepted_at).not.toBeNull();
    await expect(approveBusiness(admin, b.id)).rejects.toMatchObject({ code: "invalid_state" }); // not paid yet
    await payViaWebhookLogic(pay.id);
    expect((await q("select status from businesses where id=$1", [b.id]))[0].status).toBe("pending_approval");
    const paid = (await q("select * from payments where id=$1", [pay.id]))[0];
    expect(paid.status).toBe("paid");
    expect(paid.invoice_number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect((await q("select amount_cents, entry_type from ledger_entries where payment_id=$1", [pay.id]))).toEqual([{ amount_cents: 2500, entry_type: "charge" }]);
    await approveBusiness(admin, b.id);
    expect((await q("select status, approved_at from businesses where id=$1", [b.id]))[0].status).toBe("approved");
  });

  it("requires accepting the terms and never charges twice", async () => {
    const owner = await makeUser();
    const b = await createBusiness(pool(), owner.id, bizInput());
    await expect(startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: false })).rejects.toMatchObject({ code: "terms_required" });
    const u1 = await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    const u2 = await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    expect(u2).toBe(u1);
    expect(gw.sessions).toBe(1);
    expect((await q("select count(*)::int n from payments where business_id=$1", [b.id]))[0].n).toBe(1);
    const pay = (await q("select id from payments where business_id=$1", [b.id]))[0];
    await payViaWebhookLogic(pay.id);
    await expect(startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("marks the payment failed if the provider errors, and allows a retry", async () => {
    const owner = await makeUser();
    const b = await createBusiness(pool(), owner.id, bizInput());
    gw.failCheckout = true;
    await expect(startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true })).rejects.toMatchObject({ code: "checkout_failed" });
    expect((await q("select status from payments where business_id=$1", [b.id]))[0].status).toBe("failed");
    gw.failCheckout = false;
    await expect(startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true })).resolves.toContain("checkout.test");
  });

  it("rejects a payment whose amount differs from what we created (payment manipulation)", async () => {
    const owner = await makeUser();
    const b = await createBusiness(pool(), owner.id, bizInput());
    await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    const pay = (await q("select id from payments where business_id=$1", [b.id]))[0];
    const r = await payViaWebhookLogic(pay.id, { amount: 100 });
    expect(r.outcome).toBe("amount_mismatch");
    expect((await q("select status, failure_reason from payments where id=$1", [pay.id]))[0]).toMatchObject({ status: "failed" });
    expect((await q("select status from businesses where id=$1", [b.id]))[0].status).toBe("draft");
    expect((await q("select count(*)::int n from ledger_entries"))[0].n).toBe(0);
    expect((await q("select count(*)::int n from audit_logs where action='payment.anomaly'"))[0].n).toBe(1);
  });

  it("a rejected listing can be refunded, and the refund is recorded", async () => {
    const owner = await makeUser(); const admin = await makeUser("admin");
    const b = await createBusiness(pool(), owner.id, bizInput());
    await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    const pay = (await q("select id from payments where business_id=$1", [b.id]))[0];
    await payViaWebhookLogic(pay.id);
    await rejectBusiness(admin, b.id, "Not a real business");
    expect((await q("select status, status_note from businesses where id=$1", [b.id]))[0]).toMatchObject({ status: "rejected", status_note: "Not a real business" });
    await requestRefund(gw, admin, { paymentId: pay.id, reason: "listing rejected" });
    expect((await q("select status, refunded_cents from payments where id=$1", [pay.id]))[0]).toEqual({ status: "refunded", refunded_cents: 2500 });
  });
});

describe("webhook idempotency", () => {
  const completed = (sessionId: string, amount: number, id = "evt_1") => ({
    id, type: "checkout.session.completed",
    data: { object: { id: sessionId, payment_status: "paid", payment_intent: "pi_1", amount_total: amount, currency: "usd" } },
  });

  it("processing the same event twice charges once", async () => {
    const owner = await makeUser();
    const b = await createBusiness(pool(), owner.id, bizInput());
    await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    const pay = (await q("select * from payments where business_id=$1", [b.id]))[0];
    const evt = completed(pay.stripe_session_id, 2500);
    expect((await processProviderEvent(evt)).duplicate).toBe(false);
    expect((await processProviderEvent(evt)).duplicate).toBe(true);
    expect((await q("select count(*)::int n from ledger_entries"))[0].n).toBe(1);
  });

  it("five concurrent deliveries of the same event still charge once", async () => {
    const owner = await makeUser();
    const b = await createBusiness(pool(), owner.id, bizInput());
    await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    const pay = (await q("select * from payments where business_id=$1", [b.id]))[0];
    const evt = completed(pay.stripe_session_id, 2500);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => processProviderEvent(evt)));
    expect(rs.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await q("select count(*)::int n from ledger_entries"))[0].n).toBe(1);
  });

  it("two different events for the same session also settle once", async () => {
    const owner = await makeUser();
    const b = await createBusiness(pool(), owner.id, bizInput());
    await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
    const pay = (await q("select * from payments where business_id=$1", [b.id]))[0];
    await Promise.all([processProviderEvent(completed(pay.stripe_session_id, 2500, "evt_a")), processProviderEvent(completed(pay.stripe_session_id, 2500, "evt_b"))]);
    expect((await q("select count(*)::int n from ledger_entries"))[0].n).toBe(1);
  });

  it("unpaid (async) sessions wait; expired sessions void the pending bid", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 300 });
    const pay = (await q("select p.* from payments p join bids b on b.payment_id=p.id where p.business_id=$1", [A.business.id]))[0];
    await processProviderEvent({ id: "evt_u", type: "checkout.session.completed", data: { object: { id: pay.stripe_session_id, payment_status: "unpaid", amount_total: 300, currency: "usd" } } });
    expect((await q("select status from payments where id=$1", [pay.id]))[0].status).toBe("pending");
    await processProviderEvent({ id: "evt_x", type: "checkout.session.expired", data: { object: { id: pay.stripe_session_id } } });
    expect((await q("select status from payments where id=$1", [pay.id]))[0].status).toBe("expired");
    expect((await q("select status from bids where payment_id=$1", [pay.id]))[0].status).toBe("void");
  });

  it("a bid that loses the race is auto-refunded via the webhook path", async () => {
    const A = await makeApprovedBusiness(gw, "A"); const B = await makeApprovedBusiness(gw, "B");
    await startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 300 });
    await startBidCheckout(gw, { userId: B.owner.id, userEmail: B.owner.email, businessId: B.business.id, amountCents: 300 });
    const pa = (await q("select p.* from payments p join bids b on b.payment_id=p.id where p.business_id=$1", [A.business.id]))[0];
    const pb = (await q("select p.* from payments p join bids b on b.payment_id=p.id where p.business_id=$1", [B.business.id]))[0];
    await processProviderEvent({ id: "e1", type: "checkout.session.completed", data: { object: { id: pa.stripe_session_id, payment_status: "paid", payment_intent: "pi_a", amount_total: 300, currency: "usd" } } });
    const r = await processProviderEvent({ id: "e2", type: "checkout.session.completed", data: { object: { id: pb.stripe_session_id, payment_status: "paid", payment_intent: "pi_b", amount_total: 300, currency: "usd" } } });
    expect(r.refundIds).toHaveLength(1);
    await processRefund(gw, r.refundIds[0]);
    expect(gw.refunds).toEqual([{ paymentIntentId: "pi_b", amountCents: 300, refundId: r.refundIds[0] }]);
    expect((await q("select status from payments where id=$1", [pb.id]))[0].status).toBe("refunded");
    expect((await q("select status from bids where payment_id=$1", [pb.id]))[0].status).toBe("rejected");
    const net = (await q("select sum(amount_cents)::int s from ledger_entries where payment_id=$1", [pb.id]))[0].s;
    expect(net).toBe(0);
  });
});

describe("refunds, disputes, ledger", () => {
  it("refunding an active bid removes it from the ladder and nets the ledger to zero", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 600);
    expect((await getBusinessStanding(pool(), A.business.id))?.bidCents).toBe(600);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    await requestRefund(gw, A.admin, { paymentId: pay.id, reason: "customer request" });
    expect((await getBusinessStanding(pool(), A.business.id))?.bidCents).toBe(0);
    expect((await q("select sum(amount_cents)::int s from ledger_entries where payment_id=$1", [pay.id]))[0].s).toBe(0);
  });

  it("partial refunds keep the bid live; over-refunds are rejected", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 600);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    await requestRefund(gw, A.admin, { paymentId: pay.id, amountCents: 200, reason: "goodwill" });
    expect((await q("select status, refunded_cents from payments where id=$1", [pay.id]))[0]).toEqual({ status: "partially_refunded", refunded_cents: 200 });
    expect((await getBusinessStanding(pool(), A.business.id))?.bidCents).toBe(600);
    await expect(requestRefund(gw, A.admin, { paymentId: pay.id, amountCents: 500, reason: "too much" })).rejects.toMatchObject({ code: "refund_exceeds" });
  });

  it("a failed provider refund stays visible and can be retried", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    gw.failRefunds = true;
    const r1 = await requestRefund(gw, A.admin, { paymentId: pay.id, reason: "x" });
    expect(r1.status).toBe("failed");
    const ref = (await q("select id, status from refunds where payment_id=$1", [pay.id]))[0];
    expect(ref.status).toBe("failed");
    expect((await q("select status from payments where id=$1", [pay.id]))[0].status).toBe("paid"); // nothing recorded as refunded
    gw.failRefunds = false;
    expect((await retryRefund(gw, A.admin, ref.id)).status).toBe("succeeded");
    expect((await q("select status from payments where id=$1", [pay.id]))[0].status).toBe("refunded");
  });

  it("only admins can refund (support and users are refused server-side)", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    const support = await makeUser("support");
    await expect(requestRefund(gw, support, { paymentId: pay.id, reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(requestRefund(gw, A.owner, { paymentId: pay.id, reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
    expect(gw.refunds).toHaveLength(0);
  });

  it("a dispute pulls the bid off the ladder; winning it is recorded in the ledger", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    await processProviderEvent({ id: "d1", type: "charge.dispute.created", data: { object: { id: "dp_1", payment_intent: `pi_${pay.id}`, amount: 300 } } });
    expect((await q("select status from payments where id=$1", [pay.id]))[0].status).toBe("disputed");
    expect((await getBusinessStanding(pool(), A.business.id))?.bidCents).toBe(0);
    await processProviderEvent({ id: "d2", type: "charge.dispute.closed", data: { object: { id: "dp_1", payment_intent: `pi_${pay.id}`, amount: 300, status: "won" } } });
    expect((await q("select status from payments where id=$1", [pay.id]))[0].status).toBe("paid");
    expect((await q("select entry_type from ledger_entries where payment_id=$1 order by id", [pay.id])).map((r) => r.entry_type)).toEqual(["charge", "dispute_opened", "dispute_won"]);
  });

  it("refunds made in the Stripe dashboard are reconciled exactly once", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    const evt = (id: string) => ({ id, type: "charge.refunded", data: { object: { payment_intent: `pi_${pay.id}`, amount_refunded: 300 } } });
    await processProviderEvent(evt("r1"));
    await processProviderEvent(evt("r2")); // Stripe may send several events for the same state
    expect((await q("select status, refunded_cents from payments where id=$1", [pay.id]))[0]).toEqual({ status: "refunded", refunded_cents: 300 });
    expect((await q("select count(*)::int n from ledger_entries where entry_type='refund' and payment_id=$1", [pay.id]))[0].n).toBe(1);
  });

  it("ledger and audit log are append-only at the database level", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await expect(pool().query("update ledger_entries set amount_cents = 1")).rejects.toThrow(/append-only/);
    await expect(pool().query("delete from ledger_entries")).rejects.toThrow(/append-only/);
    await expect(pool().query("update audit_logs set action = 'x'")).rejects.toThrow(/append-only/);
    await expect(pool().query("delete from audit_logs")).rejects.toThrow(/append-only/);
    expect(A.business.id).toBeTruthy();
  });

  it("admin revenue stats reflect charges net of refunds", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 600);
    const pay = (await q("select id from payments where business_id=$1 and kind='bid'", [A.business.id]))[0];
    await requestRefund(gw, A.admin, { paymentId: pay.id, amountCents: 100, reason: "adj" });
    const s = await adminStats();
    expect(s).toMatchObject({ listingGrossCents: 2500, bidGrossCents: 600, refundedCents: 100, netRevenueCents: 3000, active_bids: 1 });
  });
});
