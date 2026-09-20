import { pool } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { PageTitle, date } from "@/components/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requirePermission("audit.view");
  const { action } = await searchParams;
  const rows = (await pool().query(
    `select a.id, a.action, a.entity_type, a.entity_id, a.meta, a.ip, a.created_at, u.email as actor from audit_logs a left join users u on u.id = a.actor_id
     ${action ? "where a.action like $1" : ""} order by a.id desc limit 200`, action ? [`${action.replace(/[\\%_]/g, "\\$&")}%`] : [])).rows;
  return (
    <>
      <PageTitle sub="Append-only. The database rejects edits and deletes.">Audit log</PageTitle>
      <form className="mb-4 flex gap-2"><input className="input max-w-xs" name="action" placeholder="Action prefix, e.g. refund." defaultValue={action} aria-label="Filter by action" /><button className="btn-quiet">Filter</button></form>
      <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t border-line"><td className="whitespace-nowrap">{date(r.created_at)}</td><td>{r.actor ?? <span className="text-muted">system</span>}</td><td className="font-mono text-xs">{r.action}</td>
            <td className="text-xs">{r.entity_type} <span className="text-muted">{r.entity_id?.slice(0, 8)}</span></td><td className="text-xs text-muted max-w-xs break-words">{JSON.stringify(r.meta)}</td></tr>))}</tbody></table></div>
    </>
  );
}
