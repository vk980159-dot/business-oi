"use server";
import { revalidatePath } from "next/cache";
import { requirePermission, clientIp } from "@/lib/session";
import { run, type FormState } from "@/lib/form";
import { AppError } from "@/lib/errors";
import { pool } from "@/lib/db";
import { getGateway } from "@/lib/payments";
import { dollarsToCents, reasonSchema, firstError } from "@/lib/validation";
import { updateSettings } from "@/lib/settings";
import * as mod from "@/lib/services/moderation";
import * as cat from "@/lib/services/catalog";
import { requestRefund, retryRefund } from "@/lib/services/refunds";
import type { Role } from "@/lib/permissions";

const reason = (fd: FormData) => {
  const r = reasonSchema.safeParse(fd.get("reason"));
  if (!r.success) throw new AppError("reason_required", firstError(r.error));
  return r.data;
};
const done = (msg: string, path = "/admin") => { revalidatePath(path, "layout"); return { ok: msg }; };

export async function approveAction(id: string, _: FormState): Promise<FormState> {
  return run(async () => { const a = await requirePermission("business.moderate"); await mod.approveBusiness(a, id, { ip: await clientIp() }); return done("Approved."); });
}
export async function rejectAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => { const a = await requirePermission("business.moderate"); await mod.rejectBusiness(a, id, reason(fd), { ip: await clientIp() }); return done("Rejected. Remember to refund the listing fee if appropriate."); });
}
export async function suspendAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => { const a = await requirePermission("business.moderate"); await mod.suspendBusiness(a, id, reason(fd), { ip: await clientIp() }); return done("Suspended."); });
}
export async function reinstateAction(id: string, _: FormState): Promise<FormState> {
  return run(async () => { const a = await requirePermission("business.moderate"); await mod.reinstateBusiness(a, id, { ip: await clientIp() }); return done("Reinstated."); });
}
export async function verifyAction(id: string, status: "unverified" | "verified", _: FormState): Promise<FormState> {
  return run(async () => { const a = await requirePermission("business.verify"); await mod.setVerification(a, id, status, { ip: await clientIp() }); return done(status === "verified" ? "Marked verified." : "Verification removed."); });
}
export async function refundAction(paymentId: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const a = await requirePermission("payments.refund");
    const amountRaw = String(fd.get("amount") ?? "").trim();
    const cents = amountRaw ? dollarsToCents(amountRaw) : undefined;
    if (amountRaw && cents === null) return { error: "Enter a refund amount like 5 or 5.50, or leave blank for a full refund." };
    const r = await requestRefund(getGateway(), a, { paymentId, amountCents: cents ?? undefined, reason: reason(fd), ip: await clientIp() });
    revalidatePath("/admin", "layout");
    return r.status === "succeeded" ? { ok: "Refunded." } : { error: "Stripe did not complete the refund. It is saved as failed; you can retry it." };
  });
}
export async function retryRefundAction(refundId: string, _: FormState): Promise<FormState> {
  return run(async () => {
    const a = await requirePermission("payments.refund");
    const r = await retryRefund(getGateway(), a, refundId);
    revalidatePath("/admin", "layout");
    return r.status === "succeeded" ? { ok: "Refunded." } : { error: "Still failing. Check the Stripe dashboard." };
  });
}
export async function userStatusAction(id: string, status: "active" | "suspended", _: FormState): Promise<FormState> {
  return run(async () => { const a = await requirePermission("users.manage"); await mod.setUserStatus(a, id, status, { ip: await clientIp() }); return done("Updated."); });
}
export async function userRoleAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const a = await requirePermission("users.manage");
    const role = String(fd.get("role"));
    if (!["user", "support", "admin"].includes(role)) return { error: "Unknown role." };
    await mod.setUserRole(a, id, role as Role, { ip: await clientIp() });
    return done("Role updated.");
  });
}
export async function settingsAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const a = await requirePermission("settings.manage");
    const money = (k: string) => { const c = dollarsToCents(String(fd.get(k) ?? "")); if (c === null) throw new AppError("invalid_setting", `Enter a valid amount for ${k}.`); return c; };
    const int = (k: string) => Number(String(fd.get(k) ?? ""));
    await updateSettings(pool(), a, {
      listingFeeCents: money("listingFee"), startingBidCents: money("startingBid"), minIncrementCents: money("minIncrement"), maxBidCents: money("maxBid"),
      bidDurationDays: int("bidDurationDays"), checkoutHoldMinutes: int("checkoutHoldMinutes"), refundPolicy: String(fd.get("refundPolicy") ?? "").slice(0, 4000),
    }, await clientIp());
    return done("Settings saved. New values apply to new checkouts and bids immediately.", "/admin");
  });
}
export async function addCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => { const a = await requirePermission("catalog.manage"); await cat.addCategory(a, String(fd.get("name") ?? "")); return done("Category added."); });
}
export async function toggleCategoryAction(id: number, active: boolean, _: FormState): Promise<FormState> {
  return run(async () => { const a = await requirePermission("catalog.manage"); await cat.setCategoryActive(a, id, active); return done("Updated."); });
}
export async function addCountryAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => { const a = await requirePermission("catalog.manage"); await cat.addCountry(a, String(fd.get("code") ?? ""), String(fd.get("name") ?? "")); return done("Country saved."); });
}
export async function toggleCountryAction(code: string, active: boolean, _: FormState): Promise<FormState> {
  return run(async () => { const a = await requirePermission("catalog.manage"); await cat.setCountryActive(a, code, active); return done("Updated."); });
}
