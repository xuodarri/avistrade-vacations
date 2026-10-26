/**
 * Журнал изменений. Каждая серверная функция, которая меняет данные, вызывает `logAudit`
 * в той же транзакции, что и само изменение, — запись в базе и строка в серверном логе.
 */
import "server-only";
import { audit } from "./db/repo";
import { log } from "./log";

export interface AuditInput {
  actorId: string | null; // кто сделал; null — система
  action: string; // create / update / delete / submit / approve / return / exception / login / ...
  entity: string; // request / part / rule / exception / session / ...
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

export function logAudit(e: AuditInput) {
  audit.insert({
    actorId: e.actorId, action: e.action, entity: e.entity,
    entityId: e.entityId == null ? null : String(e.entityId), before: e.before, after: e.after,
  });
  log.info("audit", { actor: e.actorId, action: e.action, entity: e.entity, id: e.entityId ?? null });
}
