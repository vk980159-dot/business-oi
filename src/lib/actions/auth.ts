"use server";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { authenticate, registerUser, hashPassword, verifyPassword, destroyAllSessions } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema, registerSchema, firstError } from "@/lib/validation";
import { clientIp, endSession, requireUser, startSession } from "@/lib/session";
import { run, safeNext, type FormState } from "@/lib/form";
import { audit } from "@/lib/audit";
import { z } from "zod";

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(pool(), `register:${ip}`, 10, 3600))) throw new AppError("rate_limited", "Too many sign-ups from this network. Try again in an hour.");
    const p = registerSchema.safeParse({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password") });
    if (!p.success) return { error: firstError(p.error) };
    const u = await registerUser(pool(), p.data);
    await audit(pool(), { actorId: u.id, action: "user.registered", entityType: "user", entityId: u.id, ip });
    await startSession(u.id);
    redirect("/dashboard");
  });
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ip = await clientIp();
    const p = loginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
    if (!p.success) return { error: "Enter your email and password." };
    const okIp = await rateLimit(pool(), `login-ip:${ip}`, 30, 900);
    const okAcct = await rateLimit(pool(), `login-acct:${p.data.email}`, 10, 900);
    if (!okIp || !okAcct) throw new AppError("rate_limited", "Too many sign-in attempts. Wait 15 minutes and try again.");
    const u = await authenticate(pool(), p.data.email, p.data.password);
    await startSession(u.id);
    redirect(safeNext(fd.get("next")));
  });
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

const pwSchema = z.object({ current: z.string().min(1), next: registerSchema.shape.password });
export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    const p = pwSchema.safeParse({ current: fd.get("current"), next: fd.get("next") });
    if (!p.success) return { error: firstError(p.error) };
    const row = (await pool().query("select password_hash from users where id = $1", [user.id])).rows[0];
    if (!(await verifyPassword(p.data.current, row.password_hash))) throw new AppError("bad_credentials", "Current password is incorrect.");
    await pool().query("update users set password_hash = $2 where id = $1", [user.id, await hashPassword(p.data.next)]);
    await destroyAllSessions(pool(), user.id); // sign out everywhere, including other devices
    await audit(pool(), { actorId: user.id, action: "user.password_changed", entityType: "user", entityId: user.id });
    await startSession(user.id);
    return { ok: "Password changed. Other devices were signed out." };
  });
}

export async function updateNameAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireUser();
    const name = z.string().trim().min(1).max(100).safeParse(fd.get("name"));
    if (!name.success) return { error: "Enter your name." };
    await pool().query("update users set name = $2 where id = $1", [user.id, name.data]);
    return { ok: "Saved." };
  });
}
