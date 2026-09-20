import type { Db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";

export type Hours = Record<string, { open: string; close: string } | null>;
export type BusinessInput = {
  name: string;
  categoryId: number;
  countryCode: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string | null;
  description: string;
  services: string[];
  keywords: string[];
  logoUrl: string | null;
  imageUrls: string[];
  openingHours: Hours;
  socialLinks: Record<string, string>;
  timezone: string;
};

export function slugify(name: string): string {
  const s = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "business";
}

const cols = (i: BusinessInput) => [
  i.name, i.categoryId, i.countryCode, i.city, i.address, i.phone, i.email, i.website, i.description,
  i.services, i.keywords, i.logoUrl, i.imageUrls, JSON.stringify(i.openingHours), JSON.stringify(i.socialLinks), i.timezone,
];

async function assertCatalog(db: Db, i: BusinessInput) {
  const r = await db.query(
    "select (select active from categories where id = $1) as cat, (select active from countries where code = $2) as country",
    [i.categoryId, i.countryCode],
  );
  if (!r.rows[0].cat) throw new AppError("invalid_category", "Choose an available category.");
  if (!r.rows[0].country) throw new AppError("invalid_country", "Choose an available country.");
}

/** Pass the pool (not an open transaction): a slug collision is retried after the failed INSERT. */
export async function createBusiness(db: Db, ownerId: string, input: BusinessInput) {
  await assertCatalog(db, input);
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const res = await db.query(
        `insert into businesses(owner_id, slug, name, category_id, country_code, city, address, phone, email, website, description,
           services, keywords, logo_url, image_urls, opening_hours, social_links, timezone)
         values ($1, $2, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id, slug`,
        [ownerId, slug, ...cols(input)],
      );
      await audit(db, { actorId: ownerId, action: "business.created", entityType: "business", entityId: res.rows[0].id });
      return res.rows[0] as { id: string; slug: string };
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === "23505" && (e as { constraint?: string }).constraint === "businesses_slug_key") continue;
      throw e;
    }
  }
  throw new AppError("slug_failed", "Could not generate a unique page address. Try a slightly different business name.");
}

export async function updateBusiness(db: Db, ownerId: string, businessId: string, input: BusinessInput) {
  await assertCatalog(db, input);
  const res = await db.query(
    `update businesses set name=$3, category_id=$4, country_code=$5, city=$6, address=$7, phone=$8, email=$9, website=$10, description=$11,
       services=$12, keywords=$13, logo_url=$14, image_urls=$15, opening_hours=$16, social_links=$17, timezone=$18, updated_at=now()
     where id = $1 and owner_id = $2 and status <> 'suspended' returning id`,
    [businessId, ownerId, ...cols(input)],
  );
  if (res.rowCount === 0) throw new AppError("not_found", "Business not found or it cannot be edited right now.");
  await audit(db, { actorId: ownerId, action: "business.updated", entityType: "business", entityId: businessId });
}

export async function getOwnedBusiness(db: Db, ownerId: string, id: string) {
  const r = await db.query(
    `select b.*, c.name as category_name from businesses b join categories c on c.id = b.category_id where b.id = $1 and b.owner_id = $2`,
    [id, ownerId],
  );
  return r.rows[0] ?? null;
}

export async function listOwnedBusinesses(db: Db, ownerId: string) {
  const r = await db.query(
    `select b.id, b.name, b.slug, b.status, b.verification_status, b.city, b.country_code, s.rank, s.bid_cents
     from businesses b left join business_standings s on s.business_id = b.id where b.owner_id = $1 order by b.created_at desc`,
    [ownerId],
  );
  return r.rows;
}

export async function getPublicBusiness(db: Db, slug: string) {
  const r = await db.query(
    `select b.*, c.name as category_name, cn.name as country_name, s.rank, s.bid_cents,
       (select count(*)::int from business_standings) as ranked_total,
       (select round(avg(rating)::numeric, 1)::float from reviews where business_id = b.id and status = 'published') as rating_avg,
       (select count(*)::int from reviews where business_id = b.id and status = 'published') as rating_count
     from businesses b
     join categories c on c.id = b.category_id
     join countries cn on cn.code = b.country_code
     join business_standings s on s.business_id = b.id
     where b.slug = $1 and b.status = 'approved'`,
    [slug],
  );
  return r.rows[0] ?? null;
}
