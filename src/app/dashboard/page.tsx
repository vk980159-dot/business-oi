import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listOwnedBusinesses } from "@/lib/services/business";
import { StatusBadge, PageTitle, money } from "@/components/ui";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My businesses", robots: { index: false } };

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  const [list, s] = await Promise.all([listOwnedBusinesses(pool(), user.id), getSettings(pool())]);
  return (
    <>
      <PageTitle sub={`Listing a business costs ${money(s.listingFeeCents, s.currency)}, paid at the end, after you submit the details.`}>My businesses</PageTitle>
      <div className="flex gap-3 mb-6">
        <Link href="/dashboard/business/new" className="btn-primary">Add a business</Link>
        <Link href="/dashboard/payments" className="btn-quiet">Payments and invoices</Link>
        <Link href="/dashboard/account" className="btn-quiet">Account</Link>
      </div>
      {list.length === 0 ? (
        <div className="panel p-8 text-center"><p className="font-medium">You haven't added a business yet.</p><p className="text-sm text-muted mt-1">Add your details first. You'll see the fee and terms before you pay.</p></div>
      ) : (
        <div className="panel overflow-x-auto"><table className="w-full">
          <thead><tr><th>Business</th><th>Status</th><th>Rank</th><th>Current bid</th><th></th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.id} className="border-t border-line">
              <td><p className="font-medium">{b.name}</p><p className="text-xs text-muted">{b.city}, {b.country_code}</p></td>
              <td><StatusBadge status={b.status} /></td>
              <td className="num">{b.rank ? `#${b.rank}` : "—"}</td>
              <td className="num">{b.status === "approved" ? (b.bid_cents > 0 ? money(b.bid_cents, s.currency) : "No bid") : "—"}</td>
              <td className="text-right"><Link className="link" href={`/dashboard/business/${b.id}`}>Manage</Link></td>
            </tr>))}</tbody></table></div>
      )}
    </>
  );
}
