import Link from "next/link";
import { pool } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { approveAction, rejectAction, suspendAction, reinstateAction, verifyAction } from "@/lib/actions/admin";
import { PageTitle, StatusBadge, VerifiedBadge, date } from "@/components/ui";

const STATUSES = ["pending_approval", "approved", "suspended", "rejected", "draft"];

export default async function AdminBusinesses({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const u = await requirePermission("business.moderate");
  const { status, q } = await searchParams;
  const args: unknown[] = []; const where: string[] = [];
  if (status && STATUSES.includes(status)) { args.push(status); where.push(`b.status = $${args.length}`); }
  if (q?.trim()) { args.push(`%${q.trim().replace(/[\\%_]/g, "\\$&")}%`); where.push(`(b.name ilike $${args.length} or u.email ilike $${args.length})`); }
  const rows = (await pool().query(
    `select b.id, b.name, b.slug, b.status, b.status_note, b.verification_status, b.city, b.country_code, b.created_at, u.email as owner_email, c.name as category
     from businesses b join users u on u.id = b.owner_id join categories c on c.id = b.category_id
     ${where.length ? "where " + where.join(" and ") : ""} order by (b.status = 'pending_approval') desc, b.created_at desc limit 100`, args)).rows;
  const canVerify = can(u.role, "business.verify");
  return (
    <>
      <PageTitle>Businesses</PageTitle>
      <form className="flex flex-wrap gap-2 mb-4" role="search">
        <input className="input max-w-xs" name="q" placeholder="Business or owner email" defaultValue={q} aria-label="Search" />
        <select className="input max-w-[12rem]" name="status" defaultValue={status ?? ""} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <button className="btn-quiet">Filter</button>
      </form>
      <div className="space-y-3">
        {rows.map((b) => (
          <div key={b.id} className="panel p-4">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div><p className="font-semibold">{b.name} <span className="font-normal text-muted text-sm">· {b.category} · {b.city}, {b.country_code}</span></p>
                <p className="text-xs text-muted">{b.owner_email} · created {date(b.created_at)}</p></div>
              <div className="flex gap-2 items-center"><StatusBadge status={b.status} /><VerifiedBadge status={b.verification_status} />{b.status === "approved" && <Link className="link text-sm" href={`/business/${b.slug}`}>Public page</Link>}</div>
            </div>
            {b.status_note && <p className="text-sm text-muted mt-1">Note: {b.status_note}</p>}
            <div className="mt-3 flex flex-wrap gap-3 items-start">
              {b.status === "pending_approval" && (<>
                <ActionForm action={approveAction.bind(null, b.id)} inline><SubmitButton>Approve</SubmitButton></ActionForm>
                <ActionForm action={rejectAction.bind(null, b.id)} className="flex gap-2"><input className="input w-56" name="reason" placeholder="Reason shown to owner" required /><SubmitButton className="btn-danger">Reject</SubmitButton></ActionForm></>)}
              {b.status === "approved" && <ActionForm action={suspendAction.bind(null, b.id)} className="flex gap-2"><input className="input w-56" name="reason" placeholder="Reason for suspension" required /><SubmitButton className="btn-danger">Suspend</SubmitButton></ActionForm>}
              {b.status === "suspended" && <ActionForm action={reinstateAction.bind(null, b.id)} inline><SubmitButton className="btn-quiet">Reinstate</SubmitButton></ActionForm>}
              {canVerify && b.verification_status !== "verified" && b.status === "approved" && <ActionForm action={verifyAction.bind(null, b.id, "verified")} inline><SubmitButton className="btn-quiet">Mark verified</SubmitButton></ActionForm>}
              {canVerify && b.verification_status === "verified" && <ActionForm action={verifyAction.bind(null, b.id, "unverified")} inline><SubmitButton className="btn-quiet">Remove verification</SubmitButton></ActionForm>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="panel p-6 text-muted text-center">Nothing matches.</div>}
      </div>
    </>
  );
}
