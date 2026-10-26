/**
 * Правдоподобная история журнала за 20–26.10.2026 для демо `/hr/log`. Строится из уже залитых
 * сотрудников, частей и исключения, в тех же форматах, что пишут серверные функции:
 *  - сохранение плана: update / request, before/after — массивы частей;
 *  - отправка: submit / request, {status};
 *  - решение руководителя: approved | returned / part, {status, comment};
 *  - исключение HR: exception / exception, after {employeeId, partId, ruleCode, decision, reason};
 *  - правка правила HR: update / rule, before/after — правило целиком.
 * Сюжет: E15 подал 7–20 июня, E09 вернул (три МПП одновременно), E15 сдвинул на 14–27 июня.
 * Без алиасов `@/`: файл импортирует и `scripts/seed-audit.mts`, который доливает историю в живую базу.
 */
import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;
interface Ev { at: string; actor: string | null; action: string; entity: string; id: string | number | null; before?: unknown; after?: unknown }

const part = (r: Row, status = String(r.status)) => ({
  id: Number(r.id), requestId: Number(r.request_id), partNo: Number(r.part_no), type: String(r.type),
  startDate: String(r.start_date), endDate: String(r.end_date), days: Number(r.days), status,
  inSchedule: !!r.in_schedule, result: null, notes: null,
});

/** Рабочее время по Минску (UTC+3): день 20..26 октября, минуты от 9:00. */
const at = (day: number, minutes: number) =>
  new Date(Date.UTC(2026, 9, day, 6, 0) + minutes * 60_000).toISOString();
const WORKDAYS = [20, 21, 22, 23, 26]; // 24–25 — выходные

const APPROVE_COMMENTS = ["Согласовано", "Согласовано, замену назначу", "Ок, пересечений в отделе нет", "Согласовано"];

