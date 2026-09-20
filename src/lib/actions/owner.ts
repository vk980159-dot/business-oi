"use server";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { run, type FormState } from "@/lib/form";
import { parseBusinessForm, dollarsToCents, firstError } from "@/lib/validation";
import { createBusiness, updateBusiness } from "@/lib/services/business";
import { requestVerification } from "@/lib/services/moderation";
import { startBidCheckout, startListingCheckout } from "@/lib/services/checkout";
import { getGateway } from "@/lib/payments";

export async function createBusinessAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    if (!(await rateLimit(pool(), `biz-create:${user.id}`, 10, 3600))) throw new AppError("rate_limited", "Too many listings created. Try again later.");
    const p = parseBusinessForm(fd);
    if (!p.success) return { error: firstError(p.error) };
    const b = await createBusiness(pool(), user.id, p.data);
    redirect(`/dashboard/business/${b.id}`);
  });
}

export async function updateBusinessAction(businessId: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    const p = parseBusinessForm(fd);
    if (!p.success) return { error: firstError(p.error) };
    await updateBusiness(pool(), user.id, businessId, p.data);
    return { ok: "Changes saved." };
  });
}

async function checkoutGuard(userId: string) {
  if (!(await rateLimit(pool(), `checkout:${userId}`, 12, 600))) throw new AppError("rate_limited", "Too many checkout attempts. Wait a few minutes.");
}

export async function payListingAction(businessId: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    await checkoutGuard(user.id);
    const url = await startListingCheckout(getGateway(), { userId: user.id, userEmail: user.email, businessId, acceptTerms: fd.get("acceptTerms") === "on" });
    redirect(url);
  });
}

export async function placeBidAction(businessId: string, _: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    await checkoutGuard(user.id);
    const cents = dollarsToCents(String(fd.get("amount") ?? ""));
    if (cents === null) return { error: "Enter a bid like 9 or 9.50." };
    if (fd.get("acceptTerms") !== "on") return { error: "Please accept the bidding terms." };
    const url = await startBidCheckout(getGateway(), { userId: user.id, userEmail: user.email, businessId, amountCents: cents });
    redirect(url);
  });
}

export async function requestVerificationAction(businessId: string, _: FormState): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    await requestVerification(user.id, businessId);
    return { ok: "Verification requested. We'll review it manually." };
  });
}
