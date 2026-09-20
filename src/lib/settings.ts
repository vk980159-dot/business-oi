import type { Db } from "./db";
import { AppError } from "./errors";
import { audit } from "./audit";
import { assertCan, type Role } from "./permissions";

export type Settings = {
  listingFeeCents: number;
  startingBidCents: number;
  minIncrementCents: number;
  maxBidCents: number;
  bidDurationDays: number;
  checkoutHoldMinutes: number;
  currency: string;
  refundPolicy: string;
};

const KEYS: Record<keyof Settings, string> = {
  listingFeeCents: "listing_fee_cents",
  startingBidCents: "starting_bid_cents",
  minIncrementCents: "min_increment_cents",
  maxBidCents: "max_bid_cents",
  bidDurationDays: "bid_duration_days",
  checkoutHoldMinutes: "checkout_hold_minutes",
  currency: "currency",
  refundPolicy: "refund_policy",
};

export async function getSettings(db: Db): Promise<Settings> {
  const res = await db.query("select key, value from settings");
  const m = new Map<string, unknown>(res.rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(KEYS)) {
    if (!m.has(key)) throw new Error(`Missing setting ${key}`);
    out[field] = m.get(key);
  }
  return out as Settings;
}

const INT_RULES: Partial<Record<keyof Settings, [number, number]>> = {
  listingFeeCents: [50, 10_000_000],       // Stripe minimum charge is ~$0.50
  startingBidCents: [50, 10_000_000],
  minIncrementCents: [1, 10_000_000],
  maxBidCents: [50, 100_000_000],
  bidDurationDays: [1, 365],
  checkoutHoldMinutes: [30, 1440],         // Stripe Checkout sessions live 30 min – 24 h
};

export async function updateSettings(db: Db, actor: { id: string; role: Role }, patch: Partial<Settings>, ip?: string | null) {
  assertCan(actor.role, "settings.manage");
  const actorId = actor.id;
  const cur = await getSettings(db);
  const next = { ...cur, ...patch };
  for (const [field, [min, max]] of Object.entries(INT_RULES) as [keyof Settings, [number, number]][]) {
    const v = next[field] as number;
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new AppError("invalid_setting", `${field} must be a whole number between ${min} and ${max}`);
    }
  }
  if (next.maxBidCents < next.startingBidCents) throw new AppError("invalid_setting", "Maximum bid must be at least the starting bid");
  if (!/^[a-z]{3}$/.test(next.currency)) throw new AppError("invalid_setting", "Currency must be a 3-letter lowercase ISO code");
  for (const field of Object.keys(patch) as (keyof Settings)[]) {
    if (cur[field] === next[field]) continue;
    await db.query(
      "insert into settings(key, value, updated_by, updated_at) values ($1, $2, $3, now()) on conflict (key) do update set value = $2, updated_by = $3, updated_at = now()",
      [KEYS[field], JSON.stringify(next[field]), actorId],
    );
    await audit(db, { actorId, action: "settings.update", entityType: "setting", entityId: KEYS[field], meta: { from: cur[field], to: next[field] }, ip });
  }
  return next;
}

export const formatMoney = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
