import { Pool } from "pg";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { hashPassword } from "../src/lib/auth";

const CATEGORIES = ["Restaurants and cafes", "Home services", "Plumbing", "Electrical", "Legal services", "Accounting and finance", "Health and wellness", "Beauty and personal care",
  "Retail and shops", "Automotive", "Education and tutoring", "Technology and IT", "Marketing and design", "Construction", "Real estate", "Travel and hospitality", "Logistics and transport", "Manufacturing", "Agriculture", "Other"];

/** Idempotent: safe to run repeatedly. Seeds ISO countries, starter categories, and the first admin from env. */
async function main() {
  try { process.loadEnvFile(); } catch { /* rely on real env */ }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? true : undefined });
  countries.registerLocale(en as any);
  for (const [code, name] of Object.entries(countries.getNames("en", { select: "official" }))) {
    await pool.query("insert into countries(code, name) values ($1,$2) on conflict (code) do nothing", [code, name]);
  }
  for (const name of CATEGORIES) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await pool.query("insert into categories(slug, name) values ($1,$2) on conflict (slug) do nothing", [slug, name]);
  }
  const email = process.env.SEED_ADMIN_EMAIL, pw = process.env.SEED_ADMIN_PASSWORD;
  if (email && pw) {
    if (pw.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
    await pool.query("insert into users(email, password_hash, name, role) values ($1,$2,'Administrator','admin') on conflict (email) do nothing", [email.toLowerCase(), await hashPassword(pw)]);
    console.log(`Admin ready: ${email}`);
  } else console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no admin created.");
  console.log("Seeded countries:", (await pool.query("select count(*)::int n from countries")).rows[0].n, "categories:", (await pool.query("select count(*)::int n from categories")).rows[0].n);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
