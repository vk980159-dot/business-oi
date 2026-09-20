import { z } from "zod";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const bytes = (s: string) => new TextEncoder().encode(s).length;

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email").max(254).transform((s) => s.trim().toLowerCase()),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .refine((p) => bytes(p) <= 72, "Password is too long (72 bytes max)"),
});

export const loginSchema = z.object({
  email: z.email().max(254).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

const httpsUrl = (label: string) =>
  z.string().trim().max(500).refine((v) => {
    try { return new URL(v).protocol === "https:"; } catch { return false; }
  }, `${label} must be a full https:// URL`);

const optionalUrl = (label: string) =>
  z.union([z.literal(""), httpsUrl(label)]).transform((v) => (v === "" ? null : v));

const list = (max: number, itemMax: number) =>
  z.string().max(4000).transform((s) => [...new Set(s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))].slice(0, max).map((x) => x.slice(0, itemMax)));

const urlList = (label: string, max: number) =>
  z.string().max(4000).transform((s, ctx) => {
    const items = s.split("\n").map((x) => x.trim()).filter(Boolean);
    if (items.length > max) { ctx.issues.push({ code: "custom", message: `At most ${max} ${label}`, input: s }); return z.NEVER; }
    for (const u of items) {
      try { if (new URL(u).protocol !== "https:") throw 0; } catch { ctx.issues.push({ code: "custom", message: `${label}: "${u.slice(0, 40)}" is not an https:// URL`, input: s }); return z.NEVER; }
    }
    return items;
  });

const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const SOCIALS = ["facebook", "instagram", "x", "linkedin", "youtube"] as const;

export const businessSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the business name").max(120),
    categoryId: z.coerce.number().int().positive("Choose a category"),
    countryCode: z.string().trim().length(2, "Choose a country").transform((s) => s.toUpperCase()),
    city: z.string().trim().min(1, "Enter the city").max(100),
    address: z.string().trim().min(3, "Enter the street address").max(200),
    phone: z.string().trim().min(5, "Enter a phone number").max(30),
    email: z.email("Enter a valid business email").max(254),
    website: optionalUrl("Website"),
    description: z.string().trim().min(20, "Describe the business in at least 20 characters").max(5000),
    services: list(20, 60),
    keywords: list(20, 40),
    logoUrl: optionalUrl("Logo").default(null),
    imageUrls: urlList("image URLs", 8).default([]),
    timezone: z.string().refine(validTimezone, "Choose a valid time zone"),
    openingHours: z
      .record(z.string(), z.object({ open: z.string().regex(HHMM), close: z.string().regex(HHMM) }).nullable())
      .default({}),
    socialLinks: z.record(z.string(), z.string()).default({}),
  })
  .transform((v, ctx) => {
    const phone = parsePhoneNumberFromString(v.phone, v.countryCode as CountryCode);
    if (!phone || !phone.isValid()) {
      ctx.issues.push({ code: "custom", message: "Enter a valid phone number for the selected country (or start with +country code)", input: v.phone, path: ["phone"] });
      return z.NEVER;
    }
    const socialLinks: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.socialLinks)) {
      if (!val) continue;
      if (!(SOCIALS as readonly string[]).includes(k)) continue;
      const r = httpsUrl(k).safeParse(val);
      if (!r.success) { ctx.issues.push({ code: "custom", message: `${k} link must be a full https:// URL`, input: val, path: ["socialLinks"] }); return z.NEVER; }
      socialLinks[k] = r.data;
    }
    return { ...v, phone: phone.number, socialLinks };
  });

export type BusinessFormData = z.output<typeof businessSchema>;

/** Turns the owner form into the validated shape. Opening hours: blank = closed. */
export function parseBusinessForm(fd: FormData) {
  const get = (k: string) => String(fd.get(k) ?? "");
  const openingHours: Record<string, { open: string; close: string } | null> = {};
  for (const d of DAYS) {
    const o = get(`hours_${d}_open`), c = get(`hours_${d}_close`);
    openingHours[d] = o && c ? { open: o, close: c } : null;
  }
  const socialLinks: Record<string, string> = {};
  for (const s of SOCIALS) socialLinks[s] = get(`social_${s}`).trim();
  return businessSchema.safeParse({
    name: get("name"), categoryId: get("categoryId"), countryCode: get("countryCode"), city: get("city"), address: get("address"),
    phone: get("phone"), email: get("email"), website: get("website"), description: get("description"),
    services: get("services"), keywords: get("keywords"), logoUrl: get("logoUrl"), imageUrls: get("imageUrls"),
    timezone: get("timezone") || "UTC", openingHours, socialLinks,
  });
}

/** "12.50" → 1250. Rejects more than two decimals, zero, negatives, and junk. */
export function dollarsToCents(input: string): number | null {
  const m = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const cents = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0);
  return cents > 0 ? cents : null;
}

export const reasonSchema = z.string().trim().min(3, "Give a short reason").max(500);

export function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}
