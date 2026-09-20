import type { MetadataRoute } from "next";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const rows = (await pool().query("select slug, updated_at from businesses where status = 'approved' order by updated_at desc limit 50000")).rows;
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    ...["terms", "privacy", "refunds", "bidding", "verification", "support"].map((s) => ({ url: `${base}/legal/${s}`, changeFrequency: "yearly" as const, priority: 0.2 })),
    ...rows.map((r) => ({ url: `${base}/business/${r.slug}`, lastModified: r.updated_at, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
