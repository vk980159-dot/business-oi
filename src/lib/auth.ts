import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "./db";
import { AppError } from "./errors";
import type { Role } from "./permissions";

export type SessionUser = { id: string; email: string; name: string; role: Role; status: "active" | "suspended" };

const SESSION_DAYS = 14;
// Cost 12 in production; a cheap cost under test so the suite stays fast. Never set NODE_ENV=test in prod.
const BCRYPT_COST = process.env.NODE_ENV === "test" ? 4 : 12;
// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_COST);

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function registerUser(db: Db, input: { email: string; password: string; name: string }) {
  const hash = await hashPassword(input.password);
  try {
    const res = await db.query(
      "insert into users(email, password_hash, name) values ($1,$2,$3) returning id, email, name, role, status",
      [input.email.trim(), hash, input.name.trim()],
    );
    return res.rows[0] as SessionUser;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AppError("email_taken", "An account with this email already exists.");
    throw e;
  }
}

export async function authenticate(db: Db, email: string, password: string): Promise<SessionUser> {
  const res = await db.query("select id, email, name, role, status, password_hash from users where email = $1", [email.trim()]);
  const u = res.rows[0];
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new AppError("bad_credentials", "Email or password is incorrect.");
  if (u.status !== "active") throw new AppError("suspended", "This account is suspended. Contact support.");
  const { password_hash: _omit, ...user } = u;
  return user as SessionUser;
}

export async function createSession(db: Db, userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query("insert into sessions(user_id, token_hash, expires_at) values ($1,$2,$3)", [userId, sha256(token), expiresAt]);
  return { token, expiresAt };
}

export async function getUserBySessionToken(db: Db, token: string): Promise<SessionUser | null> {
  const res = await db.query(
    `select u.id, u.email, u.name, u.role, u.status from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'`,
    [sha256(token)],
  );
  return (res.rows[0] as SessionUser) ?? null;
}

export async function destroySession(db: Db, token: string) {
  await db.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function destroyAllSessions(db: Db, userId: string) {
  await db.query("delete from sessions where user_id = $1", [userId]);
}
