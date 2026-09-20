import { Pool, type PoolClient } from "pg";

/** Anything that can run a query: the pool or a client inside a transaction. */
export type Db = Pick<PoolClient, "query">;

const g = globalThis as unknown as { __bizoiPool?: Pool };

export function pool(): Pool {
  if (!g.__bizoiPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__bizoiPool = new Pool({
      connectionString: url,
      max: 10,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
  }
  return g.__bizoiPool;
}

/** Runs `fn` in a single transaction; rolls back on any throw. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function rows<T = Record<string, any>>(text: string, params: unknown[] = [], db: Db = pool()): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}
export async function one<T = Record<string, any>>(text: string, params: unknown[] = [], db: Db = pool()): Promise<T | undefined> {
  return (await rows<T>(text, params, db))[0];
}
