import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/lib/db";
import { searchBusinesses } from "../src/lib/services/search";
import { setVerification, suspendBusiness } from "../src/lib/services/moderation";
import { FakeGateway, makeApprovedBusiness, placeAndPayBid, bizInput, resetDb } from "./helpers";

let gw: FakeGateway;
let a: Awaited<ReturnType<typeof makeApprovedBusiness>>, b: typeof a, c: typeof a;
beforeEach(async () => {
  await resetDb(); gw = new FakeGateway();
  a = await makeApprovedBusiness(gw, "A", bizInput({ name: "Alpha Pipes", city: "Austin", countryCode: "US", categoryId: 2, services: ["leak repair"] }));
  b = await makeApprovedBusiness(gw, "B", bizInput({ name: "Berlin Bistro", city: "Berlin", countryCode: "DE", categoryId: 1, services: ["catering"], keywords: ["brunch"] }));
  c = await makeApprovedBusiness(gw, "C", bizInput({ name: "Chai Corner", city: "Ludhiana", countryCode: "IN", categoryId: 1, services: ["tea"] }));
});
afterAll(() => pool().end());
const names = async (p: Parameters<typeof searchBusinesses>[1]) => (await searchBusinesses(pool(), p)).hits.map((h) => h.name);

describe("search", () => {
  it("orders strictly by ranking bid, highest first", async () => {
    await placeAndPayBid(gw, c.owner, c.business.id, 300);
    await placeAndPayBid(gw, a.owner, a.business.id, 600);
    expect(await names({})).toEqual(["Alpha Pipes", "Chai Corner", "Berlin Bistro"]);
    const r = await searchBusinesses(pool(), {});
    expect(r.hits.map((h) => [h.rank, h.bidCents])).toEqual([[1, 600], [2, 300], [3, 0]]);
  });

  it("filters by country, city, category, verified, and top-N", async () => {
    expect(await names({ country: "de" })).toEqual(["Berlin Bistro"]);
    expect(await names({ city: "LUDHIANA" })).toEqual(["Chai Corner"]);
    expect((await names({ categoryId: 1 })).sort()).toEqual(["Berlin Bistro", "Chai Corner"]);
    expect(await names({ verifiedOnly: true })).toEqual([]);
    await setVerification(a.admin, b.business.id, "verified");
    expect(await names({ verifiedOnly: true })).toEqual(["Berlin Bistro"]);
    expect(await names({ topN: 1 })).toHaveLength(1);
  });

  it("matches by name, service, keyword, category and country text", async () => {
    expect(await names({ q: "alpha" })).toEqual(["Alpha Pipes"]);
    expect(await names({ q: "catering" })).toEqual(["Berlin Bistro"]);
    expect(await names({ q: "brunch" })).toEqual(["Berlin Bistro"]);
    expect(await names({ q: "plumbing" })).toEqual(["Alpha Pipes"]);
    expect(await names({ q: "india" })).toEqual(["Chai Corner"]);
    expect(await names({ q: "zzzz-nothing" })).toEqual([]);
  });

  it("treats input as data: LIKE wildcards and SQL fragments do not match everything or break", async () => {
    expect(await names({ q: "%" })).toEqual([]);
    expect(await names({ q: "_" })).toEqual([]);
    expect(await names({ q: "'; drop table businesses; --" })).toEqual([]);
    expect((await pool().query("select count(*)::int n from businesses")).rows[0].n).toBe(3);
  });

  it("hides suspended businesses and paginates", async () => {
    await suspendBusiness(a.admin, a.business.id, "test");
    expect(await names({})).not.toContain("Alpha Pipes");
    const p1 = await searchBusinesses(pool(), { pageSize: 1, page: 1 });
    const p2 = await searchBusinesses(pool(), { pageSize: 1, page: 2 });
    expect(p1.total).toBe(2);
    expect(p1.hits[0].id).not.toBe(p2.hits[0].id);
  });
});
