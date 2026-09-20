import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { pool } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { money, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
const TITLES: Record<string, string> = {
  terms: "Terms of Service", privacy: "Privacy Policy", refunds: "Refund Policy",
  bidding: "Bidding terms", verification: "Business verification policy", support: "Customer support",
};
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: TITLES[slug] ?? "Not found" };
}

export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!TITLES[slug]) notFound();
  const s = await getSettings(pool());
  const m = (c: number) => money(c, s.currency);
  const support = process.env.SUPPORT_EMAIL ?? "support@example.com";

  const body: Record<string, ReactNode> = {
    terms: (<>
      <p>Business.oi is a business directory. Businesses pay a one-time listing fee of <b>{m(s.listingFeeCents)}</b> and may then place ranking bids to appear higher in Business.oi search results.</p>
      <p>You are responsible for the accuracy of your listing. We may reject, suspend, or remove listings that are misleading, unlawful, or that breach these terms.</p>
      <p>Ranking on Business.oi has no connection to ranking on Google or any other search engine, and we make no promise about either.</p>
    </>),
    privacy: (<>
      <p>We store the account and business information you enter, payment status and history, and security logs (such as IP addresses used for rate limiting and audit).</p>
      <p>Card details are entered on Stripe's hosted checkout and never reach Business.oi's servers or database.</p>
      <p>Business listing details are public by design. Contact <a className="link" href={`mailto:${support}`}>{support}</a> to request access to or deletion of your data.</p>
    </>),
    refunds: (<>
      <p>{s.refundPolicy}</p>
      <p>Refunds are returned to the original payment method. Processing times depend on your bank.</p>
    </>),
    bidding: (<>
      <ul className="list-disc pl-5 space-y-2">
        <li>Only approved listings can bid. The first bid must be at least <b>{m(s.startingBidCents)}</b>.</li>
        <li>Each later bid must be at least <b>{m(s.minIncrementCents)}</b> higher than the current highest bid. The highest valid bid holds position #1, and lower valid bids rank beneath it.</li>
        <li>Each bid is a separate payment of the full bid amount. A bid stays active for <b>{s.bidDurationDays} days</b>, then lapses and stops counting.</li>
        <li>A bid only counts once Stripe confirms payment <em>and</em> it is still valid at that moment. If someone else's bid took effect while you were paying, your bid is not placed and you are refunded automatically in full.</li>
        <li>Ties between equal positions are broken by whichever bid became active first, then whichever listing was approved first.</li>
        <li>Businesses with an active bid are shown as paid placements. Position is bought and is not an endorsement or a verification.</li>
        <li>Maximum single bid: <b>{m(s.maxBidCents)}</b>.</li>
      </ul>
    </>),
    verification: (<>
      <p>"Verified by Business.oi" appears only after our staff manually review evidence that the business exists and the owner controls it. Paying a listing fee or bidding does not verify a business. Owners may request verification from their dashboard; staff decide.</p>
    </>),
    support: (<>
      <p>Email <a className="link" href={`mailto:${support}`}>{support}</a>. Include your account email and, for payment questions, the invoice number.</p>
    </>),
  };

  return (
    <article className="mx-auto max-w-2xl space-y-4 leading-relaxed">
      <h1 className="h-display text-3xl">{TITLES[slug]}</h1>
      <Notice tone="warn"><b>Draft.</b> Placeholder text describing how the platform currently behaves. It has not been reviewed by a lawyer and must be before live launch.</Notice>
      {body[slug]}
    </article>
  );
}
