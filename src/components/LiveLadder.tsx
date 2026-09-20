"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type LadderRow = { rank: number; businessId: string; slug: string; name: string; bidCents: number; city: string; countryCode: string };
export type LadderData = { ladder: LadderRow[]; highestCents: number; minNextCents: number; currency: string };

const money = (c: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase(), minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);

/** Public ranking board. Polls the server every few seconds (paused while the tab is hidden). */
export default function LiveLadder({ initial, highlightId, limit = 10 }: { initial: LadderData; highlightId?: string; limit?: number }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/ranking?limit=${limit}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json());
        setStale(false);
      } catch { setStale(true); }
    };
    timer.current = setInterval(tick, 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [limit]);

  return (
    <section aria-label="Live ranking" className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 border-b border-line bg-white">
        <div>
          <p className="text-xs text-muted">Highest bid</p>
          <p className="h-display text-2xl num">{data.highestCents ? money(data.highestCents, data.currency) : "No bids yet"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Minimum next bid</p>
          <p className="h-display text-2xl num text-signal">{money(data.minNextCents, data.currency)}</p>
        </div>
      </div>
      {data.ladder.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted">No approved businesses yet. The first listing takes the #1 spot.</p>
      ) : (
        <ol>
          {data.ladder.map((r) => (
            <li key={r.businessId} className={`flex items-center gap-4 px-4 py-3 border-b border-line last:border-b-0 ${r.rank === 1 && r.bidCents > 0 ? "bg-goldsoft border-l-4 border-l-gold" : ""} ${highlightId === r.businessId ? "ring-2 ring-inset ring-signal" : ""}`}>
              <span className="h-display text-3xl w-9 text-right num text-ink/80">{r.rank}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/business/${r.slug}`} className="font-medium hover:underline truncate block">{r.name}</Link>
                <p className="text-xs text-muted truncate">{r.city}, {r.countryCode}</p>
              </div>
              <div className="text-right">
                {r.bidCents > 0 ? (<><p className="num font-semibold">{money(r.bidCents, data.currency)}</p><p className="text-xs text-muted">Paid placement</p></>) : <p className="text-xs text-muted">Standard listing</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="px-4 py-2 text-xs text-muted bg-board/60">
        {stale ? "Couldn't refresh. Showing the last update." : "Refreshes every few seconds. Order: highest active bid, then the earlier bid, then the earlier approval."}
      </p>
    </section>
  );
}
