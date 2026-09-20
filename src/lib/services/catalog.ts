import { pool } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { assertCan, type Role } from "../permissions";
import { slugify } from "./business";

type Actor = { id: string; role: Role };

export const listCategories = async (includeInactive = false) =>
  (await pool().query(`select id, slug, name, active from categories ${includeInactive ? "" : "where active"} order by name`)).rows;
export const listCountries = async (includeInactive = false) =>
  (await pool().query(`select code, name, active from countries ${includeInactive ? "" : "where active"} order by name`)).rows;

export async function addCategory(actor: Actor, name: string) {
  assertCan(actor.role, "catalog.manage");
  const n = name.trim();
  if (n.length < 2 || n.length > 60) throw new AppError("invalid", "Category name must be 2–60 characters.");
  try {
    const r = await pool().query("insert into categories(slug, name) values ($1,$2) returning id", [slugify(n), n]);
    await audit(pool(), { actorId: actor.id, action: "category.created", entityType: "category", entityId: String(r.rows[0].id), meta: { name: n } });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AppError("duplicate", "That category already exists.");
    throw e;
  }
}
export async function setCategoryActive(actor: Actor, id: number, active: boolean) {
  assertCan(actor.role, "catalog.manage");
  await pool().query("update categories set active=$2 where id=$1", [id, active]);
  await audit(pool(), { actorId: actor.id, action: active ? "category.enabled" : "category.disabled", entityType: "category", entityId: String(id) });
}
export async function addCountry(actor: Actor, code: string, name: string) {
  assertCan(actor.role, "catalog.manage");
  if (!/^[A-Za-z]{2}$/.test(code) || name.trim().length < 2) throw new AppError("invalid", "Enter a 2-letter country code and a name.");
  await pool().query("insert into countries(code, name) values ($1,$2) on conflict (code) do update set name = excluded.name", [code.toUpperCase(), name.trim()]);
  await audit(pool(), { actorId: actor.id, action: "country.upserted", entityType: "country", entityId: code.toUpperCase() });
}
export async function setCountryActive(actor: Actor, code: string, active: boolean) {
  assertCan(actor.role, "catalog.manage");
  await pool().query("update countries set active=$2 where code=$1", [code, active]);
  await audit(pool(), { actorId: actor.id, action: active ? "country.enabled" : "country.disabled", entityType: "country", entityId: code });
}
