import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (c: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(c / 100);

/** Printable invoice (HTML, "Save as PDF" from the browser). Only the payer or staff with payments.view can fetch it. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const p = (await pool().query(
    `select p.*, b.name as business_name, b.address, b.city, u.name as user_name, u.email from payments p
     join businesses b on b.id = p.business_id join users u on u.id = p.user_id where p.id = $1 and p.invoice_number is not null`, [id])).rows[0];
  if (!p || (p.user_id !== user.id && !can(user.role, "payments.view"))) return new NextResponse("Not found", { status: 404 });

  const seller = process.env.SELLER_LEGAL_NAME ?? "Business.oi (seller details not configured)";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Invoice ${esc(p.invoice_number)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;color:#0E1B2B}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:8px;border-bottom:1px solid #D3D9E0;text-align:left}.r{text-align:right}h1{font-size:24px;margin:0}</style>
<h1>Invoice ${esc(p.invoice_number)}</h1><p>Date paid: ${esc(new Date(p.paid_at).toISOString().slice(0, 10))}</p>
<p><b>From</b><br>${esc(seller)}<br>${esc(process.env.SELLER_ADDRESS ?? "")}</p>
<p><b>Billed to</b><br>${esc(p.user_name)} (${esc(p.email)})<br>${esc(p.business_name)}, ${esc(p.address)}, ${esc(p.city)}</p>
<table><tr><th>Description</th><th class="r">Amount</th></tr>
<tr><td>${p.kind === "listing" ? "Business.oi listing fee" : "Business.oi ranking bid"}</td><td class="r">${esc(fmt(p.amount_cents, p.currency))}</td></tr>
${p.refunded_cents > 0 ? `<tr><td>Refunded</td><td class="r">−${esc(fmt(p.refunded_cents, p.currency))}</td></tr>` : ""}
<tr><th>Total paid</th><th class="r">${esc(fmt(p.amount_cents - p.refunded_cents, p.currency))}</th></tr></table>
<p style="color:#5A6878;font-size:12px">Tax is not calculated by this MVP. Payment reference: ${esc(p.stripe_payment_intent_id)}.</p></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${p.invoice_number}.html"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
