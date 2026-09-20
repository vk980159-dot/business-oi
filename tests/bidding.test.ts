import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/lib/db";
import { getLadderInfo, getBusinessStanding } from "../src/lib/services/ranking";
import { startBidCheckout } from "../src/lib/services/checkout";
import { suspendBusiness } from "../src/lib/services/moderation";
import { FakeGateway, makeApprovedBusiness, placeAndPayBid, payViaWebhookLogic, resetDb } from "./helpers";

let gw: FakeGateway;
beforeEach(async () => { await resetDb(); gw = new FakeGateway(); });
afterAll(() => pool().end());

const rank = async (id: string) => (await getBusinessStanding(pool(), id))?.rank;

describe("bidding rules (spec example)", () => {
  it("starts at $3 with no bids", async () => {
    const info = await getLadderInfo(pool());
    expect(info).toMatchObject({ highestCents: 0, minNextCents: 300, leaderBusinessId: null });
  });

  it("follows the A/B example: B $3 → A $6 → B $9, next minimum $12", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const B = await makeApprovedBusiness(gw, "B");
    // A has listing fee only ($0 bid). B bids $3.
    await placeAndPayBid(gw, B.owner, B.business.id, 300);
    expect(await rank(B.business.id)).toBe(1);
    expect(await rank(A.business.id)).toBe(2);

    await placeAndPayBid(gw, A.owner, A.business.id, 600);
    expect(await rank(A.business.id)).toBe(1);
    expect(await rank(B.business.id)).toBe(2);

    await placeAndPayBid(gw, B.owner, B.business.id, 900);
    expect(await rank(B.business.id)).toBe(1);
    expect((await getLadderInfo(pool())).minNextCents).toBe(1200);
  });

  it("rejects bids below the starting bid and below highest + increment at checkout", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const B = await makeApprovedBusiness(gw, "B");
    await expect(startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 200 })).rejects.toMatchObject({ code: "below_minimum" });
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    await expect(startBidCheckout(gw, { userId: B.owner.id, userEmail: B.owner.email, businessId: B.business.id, amountCents: 500 })).rejects.toMatchObject({ code: "below_minimum" });
    await expect(startBidCheckout(gw, { userId: B.owner.id, userEmail: B.owner.email, businessId: B.business.id, amountCents: 600 })).resolves.toContain("https://checkout.test/");
  });

  it("blocks the current leader from outbidding themselves", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    await expect(startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 900 })).rejects.toMatchObject({ code: "already_leading" });
  });

  it("does not let one user bid for another user's business", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const B = await makeApprovedBusiness(gw, "B");
    await expect(startBidCheckout(gw, { userId: B.owner.id, userEmail: B.owner.email, businessId: A.business.id, amountCents: 300 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("a pending (unpaid) bid never changes rankings", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const B = await makeApprovedBusiness(gw, "B");
    await placeAndPayBid(gw, A.owner, A.business.id, 300);
    await startBidCheckout(gw, { userId: B.owner.id, userEmail: B.owner.email, businessId: B.business.id, amountCents: 600 });
    expect(await rank(A.business.id)).toBe(1);
    expect((await getLadderInfo(pool())).highestCents).toBe(300);
  });

  it("clicking bid twice with the same amount reuses the same checkout (no duplicate)", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const u1 = await startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 300 });
    const u2 = await startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 300 });
    expect(u2).toBe(u1);
    const n = (await pool().query("select count(*)::int n from payments where business_id=$1 and kind='bid'", [A.business.id])).rows[0].n;
    expect(n).toBe(1);
  });

  it("changing the amount replaces the pending bid", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 300 });
    await startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 500 });
    const s = (await pool().query("select status, amount_cents from bids where business_id=$1 order by created_at", [A.business.id])).rows;
    expect(s).toEqual([{ status: "void", amount_cents: 300 }, { status: "pending_payment", amount_cents: 500 }]);
  });

  it("expired bids stop counting and the minimum drops back", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    await placeAndPayBid(gw, A.owner, A.business.id, 900);
    await pool().query("update bids set expires_at = now() - interval '1 minute' where business_id=$1", [A.business.id]);
    expect(await getLadderInfo(pool())).toMatchObject({ highestCents: 0, minNextCents: 300 });
  });

  it("suspended businesses leave the standings and cannot bid", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const B = await makeApprovedBusiness(gw, "B");
    await placeAndPayBid(gw, A.owner, A.business.id, 900);
    await suspendBusiness(A.admin, A.business.id, "spam");
    expect(await rank(A.business.id)).toBeUndefined();
    expect((await getLadderInfo(pool())).highestCents).toBe(0);
    await expect(startBidCheckout(gw, { userId: A.owner.id, userEmail: A.owner.email, businessId: A.business.id, amountCents: 300 })).rejects.toMatchObject({ code: "not_approved" });
    expect(await rank(B.business.id)).toBe(1);
  });

  it("breaks ties among unbid businesses by approval time, then id", async () => {
    const A = await makeApprovedBusiness(gw, "A");
    const B = await makeApprovedBusiness(gw, "B");
    expect(await rank(A.business.id)).toBe(1);
    expect(await rank(B.business.id)).toBe(2);
  });
});

