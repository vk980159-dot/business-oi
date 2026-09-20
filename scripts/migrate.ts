import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/** Applies db/migrations/*.sql in order, each inside a transaction. Safe to re-run. */
export async function migrate(pool: Pool, dir = path.join(process.cwd(), "db", "migrations")) {
  await pool.query(
    "create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await pool.query("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await client.query("insert into schema_migrations(name) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  (async () => {
    try { process.loadEnvFile(); } catch { /* no .env file: rely on real environment */ }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? true : undefined });
    console.log("Applied:", await migrate(pool));
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
