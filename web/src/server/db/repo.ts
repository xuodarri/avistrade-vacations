/**
 * Репозитории: SQL и преобразование строк базы в типы из `./types`.
 * Экраны и серверные функции ходят в базу только через эти функции.
 * Запись в журнал (`logAudit`) делает вызывающая серверная функция, а не репозиторий.
 */
import "server-only";
import { db } from "./client";
import type {
  AuditEntry, Employee, Holiday, LimitGroup, PartInput, RequestPart, Role, RoleDependency,
  Rule, RuleException, VacationRequest,
 PartChange, ChangeKind, ChangeReason,
 AppNotification, RouteSettings, Schedule,
} from "./types";
import { countVacationDays } from "@/lib/dates";
import { ROUTE_DEFAULTS, scheduleDeadline } from "./types";
import { vacationDays } from "@/domain/calendar";

type Row = Record<string, unknown>;
const all = (sql: string, ...a: (string | number | null)[]) => db().prepare(sql).all(...a) as Row[];
const one = (sql: string, ...a: (string | number | null)[]) => db().prepare(sql).get(...a) as Row | undefined;
const json = (v: unknown) => (v == null ? null : JSON.parse(String(v)));

/* ---------------- преобразование строк ---------------- */

const toEmployee = (r: Row): Employee => ({
  id: String(r.id), fullName: String(r.full_name), email: String(r.email), position: String(r.position),
  roleCode: r.role_code as Employee["roleCode"], division: String(r.division), department: (r.department as string) ?? null,
  managerId: (r.manager_id as string) ?? null, hiredOn: String(r.hired_on), baseDays: Number(r.base_days),
  extraDays: Number(r.extra_days), benefit: (r.benefit as Employee["benefit"]) ?? null, under18: !!r.under_18,
  ackOn: (r.ack_on as string) ?? null, isHr: !!r.is_hr,
  dismissedOn: (r.dismissed_on as string) ?? null, benefit189: (r.benefit_189 as string) ?? null,
});

/** Поля сотрудника, которые меняет HR, → колонки. */
const EMP_COLS = {
  fullName: "full_name", position: "position", division: "division", department: "department", managerId: "manager_id",
  roleCode: "role_code", isHr: "is_hr", benefit: "benefit", benefit189: "benefit_189", under18: "under_18",
  hiredOn: "hired_on", baseDays: "base_days", extraDays: "extra_days", ackOn: "ack_on",
} as const;
export type EmployeePatch = Partial<Pick<Employee, keyof typeof EMP_COLS>>;
const sqlVal = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null) ?? null);
const toRequest = (r: Row): VacationRequest => ({
  id: Number(r.id), employeeId: String(r.employee_id), year: Number(r.year), status: r.status as VacationRequest["status"],
  submittedAt: (r.submitted_at as string) ?? null, updatedAt: String(r.updated_at),
  exceptionNote: (r.exception_note as string) ?? null,
});
const toChange = (r: Row): PartChange => ({
  id: Number(r.id), partId: Number(r.part_id), employeeId: String(r.employee_id), kind: r.kind as PartChange["kind"],
  oldStart: String(r.old_start), oldEnd: String(r.old_end), newStart: (r.new_start as string) ?? null, newEnd: (r.new_end as string) ?? null,
  reason: r.reason as PartChange["reason"], note: (r.note as string) ?? null, status: r.status as PartChange["status"],
  stage: r.stage as PartChange["stage"], requestedOn: String(r.requested_on), requestedBy: String(r.requested_by), createdAt: String(r.created_at),
  managerBy: (r.manager_by as string) ?? null, managerAt: (r.manager_at as string) ?? null,
  decidedBy: (r.decided_by as string) ?? null, decidedAt: (r.decided_at as string) ?? null, decisionNote: (r.decision_note as string) ?? null,
});
const toPart = (r: Row): RequestPart => ({
  id: Number(r.id), requestId: Number(r.request_id), partNo: Number(r.part_no), type: r.type as RequestPart["type"],
  startDate: String(r.start_date), endDate: String(r.end_date), days: Number(r.days), status: r.status as RequestPart["status"],
  inSchedule: !!r.in_schedule, result: (r.result as string) ?? null, notes: (r.notes as string) ?? null,
  substituteId: (r.substitute_id as string) ?? null, needsPay: !!r.needs_pay,
  treatmentKind: (r.treatment_kind as RequestPart["treatmentKind"]) ?? null,
  reason: (r.reason as string) ?? null, reasonNote: (r.reason_note as string) ?? null,
});
const toRule = (r: Row): Rule => ({
  code: String(r.code), title: String(r.title), params: json(r.params) ?? {}, enabled: !!r.enabled,
  severity: r.severity as Rule["severity"], source: r.source as Rule["source"], basis: String(r.basis), howChecked: String(r.how_checked),
});

