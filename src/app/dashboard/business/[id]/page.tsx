import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getOwnedBusiness } from "@/lib/services/business";
import { getBusinessStanding, getLadder, getLadderInfo } from "@/lib/services/ranking";
import { listCategories, listCountries } from "@/lib/services/catalog";
import { getSettings } from "@/lib/settings";
import BusinessForm from "@/components/BusinessForm";
import LiveLadder from "@/components/LiveLadder";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { payListingAction, placeBidAction, requestVerificationAction, updateBusinessAction } from "@/lib/actions/owner";
import { StatusBadge, VerifiedBadge, Notice, Stat, money, date } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manage business", robots: { index: false } };

export default async function ManageBusiness({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ checkout?: string }> }) {
  const { id } = await params;
  const { checkout } = await searchParams;
  const user = await requireUser(`/dashboard/business/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await getOwnedBusiness(pool(), user.id, id);
  if (!b) notFound();

  const [s, info, standing, ladder, categories, countries, bids, payments] = await Promise.all([
    getSettings(pool()), getLadderInfo(pool()), getBusinessStanding(pool(), id), getLadder(pool(), 10), listCategories(), listCountries(),
    pool().query("select b.amount_cents, b.status, b.reject_reason, b.activated_at, b.expires_at, b.created_at from bids b where b.business_id = $1 order by b.created_at desc limit 50", [id]).then((r) => r.rows),
    pool().query("select id, kind, amount_cents, currency, status, invoice_number, paid_at, created_at, refunded_cents from payments where business_id = $1 order by created_at desc", [id]).then((r) => r.rows),
  ]);
  const live = b.status === "approved";
  const leading = info.leaderBusinessId === id;
  const pendingBid = bids.find((x: any) => x.status === "pending_payment");

  return (
    <div className="space-y-8 max-w-4xl">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div><h1 className="h-display text-3xl">{b.name}</h1>
          <div className="flex gap-2 mt-1 items-center"><StatusBadge status={b.status} /><VerifiedBadge status={b.verification_status} />{live && <Link className="link text-sm" href={`/business/${b.slug}`}>View public page</Link>}</div></div>
        <Link href="/dashboard" className="btn-quiet">All businesses</Link>
      </header>

      {checkout === "processing" && <Notice tone="info"><b>Payment received by the checkout page.</b> We confirm payments with Stripe before anything changes. This usually takes a few seconds; refresh to see the new status.</Notice>}
      {checkout === "canceled" && <Notice tone="warn">Checkout was canceled. You have not been charged.</Notice>}
      {b.status_note && (b.status === "rejected" || b.status === "suspended") && <Notice tone="warn"><b>Reason from our team:</b> {b.status_note}</Notice>}

      {b.status === "draft" && (
        <section className="panel p-5">
          <h2 className="h-display text-xl">Pay the listing fee</h2>
          <p className="mt-1 text-muted">Review your details below, then pay to submit the listing for approval.</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm max-w-sm">
            <dt className="text-muted">Listing fee (one-time)</dt><dd className="num text-right font-semibold">{money(s.listingFeeCents, s.currency)}</dd>
            <dt className="text-muted">Payment</dt><dd className="text-right">Stripe Checkout</dd>
            <dt className="text-muted">Tax</dt><dd className="text-right">Not calculated</dd>
          </dl>
          <ActionForm action={payListingAction.bind(null, id)} className="mt-4 space-y-3">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acceptTerms" required className="mt-1" />
              <span>I have read the <Link className="link" href="/legal/terms" target="_blank">Terms of Service</Link> and <Link className="link" href="/legal/refunds" target="_blank">Refund Policy</Link>, and I agree to pay {money(s.listingFeeCents, s.currency)}. Listings are approved by our team after payment.</span></label>
            <SubmitButton pendingLabel="Opening checkout…">Continue to payment</SubmitButton>
          </ActionForm>
        </section>
      )}
      {b.status === "pending_approval" && <Notice tone="info"><b>Listing fee paid.</b> Our team is reviewing your listing. You can still edit the details below.</Notice>}

      {live && (
        <section className="space-y-4">
          <h2 className="h-display text-2xl">Ranking</h2>
          <div className="grid sm:grid-cols-4 gap-3">
            <Stat label="Your position" value={standing ? `#${standing.rank}` : "—"} sub={standing ? `of ${standing.total}` : undefined} />
            <Stat label="Your active bid" value={standing && standing.bidCents > 0 ? money(standing.bidCents, s.currency) : "None"} />
            <Stat label="Highest bid" value={info.highestCents ? money(info.highestCents, s.currency) : "None"} />
            <Stat label="Minimum next bid" value={money(info.minNextCents, s.currency)} />
          </div>
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div className="panel p-5">
              <h3 className="font-semibold">Place a bid</h3>
              {leading ? <p className="text-sm text-muted mt-2">You hold #1 with the highest bid. You can bid again once another business outbids you.</p> : (
                <>
                  <p className="text-sm text-muted mt-1">Bids are paid in full at checkout and stay active for {s.bidDurationDays} days. Your bid only counts once the payment is confirmed <em>and</em> it is still at least {money(s.minIncrementCents, s.currency)} above the top bid. If someone outbids you while you pay, you are refunded automatically.</p>
                  {pendingBid && <p className="text-sm mt-2 text-[#7A5600]">You have an unpaid bid of <span className="num">{money(pendingBid.amount_cents, s.currency)}</span>. Submitting again reuses or replaces it.</p>}
                  <ActionForm action={placeBidAction.bind(null, id)} className="mt-3 space-y-3">
                    <div><label className="label" htmlFor="amount">Bid amount ({s.currency.toUpperCase()})</label>
                      <input id="amount" name="amount" inputMode="decimal" required className="input num" defaultValue={(info.minNextCents / 100).toFixed(2)} /></div>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acceptTerms" required className="mt-1" /><span>I accept the <Link className="link" href="/legal/bidding" target="_blank">bidding terms</Link>.</span></label>
                    <SubmitButton pendingLabel="Opening checkout…" className="btn-gold">Continue to payment</SubmitButton>
                  </ActionForm>
                </>
              )}
            </div>
            <LiveLadder initial={{ ladder, highestCents: info.highestCents, minNextCents: info.minNextCents, currency: s.currency }} highlightId={id} />
          </div>
          {b.verification_status === "unverified" && (
            <ActionForm action={requestVerificationAction.bind(null, id)} className="panel p-5">
              <h3 className="font-semibold">Get verified</h3><p className="text-sm text-muted mb-3">Our team checks that your business is real. It is manual, and bidding does not affect it.</p>
              <SubmitButton className="btn-quiet">Request verification</SubmitButton>
            </ActionForm>
          )}
        </section>
      )}

      {bids.length > 0 && (
        <section><h2 className="h-display text-xl mb-2">Bid history</h2>
          <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>Placed</th><th>Amount</th><th>Status</th><th>Active until</th><th>Note</th></tr></thead>
            <tbody>{bids.map((x: any, i: number) => (
              <tr key={i} className="border-t border-line"><td>{date(x.created_at)}</td><td className="num">{money(x.amount_cents, s.currency)}</td><td><StatusBadge status={x.status} /></td><td>{x.status === "active" ? date(x.expires_at) : "—"}</td>
                <td className="text-muted text-xs">{x.reject_reason?.startsWith("below_minimum") ? "Outbid before payment cleared. Refunded." : (x.reject_reason ?? "")}</td></tr>))}</tbody></table></div></section>
      )}

      {payments.length > 0 && (
        <section><h2 className="h-display text-xl mb-2">Payments</h2>
          <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th>Date</th><th>For</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
            <tbody>{payments.map((p: any) => (
              <tr key={p.id} className="border-t border-line"><td>{date(p.paid_at ?? p.created_at)}</td><td>{p.kind === "listing" ? "Listing fee" : "Ranking bid"}</td>
                <td className="num">{money(p.amount_cents, p.currency)}{p.refunded_cents > 0 && <span className="text-xs text-muted"> (−{money(p.refunded_cents, p.currency)})</span>}</td><td><StatusBadge status={p.status} /></td>
                <td>{p.invoice_number ? <a className="link" href={`/api/invoices/${p.id}`}>{p.invoice_number}</a> : "—"}</td></tr>))}</tbody></table></div></section>
      )}

      {b.status !== "suspended" && (
        <section><h2 className="h-display text-2xl mb-3">Edit listing</h2>
          {live && <p className="text-sm text-muted mb-3">Changes to a live listing take effect immediately. Our team can suspend listings that become misleading.</p>}
          <BusinessForm action={updateBusinessAction.bind(null, id)} categories={categories} countries={countries} timezones={Intl.supportedValuesOf("timeZone")} values={b} submitLabel="Save changes" />
        </section>
      )}
    </div>
  );
}
