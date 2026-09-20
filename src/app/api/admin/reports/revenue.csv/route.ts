import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Daily ledger totals by payment type. Values are dates and integers only, so there is no CSV-injection surface. */
export async function GET() {
  const u = await getCurrentUser();
  if (!u || !can(u.role, "reports.view")) return new NextResponse("Not found", { status: 404 });
  const rows = (await pool().query(
    `select to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD') as day, p.kind::text as kind, l.currency,
       sum(case when l.entry_type = 'charge' then l.amount_cents else 0 end)::int as charges_cents,
       sum(case when l.entry_type = 'refund' then -l.amount_cents else 0 end)::int as refunds_cents,
       sum(l.amount_cents)::int as net_cents
     from ledger_entries l join payments p on p.id = l.payment_id group by 1, 2, 3 order by 1 desc, 2`)).rows;
  const csv = ["date_utc,payment_type,currency,charges_cents,refunds_cents,net_cents", ...rows.map((r) => [r.day, r.kind, r.currency, r.charges_cents, r.refunds_cents, r.net_cents].join(","))].join("\n");
  return new NextResponse(csv + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="revenue.csv"', "Cache-Control": "private, no-store" } });
}