export function auditHistory(db: DatabaseSync): Ev[] {
  const emps = db.prepare("SELECT id, manager_id FROM employees ORDER BY id").all() as Row[];
  const manager = new Map(emps.map((e) => [String(e.id), (e.manager_id as string) ?? null]));
  const reqs = db.prepare("SELECT * FROM requests ORDER BY employee_id").all() as Row[];
  const partsOf = (reqId: number) => db.prepare("SELECT * FROM request_parts WHERE request_id=? ORDER BY part_no").all(reqId) as Row[];
  const ev: Ev[] = [];

  reqs.forEach((r, i) => {
    const emp = String(r.employee_id), reqId = Number(r.id), list = partsOf(reqId);
    const day = WORKDAYS[i % 3], min = 20 + ((i * 37) % 420); // подают 20–22 октября
    const draft = list.map((p) => part(p, "draft"));

    if (emp === "E15") {
      // сначала подал 7–20 июня, руководитель вернул, сдвинул на неделю
      const first = draft.map((p) => (p.partNo === 1 ? { ...p, startDate: "2027-06-07", endDate: "2027-06-20" } : p));
      ev.push({ at: at(20, 75), actor: emp, action: "update", entity: "request", id: reqId, before: [], after: first });
      ev.push({ at: at(20, 78), actor: emp, action: "submit", entity: "request", id: reqId, before: { status: "draft" }, after: { status: "submitted" } });
      ev.push({ at: at(21, 140), actor: "E09", action: "returned", entity: "part", id: first[0].id, before: { status: "pending" },
        after: { status: "returned", comment: "7–20 июня уже уходят Петров и Иванова, третий МПП не проходит по лимиту. Сдвиньте на неделю" } });
      ev.push({ at: at(22, 30), actor: emp, action: "update", entity: "request", id: reqId, before: first, after: draft });
      ev.push({ at: at(22, 32), actor: emp, action: "submit", entity: "request", id: reqId, before: { status: "draft" }, after: { status: "submitted" } });
      return;
    }

    ev.push({ at: at(day, min), actor: emp, action: "update", entity: "request", id: reqId, before: [], after: draft });
    if (r.status === "draft") return;
    ev.push({ at: at(day, min + 4), actor: emp, action: "submit", entity: "request", id: reqId, before: { status: "draft" }, after: { status: "submitted" } });

    list.filter((p) => p.status === "approved").forEach((p, k) => {
      const boss = manager.get(emp) ?? "E19"; // у ИД руководителя нет — проводит HR по приказу
      ev.push({ at: at(WORKDAYS[2 + ((i + k) % 3)], 60 + ((i * 53 + k * 17) % 360)), actor: boss, action: "approved", entity: "part",
        id: Number(p.id), before: { status: "pending" }, after: { status: "approved", comment: boss === "E19" ? "Согласовано приказом" : APPROVE_COMMENTS[(i + k) % APPROVE_COMMENTS.length] } });
    });
  });

  const x = db.prepare("SELECT * FROM exceptions WHERE employee_id='E05' ORDER BY id LIMIT 1").get() as Row | undefined;
  if (x) ev.push({ at: String(x.created_at), actor: String(x.created_by), action: "exception", entity: "exception", id: Number(x.id),
    after: { employeeId: "E05", partId: x.part_id ?? null, ruleCode: x.rule_code, decision: x.decision, reason: x.reason } });

  const r03 = db.prepare("SELECT * FROM rules WHERE code='R03'").get() as Row | undefined;
  if (r03) {
    const rule = (value: number) => {
      const params = JSON.parse(String(r03.params));
      return { code: "R03", title: r03.title, params: { ...params, value }, enabled: !!r03.enabled, severity: r03.severity,
        source: r03.source, basis: r03.basis, howChecked: r03.how_checked };
    };
    const now = JSON.parse(String(r03.params)).value ?? 14;
    ev.push({ at: at(20, 20), actor: "E19", action: "update", entity: "rule", id: "R03", before: rule(10), after: rule(now) });
  }

  ev.push(...changeEvents(db));
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

/** PartChange из строки part_changes — та же форма, что отдаёт repo (toChange). */
const changeOf = (r: Row) => ({
  id: Number(r.id), partId: Number(r.part_id), employeeId: String(r.employee_id), kind: r.kind, oldStart: r.old_start, oldEnd: r.old_end,
  newStart: r.new_start ?? null, newEnd: r.new_end ?? null, reason: r.reason, note: r.note ?? null, status: r.status, stage: r.stage,
  requestedOn: r.requested_on, requestedBy: r.requested_by, createdAt: r.created_at, managerBy: r.manager_by ?? null, managerAt: r.manager_at ?? null,
  decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null,
});

/** События по демо-заявкам на перенос (как пишет actions/changes.ts): подача и пропуск руководителем к HR. */
export function changeEvents(db: DatabaseSync): Ev[] {
  const ev: Ev[] = [];
  for (const r of db.prepare("SELECT * FROM part_changes WHERE kind IN ('move','shorten','cancel') ORDER BY id").all() as Row[]) {
    const c = changeOf(r);
    const asFiled = { ...c, stage: c.managerBy ? "manager" : c.stage, managerBy: null, managerAt: null };
    ev.push({ at: String(c.createdAt), actor: String(c.requestedBy), action: "change_request", entity: "change", id: c.id, after: asFiled });
    if (c.managerBy && c.managerAt)
      ev.push({ at: String(c.managerAt), actor: String(c.managerBy), action: "change_manager", entity: "change", id: c.id, before: asFiled, after: c });
  }
  return ev;
}

/** Долить события по заявкам в существующую базу (идемпотентно). */
export function seedChangeAudit(db: DatabaseSync) {
  const has = db.prepare("SELECT 1 FROM audit_log WHERE action='change_request' LIMIT 1").get();
  if (has) return 0;
  const ins = db.prepare("INSERT INTO audit_log(at,actor_id,action,entity,entity_id,before,after) VALUES (?,?,?,?,?,?,?)");
  const ev = changeEvents(db);
  for (const e of ev) ins.run(e.at, e.actor, e.action, e.entity, String(e.id), e.before === undefined ? null : JSON.stringify(e.before), JSON.stringify(e.after));
  return ev.length;
}

/** Записывает историю в audit_log. Вызывать в транзакции. */
export function seedAuditHistory(db: DatabaseSync) {
  const ins = db.prepare("INSERT INTO audit_log(at,actor_id,action,entity,entity_id,before,after) VALUES (?,?,?,?,?,?,?)");
  const ev = auditHistory(db);
  for (const e of ev)
    ins.run(e.at, e.actor, e.action, e.entity, e.id == null ? null : String(e.id),
      e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after));
  return ev.length;
}
