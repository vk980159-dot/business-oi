import type { Db } from "../db";

export type SearchParams = {
  q?: string;
  country?: string;
  city?: string;
  categoryId?: number;
  verifiedOnly?: boolean;
  topN?: number;
  page?: number;
  pageSize?: number;
};

export type SearchHit = {
  id: string; slug: string; name: string; city: string; countryCode: string; countryName: string; categoryName: string;
  description: string; logoUrl: string | null; verificationStatus: string; rank: number; bidCents: number;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Results are ordered strictly by the public ladder (highest active bid, then earliest activation,
 * then earliest approval). Text relevance only decides *whether* a business matches, never its order.
 */
export async function searchBusinesses(db: Db, p: SearchParams): Promise<{ hits: SearchHit[]; total: number; page: number; pageSize: number }> {
  const where: string[] = ["b.status = 'approved'"];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `$${args.length}`);

  const q = p.q?.trim();
  if (q) {
    const ts = add(q);
    const like = add(`%${escapeLike(q)}%`);
    where.push(
      `(b.search_vector @@ websearch_to_tsquery('simple', ${ts}) or b.name ilike ${like} or b.city ilike ${like}
        or c.name ilike ${like} or cn.name ilike ${like}
        or exists (select 1 from unnest(b.services || b.keywords) t where t ilike ${like}))`,
    );
  }
  if (p.country) where.push(`b.country_code = ${add(p.country.toUpperCase())}`);
  if (p.city?.trim()) where.push(`lower(b.city) = lower(${add(p.city.trim())})`);
  if (p.categoryId) where.push(`b.category_id = ${add(p.categoryId)}`);
  if (p.verifiedOnly) where.push(`b.verification_status = 'verified'`);
  if (p.topN) where.push(`s.rank <= ${add(p.topN)}`);

  const pageSize = Math.min(Math.max(p.pageSize ?? 20, 1), 50);
  const page = Math.max(p.page ?? 1, 1);
  const limit = add(pageSize);
  const offset = add((page - 1) * pageSize);

  const res = await db.query(
    `select b.id, b.slug, b.name, b.city, b.country_code as "countryCode", cn.name as "countryName", c.name as "categoryName",
            left(b.description, 220) as description, b.logo_url as "logoUrl", b.verification_status as "verificationStatus",
            s.rank, s.bid_cents as "bidCents", count(*) over ()::int as total
     from businesses b
     join business_standings s on s.business_id = b.id
     join categories c on c.id = b.category_id
     join countries cn on cn.code = b.country_code
     where ${where.join(" and ")}
     order by s.rank
     limit ${limit} offset ${offset}`,
    args,
  );
  return { hits: res.rows.map(({ total: _t, ...r }) => r) as SearchHit[], total: res.rows[0]?.total ?? 0, page, pageSize };
}