/* ---------------- справочники ---------------- */

export const employees = {
  /** Все, включая уволенных: для журнала, истории и имён в старых записях. */
  list: (): Employee[] => all("SELECT * FROM employees ORDER BY id").map(toEmployee),
  /** То же, что list(): все, включая уволенных (имя из запроса экрана «Сотрудники»). */
  listAll: (): Employee[] => employees.list(),
  /** Только работающие (dismissed_on пуст или в будущем) — для списков выбора. */
  listActive: (on?: string): Employee[] =>
    all("SELECT * FROM employees WHERE dismissed_on IS NULL OR dismissed_on > ? ORDER BY id", on ?? new Date().toISOString().slice(0, 10)).map(toEmployee),
  /** Изменить поля сотрудника (HR). Журнал пишет вызывающий. */
  update: (id: string, patch: EmployeePatch) => {
    const before = employees.get(id);
    if (!before) throw new Error(`Нет сотрудника ${id}`);
    const keys = (Object.keys(patch) as (keyof typeof EMP_COLS)[]).filter((k) => k in EMP_COLS && patch[k] !== undefined);
    if (keys.length)
      db().prepare(`UPDATE employees SET ${keys.map((k) => `${EMP_COLS[k]}=?`).join(", ")} WHERE id=?`)
        .run(...keys.map((k) => sqlVal(patch[k])), id);
    return { before, after: employees.get(id)! };
  },
  /** Новый сотрудник: id — следующий E##, email — e##@avistrade.by, если не задан. */
  create: (input: Omit<Employee, "id" | "email" | "dismissedOn" | "ackOn" | "benefit189" | "under18" | "isHr" | "extraDays" | "benefit"> &
    Partial<Pick<Employee, "email" | "ackOn" | "benefit189" | "under18" | "isHr" | "extraDays" | "benefit">>): Employee => {
    const max = Number((one("SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n FROM employees")?.n as number) ?? 0);
    const id = `E${String(max + 1).padStart(2, "0")}`;
    db().prepare(`INSERT INTO employees(id,full_name,email,position,role_code,division,department,manager_id,hired_on,base_days,extra_days,
        benefit,benefit_189,under_18,ack_on,is_hr) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, input.fullName, input.email ?? `${id.toLowerCase()}@avistrade.by`, input.position, input.roleCode, input.division,
        input.department ?? null, input.managerId ?? null, input.hiredOn, input.baseDays, input.extraDays ?? 0, input.benefit ?? null,
        input.benefit189 ?? null, input.under18 ? 1 : 0, input.ackOn ?? null, input.isHr ? 1 : 0);
    return employees.get(id)!;
  },
  /** Уволить с даты (строка остаётся). */
  dismiss: (id: string, on: string) => {
    const before = employees.get(id);
    if (!before) throw new Error(`Нет сотрудника ${id}`);
    db().prepare("UPDATE employees SET dismissed_on=? WHERE id=?").run(on, id);
    return { before, after: employees.get(id)! };
  },
  /** Отменить увольнение. */
  restore: (id: string) => {
    const before = employees.get(id);
    if (!before) throw new Error(`Нет сотрудника ${id}`);
    db().prepare("UPDATE employees SET dismissed_on=NULL WHERE id=?").run(id);
    return { before, after: employees.get(id)! };
  },
  get: (id: string): Employee | null => { const r = one("SELECT * FROM employees WHERE id=?", id); return r ? toEmployee(r) : null; },
  /** Прямые подчинённые. */
  reports: (managerId: string): Employee[] => all("SELECT * FROM employees WHERE manager_id=? ORDER BY id", managerId).map(toEmployee),
  /** Все подчинённые по дереву (без самого руководителя). */
  subtree: (managerId: string): Employee[] =>
    all(`WITH RECURSIVE t(id) AS (SELECT id FROM employees WHERE manager_id=?
         UNION ALL SELECT e.id FROM employees e JOIN t ON e.manager_id=t.id)
         SELECT e.* FROM employees e JOIN t USING(id) ORDER BY e.id`, managerId).map(toEmployee),
};

const toDependency = (r: Row): RoleDependency => ({
  id: Number(r.id), roleCode: r.role_code as RoleDependency["roleCode"], requiresRole: r.requires_role as RoleDependency["requiresRole"],
  scope: r.scope as RoleDependency["scope"], regClause: String(r.reg_clause),
});
const toGroup = (r: Row): LimitGroup => ({
  id: Number(r.id), code: String(r.code), name: String(r.name), roleCode: r.role_code as LimitGroup["roleCode"],
  scope: r.scope as LimitGroup["scope"], maxConcurrent: Number(r.max_concurrent), regClause: String(r.reg_clause),
});

export const roles = {
  list: (): Role[] => all("SELECT * FROM roles").map((r) => ({
    code: r.code as Role["code"], title: String(r.title), groupId: (r.group_id as number) ?? null,
    calendarGroup: String(r.calendar_group), regClause: String(r.reg_clause),
  })),
  dependencies: (): RoleDependency[] => all("SELECT * FROM role_dependencies ORDER BY id").map(toDependency),
  dependency: (id: number): RoleDependency | null => { const r = one("SELECT * FROM role_dependencies WHERE id=?", id); return r ? toDependency(r) : null; },
  groups: (): LimitGroup[] => all("SELECT * FROM groups ORDER BY id").map(toGroup),
  group: (id: number): LimitGroup | null => { const r = one("SELECT * FROM groups WHERE id=?", id); return r ? toGroup(r) : null; },

  /** Лимит и границы группы ограничения. */
  updateGroup: (id: number, patch: Partial<Pick<LimitGroup, "maxConcurrent" | "scope">>) => {
    const before = roles.group(id);
    if (!before) throw new Error(`Нет группы ${id}`);
    const next = { ...before, ...patch };
    db().prepare("UPDATE groups SET max_concurrent=?, scope=? WHERE id=?").run(next.maxConcurrent, next.scope, id);
    return { before, after: roles.group(id)! };
  },
  /** Новая связь «роль уходит, только если requiresRole на месте». Дубль пары ролей — ошибка UNIQUE. */
  addDependency: (d: Omit<RoleDependency, "id">): RoleDependency => {
    const r = db().prepare("INSERT INTO role_dependencies(role_code,requires_role,scope,reg_clause) VALUES (?,?,?,?)")
      .run(d.roleCode, d.requiresRole, d.scope, d.regClause ?? "");
    return roles.dependency(Number(r.lastInsertRowid))!;
  },
  updateDependency: (id: number, patch: Partial<Pick<RoleDependency, "scope">>) => {
    const before = roles.dependency(id);
    if (!before) throw new Error(`Нет связи ролей ${id}`);
    db().prepare("UPDATE role_dependencies SET scope=? WHERE id=?").run(patch.scope ?? before.scope, id);
    return { before, after: roles.dependency(id)! };
  },
  /** Удаляет связь и возвращает удалённую строку для журнала; null — такой не было. */
  removeDependency: (id: number): RoleDependency | null => {
    const before = roles.dependency(id);
    if (before) db().prepare("DELETE FROM role_dependencies WHERE id=?").run(id);
    return before;
  },
};

export const holidays = {
  list: (year?: number): Holiday[] =>
    (year ? all("SELECT * FROM holidays WHERE date LIKE ? ORDER BY date", `${year}-%`) : all("SELECT * FROM holidays ORDER BY date"))
      .map((r) => ({ date: String(r.date), name: String(r.name), nonWorking: !!r.non_working, basis: String(r.basis) })),
  dates: (): Set<string> => new Set(all("SELECT date FROM holidays WHERE non_working=1").map((r) => String(r.date))),
};

/* ---------------- правила ---------------- */

export const rules = {
  list: (): Rule[] => all("SELECT * FROM rules ORDER BY code").map(toRule),
  get: (code: string): Rule | null => { const r = one("SELECT * FROM rules WHERE code=?", code); return r ? toRule(r) : null; },
  update: (code: string, patch: Partial<Pick<Rule, "title" | "params" | "enabled" | "severity" | "basis" | "howChecked">>) => {
    const cur = rules.get(code);
    if (!cur) throw new Error(`Нет правила ${code}`);
    const next = { ...cur, ...patch };
    db().prepare("UPDATE rules SET title=?, params=?, enabled=?, severity=?, basis=?, how_checked=? WHERE code=?")
      .run(next.title, JSON.stringify(next.params), next.enabled ? 1 : 0, next.severity, next.basis, next.howChecked, code);
    return { before: cur, after: next };
  },
};

/* ---------------- заявки и части ---------------- */

export const requests = {
  forEmployee: (employeeId: string, year: number): VacationRequest | null => {
    const r = one("SELECT * FROM requests WHERE employee_id=? AND year=?", employeeId, year);
    return r ? toRequest(r) : null;
  },
  get: (id: number): VacationRequest | null => { const r = one("SELECT * FROM requests WHERE id=?", id); return r ? toRequest(r) : null; },
  list: (year: number): VacationRequest[] => all("SELECT * FROM requests WHERE year=? ORDER BY employee_id", year).map(toRequest),
  ensure: (employeeId: string, year: number): VacationRequest => {
    const cur = requests.forEmployee(employeeId, year);
    if (cur) return cur;
    db().prepare("INSERT INTO requests(employee_id,year,status,updated_at) VALUES (?,?, 'draft', ?)")
      .run(employeeId, year, new Date().toISOString());
    return requests.forEmployee(employeeId, year)!;
  },
  /** Обоснование сотрудника при отправке плана с отступлением от регламента; null — убрать. */
  setExceptionNote: (id: number, note: string | null) =>
    db().prepare("UPDATE requests SET exception_note=?, updated_at=? WHERE id=?").run(note?.trim() || null, new Date().toISOString(), id),
  setStatus: (id: number, status: VacationRequest["status"]) => {
    const now = new Date().toISOString();
    db().prepare("UPDATE requests SET status=?, updated_at=?, submitted_at=CASE WHEN ?='submitted' THEN ? ELSE submitted_at END WHERE id=?")
      .run(status, now, status, now, id);
  },
  /** Вернуть прежний статус (отмена решения): submitted_at не трогает — по нему считается свежесть согласия руководителя. */
  restoreStatus: (id: number, status: VacationRequest["status"]) =>
    db().prepare("UPDATE requests SET status=?, updated_at=? WHERE id=?").run(status, new Date().toISOString(), id),
};

export const parts = {
  forRequest: (requestId: number): RequestPart[] =>
    all("SELECT * FROM request_parts WHERE request_id=? ORDER BY part_no", requestId).map(toPart),
  /** Все части года с сотрудником — для Ганта, загрузки и движка. */
  forYear: (year: number): (RequestPart & { employeeId: string })[] =>
    all(`SELECT p.*, r.employee_id FROM request_parts p JOIN requests r ON r.id=p.request_id
         WHERE r.year=? ORDER BY p.start_date`, year).map((r) => ({ ...toPart(r), employeeId: String(r.employee_id) })),
  get: (id: number): RequestPart | null => { const r = one("SELECT * FROM request_parts WHERE id=?", id); return r ? toPart(r) : null; },
  /** Заменяет части заявки целиком: все части снова черновики, план — черновик до отправки. */
  replace: (requestId: number, input: PartInput[]): RequestPart[] => {
    const hol = holidays.dates();
    const conn = db();
    // замещающий не передан (undefined) — остаётся прежний у части с тем же id
    const prev = new Map(parts.forRequest(requestId).map((p) => [p.id, p]));
    const prevSub = new Map([...prev].map(([id, p]) => [id, p.substituteId]));
    conn.prepare("DELETE FROM request_parts WHERE request_id=?").run(requestId);
    const ins = conn.prepare(`INSERT INTO request_parts(request_id,part_no,type,start_date,end_date,days,status,in_schedule,substitute_id,reason,reason_note,needs_pay,treatment_kind)
                              VALUES (?,?,?,?,?,?,'draft',1,?,?,?,?,?)`);
    input.forEach((p, i) => ins.run(requestId, i + 1, p.type, p.startDate, p.endDate, countVacationDays(p.startDate, p.endDate, hol),
      p.substituteId !== undefined ? p.substituteId : p.id != null ? prevSub.get(p.id) ?? null : null,
      p.type === "unpaid190" || p.type === "unpaid189" ? p.reason ?? null : null,
      p.type === "unpaid190" || p.type === "unpaid189" ? p.reasonNote?.trim() || null : null,
      (p.needsPay !== undefined ? p.needsPay : p.id != null ? prev.get(p.id)?.needsPay ?? false : false) ? 1 : 0,
      p.type === "treatment" ? (p.treatmentKind !== undefined ? p.treatmentKind : p.id != null ? prev.get(p.id)?.treatmentKind ?? null : null) : null));
    conn.prepare("UPDATE requests SET status='draft', updated_at=? WHERE id=?").run(new Date().toISOString(), requestId);
    return parts.forRequest(requestId);
  },
  setStatusForRequest: (requestId: number, status: RequestPart["status"]) =>
    db().prepare("UPDATE request_parts SET status=? WHERE request_id=?").run(status, requestId),
  setStatus: (id: number, status: RequestPart["status"]) =>
    db().prepare("UPDATE request_parts SET status=? WHERE id=?").run(status, id),
  /** Назначить или убрать (null) замещающего части. Журнал пишет вызывающая серверная функция. */
  setSubstitute: (id: number, substituteId: string | null) => {
    const before = parts.get(id);
    if (!before) throw new Error(`Нет части ${id}`);
    db().prepare("UPDATE request_parts SET substitute_id=? WHERE id=?").run(substituteId, id);
    return { before, after: parts.get(id)! };
  },
  /** Части, где сотрудник указан замещающим (кого он замещает) — для экранов и проверки. */
  substitutedBy: (employeeId: string, year: number): (RequestPart & { employeeId: string })[] =>
    all(`SELECT p.*, r.employee_id FROM request_parts p JOIN requests r ON r.id=p.request_id
         WHERE p.substitute_id=? AND r.year=? ORDER BY p.start_date`, employeeId, year)
      .map((r) => ({ ...toPart(r), employeeId: String(r.employee_id) })),
  /** Продление по ст. 171 (больничный и др.) — см. changes.hrApply. */
  extend: (partId: number, newEnd: string, o: { by: string; on: string; note: string; reason?: ChangeReason }) =>
    changes.hrApply({ partId, kind: "extend", newEnd, reason: o.reason ?? "illness", note: o.note, by: o.by, on: o.on }),
  /** Отзыв из отпуска по ст. 174: returnDate — день выхода на работу, часть заканчивается накануне. */
  recall: (partId: number, returnDate: string, o: { by: string; on: string; note: string }) => {
    const d = new Date(Date.UTC(+returnDate.slice(0, 4), +returnDate.slice(5, 7) - 1, +returnDate.slice(8, 10) - 1)).toISOString().slice(0, 10);
    return changes.hrApply({ partId, kind: "recall", newEnd: d, reason: "agreement", note: o.note, by: o.by, on: o.on });
  },
  /** Итог движка по части. */
  setResult: (id: number, result: string | null, notes: string | null) =>
    db().prepare("UPDATE request_parts SET result=?, notes=? WHERE id=?").run(result, notes, id),
};

/* ---------------- изменение согласованной части ---------------- */

/**
 * Заявки на перенос / сокращение / отказ и записи о продлении и отзыве (part_changes).
 * Маршрут: open+manager → managerApprove → open+hr → approve (даты части меняются) | reject | returnBack.
 * Журнал (logAudit) пишет вызывающая серверная функция; всё — в transaction().
 */
export const changes = {
  get: (id: number): PartChange | null => { const r = one("SELECT * FROM part_changes WHERE id=?", id); return r ? toChange(r) : null; },
  /** Все заявки по частям года (по году части). */
  forYear: (year: number): PartChange[] =>
    all(`SELECT c.* FROM part_changes c JOIN request_parts p ON p.id=c.part_id JOIN requests r ON r.id=p.request_id
         WHERE r.year=? ORDER BY c.created_at DESC`, year).map(toChange),
  /** Открытые заявки любых лет (поздний перенос отпуска текущего года тоже сюда). stage — фильтр по шагу. */
  open: (stage?: PartChange["stage"]): PartChange[] =>
    (stage ? all("SELECT * FROM part_changes WHERE status='open' AND stage=? ORDER BY created_at", stage)
      : all("SELECT * FROM part_changes WHERE status='open' ORDER BY created_at")).map(toChange),
  forEmployee: (employeeId: string): PartChange[] =>
    all("SELECT * FROM part_changes WHERE employee_id=? ORDER BY created_at DESC", employeeId).map(toChange),
  /** Открытая заявка по части (не больше одной). */
  openForPart: (partId: number): PartChange | null => {
    const r = one("SELECT * FROM part_changes WHERE part_id=? AND status='open'", partId);
    return r ? toChange(r) : null;
  },
  /** Новая заявка сотрудника. Ошибка, если по части уже есть открытая. */
  create: (c: { partId: number; kind: Extract<ChangeKind, "move" | "shorten" | "cancel">; newStart: string | null; newEnd: string | null;
    reason?: ChangeReason; note: string; requestedBy: string; requestedOn: string; stage: PartChange["stage"] }): PartChange => {
    const p = parts.get(c.partId);
    if (!p) throw new Error(`Нет части ${c.partId}`);
    if (changes.openForPart(c.partId)) throw new Error("По этой части уже есть заявка на изменение");
    const emp = one("SELECT r.employee_id FROM requests r WHERE r.id=?", p.requestId)!.employee_id as string;
    const r = db().prepare(`INSERT INTO part_changes(part_id,employee_id,kind,old_start,old_end,new_start,new_end,reason,note,status,stage,
        requested_on,requested_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?)`)
      .run(c.partId, emp, c.kind, p.startDate, p.endDate, c.kind === "cancel" ? null : c.newStart, c.kind === "cancel" ? null : c.newEnd,
        c.reason ?? "agreement", c.note.trim() || null, c.stage, c.requestedOn, c.requestedBy, new Date().toISOString());
    return changes.get(Number(r.lastInsertRowid))!;
  },
  /** Сотрудник отзывает свою открытую или возвращённую заявку. */
  withdraw: (id: number) => changes.setState(id, { status: "withdrawn" }),
  /** Руководитель пропустил заявку к HR. */
  managerApprove: (id: number, by: string, note?: string | null) => {
    const before = changes.get(id)!;
    db().prepare("UPDATE part_changes SET stage='hr', manager_by=?, manager_at=?, decision_note=COALESCE(?, decision_note) WHERE id=?")
      .run(by, new Date().toISOString(), note?.trim() || null, id);
    return { before, after: changes.get(id)! };
  },
  /** Вернуть сотруднику на доработку (руководитель или HR). */
  returnBack: (id: number, by: string, note: string) => changes.setState(id, { status: "returned", decidedBy: by, decisionNote: note }),
  /** Отказать (HR): часть остаётся как была. */
  reject: (id: number, by: string, note: string) => changes.setState(id, { status: "rejected", decidedBy: by, decisionNote: note }),
  /** Окончательно согласовать (HR) и применить к части: новые даты или отказ от части. */
  approve: (id: number, by: string, note?: string | null) => {
    const c = changes.get(id);
    if (!c || c.status !== "open") throw new Error("Заявка не ждёт решения");
    const part = changes.applyToPart(c);
    const res = changes.setState(id, { status: "approved", decidedBy: by, decisionNote: note ?? null });
    return { ...res, part };
  },
  /** Применить даты заявки к части (без смены статуса заявки). Отказ от части — часть получает статус rejected. */
  applyToPart: (c: PartChange) => {
    const before = parts.get(c.partId)!;
    if (c.kind === "cancel") db().prepare("UPDATE request_parts SET status='rejected' WHERE id=?").run(c.partId);
    else db().prepare("UPDATE request_parts SET start_date=?, end_date=?, days=? WHERE id=?")
      .run(c.newStart!, c.newEnd!, vacationDays(c.newStart!, c.newEnd!), c.partId);
    return { before, after: parts.get(c.partId)! };
  },
  /**
   * HR оформляет продление (ст. 171, например по больничному) или отзыв (ст. 174, с согласия работника):
   * запись в part_changes сразу согласована, даты части меняются. recall: returnDate — первый рабочий день,
   * часть заканчивается накануне; неиспользованные дни возвращаются в остаток (days пересчитываются).
   */
  hrApply: (c: { partId: number; kind: "extend" | "recall"; newEnd: string; reason: ChangeReason; note: string; by: string; on: string }) => {
    const p = parts.get(c.partId);
    if (!p) throw new Error(`Нет части ${c.partId}`);
    if (c.newEnd < p.startDate) throw new Error("Новая дата окончания раньше начала отпуска");
    const r = db().prepare(`INSERT INTO part_changes(part_id,employee_id,kind,old_start,old_end,new_start,new_end,reason,note,status,stage,
        requested_on,requested_by,created_at,decided_by,decided_at) VALUES (?,(SELECT employee_id FROM requests WHERE id=?),?,?,?,?,?,?,?,'approved','hr',?,?,?,?,?)`)
      .run(c.partId, p.requestId, c.kind, p.startDate, p.endDate, p.startDate, c.newEnd, c.reason, c.note.trim() || null,
        c.on, c.by, new Date().toISOString(), c.by, new Date().toISOString());
    const ch = changes.get(Number(r.lastInsertRowid))!;
    return { change: ch, part: changes.applyToPart(ch) };
  },
  setState: (id: number, s: { status: PartChange["status"]; decidedBy?: string; decisionNote?: string | null }) => {
    const before = changes.get(id);
    if (!before) throw new Error(`Нет заявки ${id}`);
    db().prepare("UPDATE part_changes SET status=?, decided_by=COALESCE(?, decided_by), decided_at=?, decision_note=COALESCE(?, decision_note) WHERE id=?")
      .run(s.status, s.decidedBy ?? null, s.decidedBy ? new Date().toISOString() : before.decidedAt, s.decisionNote?.trim() || null, id);
    return { before, after: changes.get(id)! };
  },
};

/* ---------------- исключения и журнал ---------------- */

export const exceptions = {
  list: (): RuleException[] => all("SELECT * FROM exceptions ORDER BY created_at DESC").map((r) => ({
    id: Number(r.id), createdAt: String(r.created_at), createdBy: String(r.created_by), employeeId: String(r.employee_id),
    partId: (r.part_id as number) ?? null, ruleCode: String(r.rule_code), decision: r.decision as RuleException["decision"],
    reason: String(r.reason), active: !!r.active,
  })),
  add: (e: Omit<RuleException, "id" | "createdAt" | "active">): number =>
    Number(db().prepare(`INSERT INTO exceptions(created_at,created_by,employee_id,part_id,rule_code,decision,reason,active)
                         VALUES (?,?,?,?,?,?,?,1)`)
      .run(new Date().toISOString(), e.createdBy, e.employeeId, e.partId, e.ruleCode, e.decision, e.reason).lastInsertRowid),
  /** Включить или выключить исключение (отмена). Строку не удаляем: журнал только на добавление. */
  setActive: (id: number, active: boolean) =>
    db().prepare("UPDATE exceptions SET active=? WHERE id=?").run(active ? 1 : 0, id),
};

/* ---------------- настройки (таблица meta: ключ — строковое значение) ---------------- */

export const settings = {
  get: (key: string): string | null => (one("SELECT value FROM meta WHERE key=?", key)?.value as string | undefined) ?? null,
  set: (key: string, value: string) =>
    db().prepare("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value),
};

/** Маршрут согласования и приватность — ключи meta с умолчаниями (ROUTE_DEFAULTS). Журнал пишет вызывающий. */
const ROUTE_KEYS: Record<keyof RouteSettings, string> = {
  ro1Id: "route.ro1Id", ro1ReviewerId: "route.ro1ReviewerId", scheduleApproverId: "route.scheduleApproverId",
  unionRequired: "route.unionRequired", showColleagueNames: "show_colleague_names",
};
export const routeSettings = {
  get: (): RouteSettings => {
    const v = (k: keyof RouteSettings) => settings.get(ROUTE_KEYS[k]);
    const flag = (k: "unionRequired" | "showColleagueNames") => (v(k) == null ? ROUTE_DEFAULTS[k] : v(k) === "1");
    return {
      ro1Id: v("ro1Id") ?? ROUTE_DEFAULTS.ro1Id,
      ro1ReviewerId: v("ro1ReviewerId") ?? ROUTE_DEFAULTS.ro1ReviewerId,
      scheduleApproverId: v("scheduleApproverId") ?? ROUTE_DEFAULTS.scheduleApproverId,
      unionRequired: flag("unionRequired"),
      showColleagueNames: flag("showColleagueNames"),
    };
  },
  set: (patch: Partial<RouteSettings>) => {
    const before = routeSettings.get();
    for (const [k, val] of Object.entries(patch) as [keyof RouteSettings, RouteSettings[keyof RouteSettings]][]) {
      if (val === undefined) continue;
      settings.set(ROUTE_KEYS[k], typeof val === "boolean" ? (val ? "1" : "0") : String(val));
    }
    return { before, after: routeSettings.get() };
  },
};

const toSchedule = (r: Row): Schedule => ({
  year: Number(r.year), half: Number(r.half) as Schedule["half"], deadline: scheduleDeadline(Number(r.year), Number(r.half) as Schedule["half"]), status: r.status as Schedule["status"], submittedBy: (r.submitted_by as string) ?? null,
  submittedAt: (r.submitted_at as string) ?? null, decidedBy: (r.decided_by as string) ?? null, decidedAt: (r.decided_at as string) ?? null,
  comment: (r.comment as string) ?? null, unionDate: (r.union_date as string) ?? null, unionProtocol: (r.union_protocol as string) ?? null,
});
/** Статус графика на год. Переходы и права — в actions/schedule.ts; здесь только запись с {before, after}. */
export const schedules = {
  /** График полугодия (по умолчанию I). */
  get: (year: number, half: Schedule["half"] = 1): Schedule => {
    const r = one("SELECT * FROM schedules WHERE year=? AND half=?", year, half);
    return r ? toSchedule(r) : { year, half, deadline: scheduleDeadline(year, half), status: "collecting", submittedBy: null, submittedAt: null,
      decidedBy: null, decidedAt: null, comment: null, unionDate: null, unionProtocol: null };
  },
  /** Оба полугодия года. */
  list: (year: number): Schedule[] => [schedules.get(year, 1), schedules.get(year, 2)],
  /** Полугодие, в которое попадает дата. */
  halfOf: (iso: string): Schedule["half"] => (+iso.slice(5, 7) <= 6 ? 1 : 2),
  save: (s: Schedule) => {
    const before = schedules.get(s.year, s.half);
    db().prepare(`INSERT INTO schedules(year,half,status,submitted_by,submitted_at,decided_by,decided_at,comment,union_date,union_protocol)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(year,half) DO UPDATE SET status=excluded.status, submitted_by=excluded.submitted_by,
      submitted_at=excluded.submitted_at, decided_by=excluded.decided_by, decided_at=excluded.decided_at, comment=excluded.comment,
      union_date=excluded.union_date, union_protocol=excluded.union_protocol`)
      .run(s.year, s.half, s.status, s.submittedBy, s.submittedAt, s.decidedBy, s.decidedAt, s.comment, s.unionDate, s.unionProtocol);
    return { before, after: schedules.get(s.year, s.half) };
  },
};

const toNotification = (r: Row): AppNotification => ({
  id: Number(r.id), employeeId: String(r.employee_id), kind: r.kind as AppNotification["kind"], text: String(r.text),
  href: (r.href as string) ?? null, createdAt: String(r.created_at), readAt: (r.read_at as string) ?? null,
});
/** Уведомления в приложении. Создавать — через notify() из src/server/notify.ts. */
export const notifications = {
  forEmployee: (employeeId: string, limit = 30): AppNotification[] =>
    all("SELECT * FROM notifications WHERE employee_id=? ORDER BY created_at DESC, id DESC LIMIT ?", employeeId, limit).map(toNotification),
  unreadCount: (employeeId: string): number =>
    Number(one("SELECT count(*) AS n FROM notifications WHERE employee_id=? AND read_at IS NULL", employeeId)?.n ?? 0),
  add: (employeeIds: string[], n: { text: string; href?: string | null; kind?: AppNotification["kind"] }) => {
    const ins = db().prepare("INSERT INTO notifications(employee_id,kind,text,href,created_at) VALUES (?,?,?,?,?)");
    const at = new Date().toISOString();
    for (const id of [...new Set(employeeIds)]) ins.run(id, n.kind ?? "info", n.text, n.href ?? null, at);
  },
  markRead: (id: number, employeeId: string) =>
    db().prepare("UPDATE notifications SET read_at=? WHERE id=? AND employee_id=? AND read_at IS NULL").run(new Date().toISOString(), id, employeeId),
  markAllRead: (employeeId: string) =>
    db().prepare("UPDATE notifications SET read_at=? WHERE employee_id=? AND read_at IS NULL").run(new Date().toISOString(), employeeId),
};

export const audit = {
  insert: (e: Omit<AuditEntry, "id" | "at">) =>
    db().prepare("INSERT INTO audit_log(at,actor_id,action,entity,entity_id,before,after) VALUES (?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), e.actorId, e.action, e.entity, e.entityId,
        e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after)),
  list: (opts: { limit?: number; entity?: string; actorId?: string } = {}): AuditEntry[] => {
    const where: string[] = [], args: (string | number)[] = [];
    if (opts.entity) { where.push("entity=?"); args.push(opts.entity); }
    if (opts.actorId) { where.push("actor_id=?"); args.push(opts.actorId); }
    return all(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC, id DESC LIMIT ?`,
      ...args, opts.limit ?? 200).map((r) => ({
      id: Number(r.id), at: String(r.at), actorId: (r.actor_id as string) ?? null, action: String(r.action),
      entity: String(r.entity), entityId: (r.entity_id as string) ?? null, before: json(r.before), after: json(r.after),
    }));
  },
};
