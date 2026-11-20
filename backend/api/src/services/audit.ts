import type { Queryable } from "../db/pool.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Call with the transaction client so the audit row commits atomically with the change it describes. */
export async function writeAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.actorId,
      e.action,
      e.entityType,
      e.entityId,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.reason ?? null,
    ],
  );
}
