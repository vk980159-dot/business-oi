import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { getPublicBusiness } from "@/lib/services/business";
import { getSettings } from "@/lib/settings";
import { VerifiedBadge, money } from "@/components/ui";

export const dynamic = "force-dynamic";
const base = () => process.env.APP_URL ?? "http://localhost:3000";
const DAYS: [string, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const DAY_SCHEMA: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const metaDesc = (b: any) => { const t = `${b.name}: ${b.category_name} in ${b.city}, ${b.country_name}. ${b.description}`.replace(/\s+/g, " "); return t.length > 158 ? t.slice(0, 155).trimEnd() + "…" : t; };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await getPublicBusiness(pool(), slug);
  if (!b) return { title: "Business not found", robots: { index: false } };
  const url = `${base()}/business/${b.slug}`;
  return {
    title: `${b.name}, ${b.category_name} in ${b.city}`,
    description: metaDesc(b),
    alternates: { canonical: url },
    openGraph: { title: `${b.name} | Business.oi`, description: metaDesc(b), url, type: "website", images: b.logo_url ? [b.logo_url] : undefined },
  };
}

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [b, s] = await Promise.all([getPublicBusiness(pool(), slug), getSettings(pool())]);
  if (!b) notFound();
  const reviews = (await pool().query("select r.rating, r.body, r.created_at, u.name from reviews r join users u on u.id = r.user_id where r.business_id = $1 and r.status = 'published' order by r.created_at desc limit 20", [b.id])).rows;
  const hours = (b.opening_hours ?? {}) as Record<string, { open: string; close: string } | null>;
  const social = Object.entries((b.social_links ?? {}) as Record<string, string>);

  // Structured data reflects only what is true: ratings appear only when real published reviews exist.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org", "@type": "LocalBusiness", name: b.name, description: b.description,
    url: `${base()}/business/${b.slug}`, telephone: b.phone, email: b.email,
    address: { "@type": "PostalAddress", streetAddress: b.address, addressLocality: b.city, addressCountry: b.country_code.trim() },
  };
  if (b.logo_url) jsonLd.image = [b.logo_url, ...b.image_urls];
  if (b.website) jsonLd.sameAs = [b.website, ...social.map(([, u]) => u)];
  const spec = DAYS.filter(([k]) => hours[k]).map(([k]) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DAY_SCHEMA[k], opens: hours[k]!.open, closes: hours[k]!.close }));
  if (spec.length) jsonLd.openingHoursSpecification = spec;
  if (b.rating_count > 0) jsonLd.aggregateRating = { "@type": "AggregateRating", ratingValue: b.rating_avg, reviewCount: b.rating_count };
  const ld = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <article className="grid lg:grid-cols-[1fr_20rem] gap-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <div className="space-y-6">
        <header className="flex gap-4 items-start">
          {b.logo_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={b.logo_url} alt={`${b.name} logo`} className="h-20 w-20 rounded-md border border-line object-contain bg-white" referrerPolicy="no-referrer" />}
          <div>
            <h1 className="h-display text-3xl">{b.name}</h1>
            <p className="text-muted">{b.category_name} · {b.city}, {b.country_name}</p>
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <VerifiedBadge status={b.verification_status} />
              {b.rating_count > 0 && <span className="text-sm">★ {b.rating_avg} ({b.rating_count})</span>}
            </div>
          </div>
        </header>
        <section className="panel p-5"><h2 className="h-display text-xl mb-2">About</h2><p className="whitespace-pre-line">{b.description}</p>
          {b.services.length > 0 && <><h3 className="font-medium mt-4 mb-1">Services</h3><ul className="flex flex-wrap gap-2">{b.services.map((x: string) => <li key={x} className="rounded-full border border-line px-3 py-0.5 text-sm">{x}</li>)}</ul></>}
        </section>
        {b.image_urls.length > 0 && (
          <section aria-label="Photos" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {b.image_urls.map((u: string) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={u} src={u} alt={`${b.name} photo`} loading="lazy" referrerPolicy="no-referrer" className="w-full aspect-[4/3] object-cover rounded-md border border-line" />)}
          </section>
        )}
        <section className="panel p-5"><h2 className="h-display text-xl mb-2">Reviews</h2>
          {reviews.length === 0 ? <p className="text-muted text-sm">No reviews yet.</p> : (
            <ul className="space-y-4">{reviews.map((r: any, i: number) => <li key={i}><p className="text-sm font-medium">{r.name} · {"★".repeat(r.rating)}</p><p className="text-sm">{r.body}</p></li>)}</ul>)}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="panel p-4">
          <h2 className="font-semibold mb-1">Ranking on Business.oi</h2>
          <p className="h-display text-3xl num">#{b.rank} <span className="text-base text-muted">of {b.ranked_total}</span></p>
          <p className="text-sm text-muted mt-1">{b.bid_cents > 0 ? <>Paid placement: current ranking bid <span className="num">{money(b.bid_cents, s.currency)}</span>. This position is bought, not an endorsement.</> : "Standard listing with no active ranking bid."}</p>
        </section>
        <section className="panel p-4 space-y-1 text-sm">
          <h2 className="font-semibold mb-1">Contact</h2>
          <p>{b.address}, {b.city}, {b.country_name}</p>
          <p><a className="link" href={`tel:${b.phone}`}>{b.phone}</a></p>
          <p><a className="link" href={`mailto:${b.email}`}>{b.email}</a></p>
          {b.website && <p><a className="link" href={b.website} rel="nofollow noopener noreferrer sponsored" target="_blank">{b.website.replace(/^https:\/\//, "")}</a></p>}
          {social.length > 0 && <p className="flex flex-wrap gap-x-3 pt-1">{social.map(([k, u]) => <a key={k} className="link capitalize" href={u} rel="nofollow noopener noreferrer" target="_blank">{k === "x" ? "X" : k}</a>)}</p>}
        </section>
        {spec.length > 0 && (
          <section className="panel p-4"><h2 className="font-semibold mb-1">Opening hours</h2><p className="text-xs text-muted mb-2">Times in {b.timezone}</p>
            <dl className="text-sm grid grid-cols-[6rem_1fr] gap-y-1">{DAYS.map(([k, l]) => <div key={k} className="contents"><dt>{l}</dt><dd className="num">{hours[k] ? `${hours[k]!.open} – ${hours[k]!.close}` : "Closed"}</dd></div>)}</dl></section>
        )}
        <p className="text-xs text-muted"><a className="link" href={`mailto:${process.env.SUPPORT_EMAIL ?? "support@example.com"}?subject=${encodeURIComponent("Report listing: " + b.slug)}`}>Report this listing</a></p>
      </aside>
    </article>
  );
}
