import type { Db } from "./db";

export async function audit(
  db: Db,
  e: { actorId?: string | null; action: string; entityType: string; entityId?: string | null; meta?: Record<string, unknown>; ip?: string | null },
) {
  await db.query(
    "insert into audit_logs(actor_id, action, entity_type, entity_id, meta, ip) values ($1,$2,$3,$4,$5,$6)",
    [e.actorId ?? null, e.action, e.entityType, e.entityId ?? null, JSON.stringify(e.meta ?? {}), e.ip ?? null],
  );
}