describe("concurrency", () => {
  it("8 simultaneous $3 bids: exactly one wins, seven are rejected and queued for automatic refund", async () => {
    const bs = [];
    for (let i = 0; i < 8; i++) bs.push(await makeApprovedBusiness(gw, `C${i}`));
    const payIds: string[] = [];
    for (const b of bs) {
      await startBidCheckout(gw, { userId: b.owner.id, userEmail: b.owner.email, businessId: b.business.id, amountCents: 300 });
      payIds.push((await pool().query("select p.id from payments p join bids x on x.payment_id=p.id where p.business_id=$1", [b.business.id])).rows[0].id);
    }
    const results = await Promise.all(payIds.map((id) => payViaWebhookLogic(id)));
    expect(results.filter((r) => r.outcome === "bid_active")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "bid_rejected")).toHaveLength(7);
    const bids = (await pool().query("select status, count(*)::int n from bids group by status")).rows;
    expect(Object.fromEntries(bids.map((r) => [r.status, r.n]))).toEqual({ active: 1, rejected: 7 });
    const refunds = (await pool().query("select count(*)::int n from refunds where automatic and status='pending'")).rows[0].n;
    expect(refunds).toBe(7);
    // every one of the 8 bid payments has a ledger charge: money movement is never lost, even for rejected bids
    expect((await pool().query("select count(*)::int n from ledger_entries where entry_type='charge' and amount_cents=300")).rows[0].n).toBe(8);
  });

  it("racing bids at different amounts always leave a valid ladder (each activation ≥ previous + $3)", async () => {
    const amounts = [300, 600, 900, 1200, 1500, 1800];
    const bs = [];
    for (let i = 0; i < amounts.length; i++) bs.push(await makeApprovedBusiness(gw, `R${i}`));
    const payIds: string[] = [];
    for (let i = 0; i < bs.length; i++) {
      await startBidCheckout(gw, { userId: bs[i].owner.id, userEmail: bs[i].owner.email, businessId: bs[i].business.id, amountCents: amounts[i] });
      payIds.push((await pool().query("select p.id from payments p join bids x on x.payment_id=p.id where p.business_id=$1", [bs[i].business.id])).rows[0].id);
    }
    await Promise.all(payIds.sort(() => Math.random() - 0.5).map((id) => payViaWebhookLogic(id)));
    const active = (await pool().query("select amount_cents from bids where status='active' order by activated_at")).rows.map((r) => r.amount_cents);
    expect(active.length).toBeGreaterThan(0);
    for (let i = 1; i < active.length; i++) expect(active[i]).toBeGreaterThanOrEqual(active[i - 1] + 300);
    const rejected = (await pool().query("select count(*)::int n from bids where status='rejected'")).rows[0].n;
    expect(rejected + active.length).toBe(amounts.length);
    expect((await getLadderInfo(pool())).highestCents).toBe(active[active.length - 1]);
  });
});
