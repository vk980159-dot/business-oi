import type { Db } from "./db";

/**
 * Fixed-window limiter stored in Postgres so it holds across server instances.
 * Returns true when the call is allowed.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number): Promise<boolean> {
  const res = await db.query(
    `insert into rate_limits(key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [key, windowSec],
  );
  if (Math.random() < 0.01) await db.query("delete from rate_limits where window_start < now() - interval '1 day'");
  return res.rows[0].count <= limit;
}
