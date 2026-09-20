import Link from "next/link";
import { pool } from "@/lib/db";
import { getLadder, getLadderInfo } from "@/lib/services/ranking";
import { getSettings } from "@/lib/settings";
import { listCategories, listCountries } from "@/lib/services/catalog";
import LiveLadder from "@/components/LiveLadder";
import { money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [ladder, info, s, cats, countries] = await Promise.all([getLadder(pool(), 10), getLadderInfo(pool()), getSettings(pool()), listCategories(), listCountries()]);
  return (
    <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-start">
      <div className="space-y-8">
        <div>
          <h1 className="h-display text-4xl sm:text-5xl leading-[1.1]">Find businesses anywhere, and see exactly why they're listed first.</h1>
          <p className="mt-4 text-lg text-muted max-w-xl">Placement on Business.oi is decided by an open bidding ladder. The top bid is public, and every paid position is labelled.</p>
        </div>
        <form action="/search" className="panel p-4 grid sm:grid-cols-[1fr_auto] gap-3" role="search">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3"><label className="label" htmlFor="q">What are you looking for?</label><input id="q" name="q" className="input" placeholder="Plumber, bakery, accountant, business name…" /></div>
            <div><label className="label" htmlFor="country">Country</label>
              <select id="country" name="country" className="input" defaultValue=""><option value="">Anywhere</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="input" /></div>
            <div><label className="label" htmlFor="category">Category</label>
              <select id="category" name="category" className="input" defaultValue=""><option value="">All</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="flex items-end"><button className="btn-primary w-full sm:w-auto">Search</button></div>
        </form>
        <div className="panel p-5">
          <h2 className="h-display text-xl">Own a business?</h2>
          <p className="text-muted mt-1">Listing costs {money(s.listingFeeCents, s.currency)} once. After approval you can bid for a higher position, starting at {money(s.startingBidCents, s.currency)}, and each new bid must beat the current top by {money(s.minIncrementCents, s.currency)}.</p>
          <div className="mt-4 flex gap-3"><Link href="/register" className="btn-primary">List your business</Link><Link href="/legal/bidding" className="btn-quiet">How bidding works</Link></div>
        </div>
      </div>
      <LiveLadder initial={{ ladder, highestCents: info.highestCents, minNextCents: info.minNextCents, currency: s.currency }} />
    </div>
  );
}
