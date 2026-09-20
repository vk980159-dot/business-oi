import { tx, pool } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { assertCan, type Role } from "../permissions";
import { destroyAllSessions } from "../auth";

type Actor = { id: string; role: Role };
type Ctx = { ip?: string | null };

async function lockBusiness(c: import("pg").PoolClient, id: string) {
  const b = (await c.query("select * from businesses where id = $1 for update", [id])).rows[0];
  if (!b) throw new AppError("not_found", "Business not found.");
  return b;
}
const hasLiveListingPayment = async (c: import("pg").PoolClient, id: string) =>
  ((await c.query("select 1 from payments where business_id = $1 and kind = 'listing' and status in ('paid','partially_refunded')", [id])).rowCount ?? 0) > 0;

export async function approveBusiness(actor: Actor, id: string, ctx: Ctx = {}) {
  assertCan(actor.role, "business.moderate");
  await tx(async (c) => {
    const b = await lockBusiness(c, id);
    if (b.status !== "pending_approval") throw new AppError("invalid_state", "Only listings awaiting approval can be approved.");
    if (!(await hasLiveListingPayment(c, id))) throw new AppError("unpaid", "The listing fee has not been paid.");
    await c.query("update businesses set status='approved', status_note=null, approved_at=coalesce(approved_at, now()), updated_at=now() where id=$1", [id]);
    await audit(c, { actorId: actor.id, action: "business.approved", entityType: "business", entityId: id, ip: ctx.ip });
  });
}

export async function rejectBusiness(actor: Actor, id: string, reason: string, ctx: Ctx = {}) {
  assertCan(actor.role, "business.moderate");
  if (!reason.trim()) throw new AppError("reason_required", "Give the owner a reason.");
  await tx(async (c) => {
    const b = await lockBusiness(c, id);
    if (b.status !== "pending_approval") throw new AppError("invalid_state", "Only listings awaiting approval can be rejected.");
    await c.query("update businesses set status='rejected', status_note=$2, updated_at=now() where id=$1", [id, reason.trim()]);
    await audit(c, { actorId: actor.id, action: "business.rejected", entityType: "business", entityId: id, meta: { reason }, ip: ctx.ip });
  });
}

export async function suspendBusiness(actor: Actor, id: string, reason: string, ctx: Ctx = {}) {
  assertCan(actor.role, "business.moderate");
  if (!reason.trim()) throw new AppError("reason_required", "Give a reason for the suspension.");
  await tx(async (c) => {
    const b = await lockBusiness(c, id);
    if (b.status !== "approved") throw new AppError("invalid_state", "Only approved listings can be suspended.");
    await c.query("update businesses set status='suspended', status_note=$2, updated_at=now() where id=$1", [id, reason.trim()]);
    await audit(c, { actorId: actor.id, action: "business.suspended", entityType: "business", entityId: id, meta: { reason }, ip: ctx.ip });
  });
}

export async function reinstateBusiness(actor: Actor, id: string, ctx: Ctx = {}) {
  assertCan(actor.role, "business.moderate");
  await tx(async (c) => {
    const b = await lockBusiness(c, id);
    if (b.status !== "suspended") throw new AppError("invalid_state", "Only suspended listings can be reinstated.");
    if (!(await hasLiveListingPayment(c, id))) throw new AppError("unpaid", "This listing has no live listing payment (it may have been refunded).");
    await c.query("update businesses set status='approved', status_note=null, updated_at=now() where id=$1", [id]);
    await audit(c, { actorId: actor.id, action: "business.reinstated", entityType: "business", entityId: id, ip: ctx.ip });
  });
}

/** Only an admin can mark a business Verified: the label must reflect a manual check, never a self-claim. */
export async function setVerification(actor: Actor, id: string, status: "unverified" | "pending" | "verified", ctx: Ctx = {}) {
  assertCan(actor.role, "business.verify");
  await tx(async (c) => {
    await lockBusiness(c, id);
    await c.query(
      `update businesses set verification_status = $2::verification_status,
         verified_at = case when $2::text = 'verified' then now() else null end,
         verified_by = case when $2::text = 'verified' then $3::uuid else null end, updated_at = now() where id = $1`,
      [id, status, actor.id],
    );
    await audit(c, { actorId: actor.id, action: `business.verification.${status}`, entityType: "business", entityId: id, ip: ctx.ip });
  });
}

/** Owners can ask for verification; that only moves the status to "pending". */
export async function requestVerification(ownerId: string, businessId: string) {
  const r = await pool().query(
    "update businesses set verification_status='pending', updated_at=now() where id=$1 and owner_id=$2 and verification_status='unverified' and status='approved' returning id",
    [businessId, ownerId],
  );
  if (r.rowCount === 0) throw new AppError("invalid_state", "Verification can only be requested once, for an approved listing.");
  await audit(pool(), { actorId: ownerId, action: "business.verification.requested", entityType: "business", entityId: businessId });
}

export async function setUserStatus(actor: Actor, userId: string, status: "active" | "suspended", ctx: Ctx = {}) {
  assertCan(actor.role, "users.manage");
  if (actor.id === userId) throw new AppError("forbidden", "You cannot change your own status.");
  await tx(async (c) => {
    const r = await c.query("update users set status=$2 where id=$1 returning id", [userId, status]);
    if (r.rowCount === 0) throw new AppError("not_found", "User not found.");
    if (status === "suspended") await destroyAllSessions(c, userId);
    await audit(c, { actorId: actor.id, action: `user.${status}`, entityType: "user", entityId: userId, ip: ctx.ip });
  });
}

export async function setUserRole(actor: Actor, userId: string, role: Role, ctx: Ctx = {}) {
  assertCan(actor.role, "users.manage");
  if (actor.id === userId) throw new AppError("forbidden", "You cannot change your own role.");
  await tx(async (c) => {
    const r = await c.query("update users set role=$2 where id=$1 returning id", [userId, role]);
    if (r.rowCount === 0) throw new AppError("not_found", "User not found.");
    await audit(c, { actorId: actor.id, action: "user.role_changed", entityType: "user", entityId: userId, meta: { role }, ip: ctx.ip });
  });
}
