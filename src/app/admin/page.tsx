import Link from "next/link";
import { pool } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { adminStats } from "@/lib/services/stats";
import { getLadder } from "@/lib/services/ranking";
import { getSettings } from "@/lib/settings";
import { PageTitle, Stat, money, Notice } from "@/components/ui";

export default async function AdminHome() {
  const u = await requirePermission("admin.access");
  const [st, top, s] = await Promise.all([adminStats(), getLadder(pool(), 10), getSettings(pool())]);
  const m = (c: number) => money(c, s.currency);
  const showMoney = can(u.role, "payments.view");
  return (
    <>
      <PageTitle>Overview</PageTitle>
      {(st.pending_approval > 0 || st.refunds_needing_attention > 0) && (
        <div className="mb-6 space-y-2">
          {st.pending_approval > 0 && <Notice tone="warn"><Link className="link" href="/admin/businesses?status=pending_approval">{st.pending_approval} listing{st.pending_approval > 1 ? "s" : ""} awaiting approval</Link></Notice>}
          {st.refunds_needing_attention > 0 && showMoney && <Notice tone="warn"><Link className="link" href="/admin/payments?refunds=attention">{st.refunds_needing_attention} refund{st.refunds_needing_attention > 1 ? "s" : ""} pending or failed</Link></Notice>}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Users" value={st.users} /><Stat label="Businesses" value={st.businesses} sub={`${st.approved} live`} />
        <Stat label="Active bids" value={st.active_bids} /><Stat label="Awaiting approval" value={st.pending_approval} />
        {showMoney && <><Stat label="Listing payments" value={m(st.listingGrossCents)} /><Stat label="Ranking payments" value={m(st.bidGrossCents)} />
          <Stat label="Refunded" value={m(st.refundedCents)} /><Stat label="Net revenue" value={m(st.netRevenueCents)} sub="from the ledger" /></>}
      </div>
      {can(u.role, "reports.view") && <p className="mt-4 text-sm"><a className="link" href="/api/admin/reports/revenue.csv">Download daily revenue report (CSV)</a></p>}
      <h2 className="h-display text-xl mt-8 mb-2">Highest-ranking businesses</h2>
      <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>#</th><th>Business</th><th>Location</th><th>Bid</th></tr></thead>
        <tbody>{top.map((r) => <tr key={r.businessId} className="border-t border-line"><td className="num">{r.rank}</td><td><Link className="link" href={`/business/${r.slug}`}>{r.name}</Link></td><td>{r.city}, {r.countryCode}</td><td className="num">{r.bidCents ? m(r.bidCents) : "—"}</td></tr>)}
          {top.length === 0 && <tr><td colSpan={4} className="text-muted">No live businesses yet.</td></tr>}</tbody></table></div>
    </>
  );
}
