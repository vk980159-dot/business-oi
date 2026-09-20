import { pool } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { userRoleAction, userStatusAction } from "@/lib/actions/admin";
import { PageTitle, date } from "@/components/ui";

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requirePermission("users.manage");
  const { q } = await searchParams;
  const rows = (await pool().query(
    `select u.id, u.name, u.email, u.role, u.status, u.created_at, (select count(*)::int from businesses b where b.owner_id = u.id) as businesses
     from users u ${q?.trim() ? "where u.email ilike $1 or u.name ilike $1" : ""} order by u.created_at desc limit 100`, q?.trim() ? [`%${q.trim().replace(/[\\%_]/g, "\\$&")}%`] : [])).rows;
  return (
    <>
      <PageTitle>Users</PageTitle>
      <form className="mb-4 flex gap-2" role="search"><input className="input max-w-xs" name="q" defaultValue={q} placeholder="Name or email" aria-label="Search users" /><button className="btn-quiet">Search</button></form>
      <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>User</th><th>Joined</th><th>Listings</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.id} className="border-t border-line"><td><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></td><td>{date(u.created_at)}</td><td className="num">{u.businesses}</td>
            <td>{u.id === me.id ? <span className="text-muted">{u.role} (you)</span> : (
              <ActionForm action={userRoleAction.bind(null, u.id)} className="flex gap-2 items-center"><select name="role" defaultValue={u.role} className="input w-28" aria-label="Role"><option>user</option><option>support</option><option>admin</option></select><SubmitButton className="btn-quiet">Set</SubmitButton></ActionForm>)}</td>
            <td>{u.id === me.id ? u.status : (
              <ActionForm action={userStatusAction.bind(null, u.id, u.status === "active" ? "suspended" : "active")} inline><span className="text-sm mr-2">{u.status}</span><SubmitButton className="btn-quiet">{u.status === "active" ? "Suspend" : "Reactivate"}</SubmitButton></ActionForm>)}</td></tr>))}</tbody></table></div>
    </>
  );
}
