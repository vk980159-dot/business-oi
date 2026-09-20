import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/lib/db";
import { authenticate, createSession, destroySession, getUserBySessionToken, registerUser, verifyPassword } from "../src/lib/auth";
import { can, type Role, type Permission } from "../src/lib/permissions";
import { rateLimit } from "../src/lib/rate-limit";
import { getSettings, updateSettings } from "../src/lib/settings";
import { setUserRole, setUserStatus, setVerification, approveBusiness } from "../src/lib/services/moderation";
import { addCategory } from "../src/lib/services/catalog";
import { FakeGateway, makeApprovedBusiness, makeUser, resetDb } from "./helpers";
import { businessSchema, registerSchema } from "../src/lib/validation";

beforeEach(resetDb);
afterAll(() => pool().end());

describe("auth", () => {
  it("hashes passwords and never stores the session token", async () => {
    const u = await registerUser(pool(), { email: "a@example.com", password: "correct horse battery", name: "A" });
    const row = (await pool().query("select password_hash from users where id=$1", [u.id])).rows[0];
    expect(row.password_hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", row.password_hash)).toBe(true);
    const { token } = await createSession(pool(), u.id);
    expect((await pool().query("select token_hash from sessions")).rows[0].token_hash).not.toBe(token);
    expect((await getUserBySessionToken(pool(), token))?.id).toBe(u.id);
    await destroySession(pool(), token);
    expect(await getUserBySessionToken(pool(), token)).toBeNull();
  });

  it("rejects wrong passwords, unknown emails (same message), duplicate emails, suspended users, expired sessions", async () => {
    const u = await registerUser(pool(), { email: "a@example.com", password: "correct horse battery", name: "A" });
    await expect(authenticate(pool(), "a@example.com", "nope")).rejects.toMatchObject({ code: "bad_credentials" });
    await expect(authenticate(pool(), "ghost@example.com", "nope")).rejects.toMatchObject({ code: "bad_credentials" });
    await expect(registerUser(pool(), { email: "A@EXAMPLE.com", password: "correct horse battery", name: "B" })).rejects.toMatchObject({ code: "email_taken" });
    const { token } = await createSession(pool(), u.id);
    await pool().query("update sessions set expires_at = now() - interval '1 second'");
    expect(await getUserBySessionToken(pool(), token)).toBeNull();
    const { token: t2 } = await createSession(pool(), u.id);
    await pool().query("update users set status='suspended' where id=$1", [u.id]);
    expect(await getUserBySessionToken(pool(), t2)).toBeNull();
    await expect(authenticate(pool(), "a@example.com", "correct horse battery")).rejects.toMatchObject({ code: "suspended" });
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per key and window, then blocks; keys are independent", async () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await rateLimit(pool(), "login:1.2.3.4", 5, 3600));
    expect(results).toEqual([true, true, true, true, true, false, false]);
    expect(await rateLimit(pool(), "login:9.9.9.9", 5, 3600)).toBe(true);
  });
});

describe("role-based access control", () => {
  const matrix: [Role, Permission, boolean][] = [
    ["user", "admin.access", false], ["support", "admin.access", true], ["admin", "admin.access", true],
    ["support", "business.moderate", true], ["support", "business.verify", false], ["support", "payments.view", true],
    ["support", "payments.refund", false], ["support", "users.manage", false], ["support", "settings.manage", false],
    ["support", "catalog.manage", false], ["admin", "payments.refund", true], ["admin", "settings.manage", true],
  ];
  it.each(matrix)("%s / %s → %s", (role, perm, expected) => expect(can(role, perm)).toBe(expected));

  it("service layer refuses privileged actions from lower roles", async () => {
    const gw = new FakeGateway();
    const { business, admin } = await makeApprovedBusiness(gw, "A");
    const support = await makeUser("support"); const user = await makeUser("user");
    await expect(setVerification(support, business.id, "verified")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setVerification(user, business.id, "verified")).rejects.toMatchObject({ code: "forbidden" });
    await expect(approveBusiness(user, business.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserStatus(support, user.id, "suspended")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserRole(support, user.id, "admin")).rejects.toMatchObject({ code: "forbidden" });
    await expect(addCategory(support, "Bakeries")).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateSettings(pool(), support, { listingFeeCents: 5000 })).rejects.toMatchObject({ code: "forbidden" });
    expect((await getSettings(pool())).listingFeeCents).toBe(2500);
    // Only admins verify, and the flag is not set by the failed attempts
    expect((await pool().query("select verification_status from businesses where id=$1", [business.id])).rows[0].verification_status).toBe("unverified");
    await setVerification(admin, business.id, "verified");
    expect((await pool().query("select verification_status, verified_by from businesses where id=$1", [business.id])).rows[0]).toMatchObject({ verification_status: "verified", verified_by: admin.id });
  });

  it("admins cannot suspend or re-role themselves; suspending a user kills their sessions", async () => {
    const admin = await makeUser("admin"); const u = await makeUser("user");
    await expect(setUserStatus(admin, admin.id, "suspended")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserRole(admin, admin.id, "user")).rejects.toMatchObject({ code: "forbidden" });
    await createSession(pool(), u.id);
    await setUserStatus(admin, u.id, "suspended");
    expect((await pool().query("select count(*)::int n from sessions where user_id=$1", [u.id])).rows[0].n).toBe(0);
  });
});

describe("admin settings", () => {
  it("validates values and writes an audit entry", async () => {
    const admin = await makeUser("admin");
    await expect(updateSettings(pool(), admin, { minIncrementCents: 0 })).rejects.toMatchObject({ code: "invalid_setting" });
    await expect(updateSettings(pool(), admin, { checkoutHoldMinutes: 5 })).rejects.toMatchObject({ code: "invalid_setting" });
    await updateSettings(pool(), admin, { minIncrementCents: 500, startingBidCents: 500 });
    expect(await getSettings(pool())).toMatchObject({ minIncrementCents: 500, startingBidCents: 500 });
    expect((await pool().query("select count(*)::int n from audit_logs where action='settings.update'")).rows[0].n).toBe(2);
  });
});

describe("input validation", () => {
  const good = {
    name: "Acme Plumbing", categoryId: "2", countryCode: "us", city: "Austin", address: "1 Main St", phone: "(512) 555-0100",
    email: "a@acme.test", website: "https://acme.test", description: "A family plumbing business serving Austin for decades.",
    services: "drains, heaters\nleaks", keywords: "plumber", logoUrl: "", imageUrls: "", timezone: "America/Chicago",
  };
  it("normalises a valid business and phone number to E.164", () => {
    const r = businessSchema.safeParse(good);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBe("+15125550100");
      expect(r.data.countryCode).toBe("US");
      expect(r.data.services).toEqual(["drains", "heaters", "leaks"]);
    }
  });
  it.each([
    ["javascript: URL as website", { website: "javascript:alert(1)" }],
    ["http-less logo", { logoUrl: "data:image/png;base64,AAAA" }],
    ["bad phone", { phone: "12" }],
    ["bad timezone", { timezone: "Mars/Olympus" }],
    ["short description", { description: "too short" }],
    ["bad email", { email: "nope" }],
  ])("rejects %s", (_n, over) => expect(businessSchema.safeParse({ ...good, ...over }).success).toBe(false));
  it("enforces password length and the bcrypt 72-byte limit", () => {
    expect(registerSchema.safeParse({ email: "a@b.co", name: "A", password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", name: "A", password: "x".repeat(80) }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", name: "A", password: "a decent passphrase" }).success).toBe(true);
  });
});
