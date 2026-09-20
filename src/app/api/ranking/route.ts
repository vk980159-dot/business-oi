import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getLadder, getLadderInfo } from "@/lib/services/ranking";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { ipFromHeaders } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Public, read-only ranking snapshot used by the live board. */
export async function GET(req: Request) {
  const ip = ipFromHeaders(req.headers);
  if (!(await rateLimit(pool(), `ranking:${ip}`, 90, 60))) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 10, 1), 25);
  const [ladder, info, s] = await Promise.all([getLadder(pool(), limit), getLadderInfo(pool()), getSettings(pool())]);
  return NextResponse.json(
    { ladder, highestCents: info.highestCents, minNextCents: info.minNextCents, currency: s.currency },
    { headers: { "Cache-Control": "no-store" } },
  );
}
