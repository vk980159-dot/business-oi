import type { Metadata } from "next";
import { pool } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageTitle, StatusBadge, money, date } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payments", robots: { index: false } };

export default async function Payments() {
  const user = await requireUser("/dashboard/payments");
  const rows = (await pool().query(
    `select p.id, p.kind, p.amount_cents, p.currency, p.status, p.invoice_number, p.paid_at, p.created_at, p.refunded_cents, b.name
     from payments p join businesses b on b.id = p.business_id where p.user_id = $1 order by p.created_at desc limit 200`, [user.id])).rows;
  return (
    <>
      <PageTitle>Payments and invoices</PageTitle>
      {rows.length === 0 ? <div className="panel p-8 text-center text-muted">No payments yet.</div> : (
        <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>Date</th><th>Business</th><th>For</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className="border-t border-line"><td>{date(p.paid_at ?? p.created_at)}</td><td>{p.name}</td><td>{p.kind === "listing" ? "Listing fee" : "Ranking bid"}</td>
              <td className="num">{money(p.amount_cents, p.currency)}{p.refunded_cents > 0 && <span className="text-xs text-muted"> (−{money(p.refunded_cents, p.currency)} refunded)</span>}</td>
              <td><StatusBadge status={p.status} /></td><td>{p.invoice_number ? <a className="link" href={`/api/invoices/${p.id}`}>Download {p.invoice_number}</a> : "—"}</td></tr>))}</tbody></table></div>
      )}
    </>
  );
}
