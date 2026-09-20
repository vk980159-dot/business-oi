import { pool } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { refundAction, retryRefundAction } from "@/lib/actions/admin";
import { PageTitle, StatusBadge, money, date } from "@/components/ui";

export default async function AdminPayments({ searchParams }: { searchParams: Promise<{ refunds?: string; kind?: string }> }) {
  const u = await requirePermission("payments.view");
  const { refunds, kind } = await searchParams;
  const canRefund = can(u.role, "payments.refund");
  const attention = (await pool().query(
    `select r.*, b.name as business_name, p.amount_cents as payment_cents, p.currency from refunds r join payments p on p.id = r.payment_id join businesses b on b.id = p.business_id
     where r.status in ('pending','failed') order by r.created_at`)).rows;
  const payments = (await pool().query(
    `select p.*, b.name as business_name, u.email from payments p join businesses b on b.id = p.business_id join users u on u.id = p.user_id
     ${kind === "listing" || kind === "bid" ? "where p.kind = '" + kind + "'" : ""} order by p.created_at desc limit 100`)).rows;
  return (
    <>
      <PageTitle sub="Payments become “Paid” only after a verified Stripe webhook. Refunds are sent to Stripe and recorded in the ledger.">Payments and refunds</PageTitle>
      {attention.length > 0 && (
        <section className="mb-8"><h2 className="h-display text-xl mb-2">Refunds needing attention</h2>
          <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>Created</th><th>Business</th><th>Amount</th><th>Status</th><th>Reason</th><th></th></tr></thead>
            <tbody>{attention.map((r) => (
              <tr key={r.id} className="border-t border-line"><td>{date(r.created_at)}</td><td>{r.business_name}</td><td className="num">{money(r.amount_cents, r.currency)}</td><td><StatusBadge status={r.status} />{r.failure_reason && <p className="text-xs text-danger mt-1">{r.failure_reason}</p>}</td><td className="text-xs">{r.reason}</td>
                <td>{canRefund && <ActionForm action={retryRefundAction.bind(null, r.id)} inline><SubmitButton className="btn-quiet">{r.status === "failed" ? "Retry" : "Process now"}</SubmitButton></ActionForm>}</td></tr>))}</tbody></table></div></section>
      )}
      <div className="flex gap-3 text-sm mb-2"><a className="link" href="/admin/payments">All</a><a className="link" href="/admin/payments?kind=listing">Listing fees</a><a className="link" href="/admin/payments?kind=bid">Ranking bids</a></div>
      <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>Date</th><th>Business / payer</th><th>Type</th><th>Amount</th><th>Status</th><th>Invoice</th><th>Refund</th></tr></thead>
        <tbody>{payments.map((p) => (
          <tr key={p.id} className="border-t border-line"><td>{date(p.paid_at ?? p.created_at)}</td><td><p>{p.business_name}</p><p className="text-xs text-muted">{p.email}</p></td><td>{p.kind === "listing" ? "Listing" : "Bid"}</td>
            <td className="num">{money(p.amount_cents, p.currency)}{p.refunded_cents > 0 && <p className="text-xs text-muted">−{money(p.refunded_cents, p.currency)}</p>}</td>
            <td><StatusBadge status={p.status} />{p.failure_reason && <p className="text-xs text-danger mt-1 max-w-[16rem]">{p.failure_reason}</p>}</td>
            <td>{p.invoice_number ? <a className="link" href={`/api/invoices/${p.id}`}>{p.invoice_number}</a> : "—"}</td>
            <td>{canRefund && (p.status === "paid" || p.status === "partially_refunded") && (
              <ActionForm action={refundAction.bind(null, p.id)} className="flex flex-col gap-1 w-44"><input className="input" name="amount" placeholder="Amount (blank = all)" aria-label="Refund amount" /><input className="input" name="reason" placeholder="Reason" required aria-label="Refund reason" /><SubmitButton className="btn-danger">Refund</SubmitButton></ActionForm>)}</td></tr>))}</tbody></table></div>
    </>
  );
}
