import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/lib/db";
import { searchBusinesses } from "@/lib/services/search";
import { listCategories, listCountries } from "@/lib/services/catalog";
import { getSettings } from "@/lib/settings";
import { VerifiedBadge, money } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search businesses", robots: { index: false, follow: true } };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = one(sp.q), country = one(sp.country), city = one(sp.city), category = one(sp.category);
  const verified = one(sp.verified) === "1";
  const top = Number(one(sp.top)) || undefined;
  const page = Math.max(Number(one(sp.page)) || 1, 1);
  const [res, cats, countries, s] = await Promise.all([
    searchBusinesses(pool(), { q, country: country || undefined, city, categoryId: Number(category) || undefined, verifiedOnly: verified, topN: top, page }),
    listCategories(), listCountries(), getSettings(pool()),
  ]);
  const pages = Math.max(Math.ceil(res.total / res.pageSize), 1);
  const qs = (p: number) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ q, country, city, category, verified: verified ? "1" : "", top: top ? String(top) : "", page: String(p) })) if (v) u.set(k, v); return `/search?${u}`; };

  return (
    <div className="grid md:grid-cols-[16rem_1fr] gap-8">
      <form className="panel p-4 space-y-3 h-fit" role="search">
        <div><label className="label" htmlFor="q">Keywords</label><input id="q" name="q" className="input" defaultValue={q} /></div>
        <div><label className="label" htmlFor="country">Country</label>
          <select id="country" name="country" className="input" defaultValue={country}><option value="">Anywhere</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="input" defaultValue={city} /></div>
        <div><label className="label" htmlFor="category">Category</label>
          <select id="category" name="category" className="input" defaultValue={category}><option value="">All</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="top">Ranking position</label>
          <select id="top" name="top" className="input" defaultValue={top ? String(top) : ""}><option value="">Any</option><option value="3">Top 3</option><option value="10">Top 10</option><option value="50">Top 50</option></select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verified" value="1" defaultChecked={verified} /> Verified businesses only</label>
        <button className="btn-primary w-full">Apply</button>
      </form>

      <div>
        <p className="text-sm text-muted mb-4"><span className="num">{res.total}</span> {res.total === 1 ? "business" : "businesses"}. Listed by ranking bid, highest first. Businesses with a bid are paid placements.</p>
        {res.hits.length === 0 ? (
          <div className="panel p-8 text-center"><p className="font-medium">No businesses match those filters.</p><p className="text-sm text-muted mt-1">Try a broader keyword, or clear the country and city.</p></div>
        ) : (
          <ul className="space-y-3">
            {res.hits.map((h) => (
              <li key={h.id} className="panel p-4 flex gap-4">
                <div className="text-center w-12 shrink-0"><p className="h-display text-3xl num leading-none">{h.rank}</p><p className="text-[11px] text-muted mt-1">rank</p></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/business/${h.slug}`} className="font-semibold text-lg hover:underline">{h.name}</Link>
                    <VerifiedBadge status={h.verificationStatus} />
                    {h.bidCents > 0 ? <span className="rounded-full border border-gold/60 bg-goldsoft px-2 py-0.5 text-xs text-[#7A5600]">Sponsored · bid <span className="num">{money(h.bidCents, s.currency)}</span></span> : <span className="text-xs text-muted">Standard listing</span>}
                  </div>
                  <p className="text-sm text-muted">{h.categoryName} · {h.city}, {h.countryName}</p>
                  <p className="text-sm mt-1 line-clamp-2">{h.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-between mt-6 text-sm" aria-label="Pagination">
            {res.page > 1 ? <Link className="btn-quiet" href={qs(res.page - 1)}>Previous</Link> : <span />}
            <span className="text-muted">Page {res.page} of {pages}</span>
            {res.page < pages ? <Link className="btn-quiet" href={qs(res.page + 1)}>Next</Link> : <span />}
          </nav>
        )}
      </div>
    </div>
  );
}
