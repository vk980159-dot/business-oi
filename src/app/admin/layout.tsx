import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePermission("admin.access");
  const links: [string, string, boolean][] = [
    ["/admin", "Overview", true], ["/admin/businesses", "Businesses", true], ["/admin/payments", "Payments and refunds", can(u.role, "payments.view")],
    ["/admin/users", "Users", can(u.role, "users.manage")], ["/admin/settings", "Ranking and catalog settings", can(u.role, "settings.manage")], ["/admin/audit", "Audit log", can(u.role, "audit.view")],
  ];
  return (
    <div className="grid md:grid-cols-[13rem_1fr] gap-8">
      <nav aria-label="Admin" className="text-sm space-y-1 md:sticky md:top-4 h-fit">
        <p className="text-xs text-muted mb-2">Signed in as {u.role}</p>
        {links.filter((l) => l[2]).map(([h, l]) => <Link key={h} href={h} className="block rounded-md px-3 py-1.5 hover:bg-white">{l}</Link>)}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
