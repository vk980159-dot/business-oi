import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { pool } from "./db";
import { createSession, destroySession, getUserBySessionToken, type SessionUser } from "./auth";
import { can, type Permission } from "./permissions";

const COOKIE = "boi_session";

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? getUserBySessionToken(pool(), token) : null;
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return u;
}

/** Server-side gate for every admin page and action. Unauthorised users get a 404, not a hint that the page exists. */
export async function requirePermission(p: Permission): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u || !can(u.role, p)) notFound();
  return u;
}

export async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(pool(), userId);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await destroySession(pool(), token);
  jar.delete(COOKIE);
}

/** Only trustworthy behind a proxy that sets/overwrites X-Forwarded-For (Vercel, Cloudflare, most load balancers). */
export function ipFromHeaders(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
export async function clientIp() {
  return ipFromHeaders(await headers());
}
