import type { PoolClient } from "pg";
import type { Db } from "../db";
import { getSettings } from "../settings";

export type LadderInfo = {
  highestCents: number;
  minNextCents: number;
  leaderBusinessId: string | null;
};

/** Current top bid and the smallest bid that would take #1. Standings is the single source of truth. */
export async function getLadderInfo(db: Db): Promise<LadderInfo> {
  const s = await getSettings(db);
  const top = (await db.query("select business_id, bid_cents from business_standings order by rank limit 1")).rows[0];
  const highest: number = top?.bid_cents ?? 0;
  return {
    highestCents: highest,
    minNextCents: highest > 0 ? highest + s.minIncrementCents : s.startingBidCents,
    leaderBusinessId: highest > 0 ? top.business_id : null,
  };
}

export type LadderRow = { rank: number; businessId: string; slug: string; name: string; bidCents: number; city: string; countryCode: string };

export async function getLadder(db: Db, limit = 10): Promise<LadderRow[]> {
  const res = await db.query(
    `select s.rank, b.id as "businessId", b.slug, b.name, s.bid_cents as "bidCents", b.city, b.country_code as "countryCode"
     from business_standings s join businesses b on b.id = s.business_id
     order by s.rank limit $1`,
    [limit],
  );
  return res.rows;
}

export async function getBusinessStanding(db: Db, businessId: string) {
  const res = await db.query("select rank, bid_cents as \"bidCents\", (select count(*)::int from business_standings) as total from business_standings where business_id = $1", [businessId]);
  return (res.rows[0] as { rank: number; bidCents: number; total: number } | undefined) ?? null;
}

export type ActivationResult = { activated: true } | { activated: false; reason: string };

/**
 * Decides, on the server and under a global lock, whether a *paid* bid takes effect.
 * Must be called inside a transaction. The advisory lock serialises every activation, so the
 * "at least one increment above the current highest bid" rule cannot be raced.
 */
export async function activateBid(c: PoolClient, bidId: string): Promise<ActivationResult> {
  await c.query("select pg_advisory_xact_lock(hashtext('business_oi_ranking'))");
  const bid = (await c.query("select * from bids where id = $1 for update", [bidId])).rows[0];
  if (!bid) return { activated: false, reason: "bid_not_found" };
  if (bid.status !== "pending_payment") return { activated: false, reason: `bid_${bid.status}` };

  const biz = (await c.query("select status from businesses where id = $1", [bid.business_id])).rows[0];
  const s = await getSettings(c);
  const info = await getLadderInfo(c);

  let reason: string | null = null;
  if (!biz || biz.status !== "approved") reason = "business_not_approved";
  else if (info.leaderBusinessId === bid.business_id) reason = "already_leading";
  else if (bid.amount_cents < info.minNextCents) reason = `below_minimum:${info.minNextCents}`;

  if (reason) {
    await c.query("update bids set status = 'rejected', reject_reason = $2 where id = $1", [bidId, reason]);
    return { activated: false, reason };
  }
  await c.query(
    "update bids set status = 'active', activated_at = clock_timestamp(), expires_at = clock_timestamp() + make_interval(days => $2) where id = $1",
    [bidId, s.bidDurationDays],
  );
  return { activated: true };
}
