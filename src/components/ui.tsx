import type { ReactNode } from "react";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft: fee unpaid", cls: "bg-board text-muted border-line" },
  pending_approval: { label: "Awaiting approval", cls: "bg-goldsoft text-[#7A5600] border-gold/50" },
  approved: { label: "Live", cls: "bg-ok/10 text-ok border-ok/30" },
  rejected: { label: "Rejected", cls: "bg-danger/10 text-danger border-danger/30" },
  suspended: { label: "Suspended", cls: "bg-danger/10 text-danger border-danger/30" },
  pending: { label: "Pending", cls: "bg-goldsoft text-[#7A5600] border-gold/50" },
  paid: { label: "Paid", cls: "bg-ok/10 text-ok border-ok/30" },
  failed: { label: "Failed", cls: "bg-danger/10 text-danger border-danger/30" },
  expired: { label: "Expired", cls: "bg-board text-muted border-line" },
  refunded: { label: "Refunded", cls: "bg-board text-ink border-line" },
  partially_refunded: { label: "Part refunded", cls: "bg-board text-ink border-line" },
  disputed: { label: "Disputed", cls: "bg-danger/10 text-danger border-danger/30" },
  active: { label: "Active", cls: "bg-ok/10 text-ok border-ok/30" },
  void: { label: "Void", cls: "bg-board text-muted border-line" },
  pending_payment: { label: "Awaiting payment", cls: "bg-goldsoft text-[#7A5600] border-gold/50" },
  succeeded: { label: "Succeeded", cls: "bg-ok/10 text-ok border-ok/30" },
};
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-board text-muted border-line" };
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function VerifiedBadge({ status }: { status: string }) {
  if (status === "verified") return <span className="inline-block rounded-full border border-signal/40 bg-signal/10 text-signal px-2 py-0.5 text-xs font-medium">Verified by Business.oi</span>;
  if (status === "pending") return <span className="inline-block rounded-full border border-line bg-board text-muted px-2 py-0.5 text-xs">Verification pending</span>;
  return null;
}

export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export const date = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(d)) + " UTC" : "—";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-gold/60 bg-goldsoft" : tone === "ok" ? "border-ok/30 bg-ok/5" : "border-signal/30 bg-signal/5";
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="h-display text-2xl num">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="h-display text-3xl">{children}</h1>
      {sub && <p className="text-muted mt-1 max-w-2xl">{sub}</p>}
    </div>
  );
}
