/**
 * Журнал для HR: строки `audit_log` → понятные записи «кто, что, над кем, было → стало».
 * Только чтение; доступ проверяет вызывающая страница.
 */
import "server-only";
import { audit, changes as partChanges, employees, exceptions, parts, requests, roles, rules } from "@/server/db/repo";
import type { AuditEntry, Employee, LimitGroup, PartChange, RoleCode, Schedule, ScheduleHalf, ScheduleStatus, RequestPart, RoleDependency, Rule, RuleException } from "@/server/db/types";
import {
  BENEFITS_189, CHANGE_KIND_LABEL, CHANGE_REASON_LABEL, SCHEDULE_HALF_LABEL, SCHEDULE_STATUS_LABEL, PART_STATUS_LABEL, REQUEST_STATUS_LABEL, VACATION_TYPE_LABEL,
} from "@/server/db/types";
import { fmtDate, fmtRange } from "@/lib/dates";
import { PLAN_YEAR } from "@/lib/config";
import { personChanges, ruleChanges, ruleTitle, shortName, type FieldChange } from "@/components/hr-admin/meta";

/** Тип действия для фильтра. */
export type LogKind = "plan" | "submit" | "approve" | "return" | "change" | "exception" | "rule" | "people" | "schedule" | "remind" | "other";
export const LOG_KIND_LABEL: Record<LogKind, string> = {
  plan: "Сохранил план", submit: "Отправил на согласование", approve: "Согласовал", return: "Вернул или отклонил",
  change: "Переносы",
  exception: "Исключение РО1", rule: "Изменил правило", people: "Сотрудники", schedule: "Утверждение графика", remind: "Напоминание", other: "Вход и система",
};

export interface LogException {
  ruleCode: string;
  ruleTitle: string;
  reason: string;
  decision: "allow" | "return";
  approvedBy: string;
  part: string | null;
}

export interface LogRow {
  id: number;
  at: string;
  kind: LogKind;
  actorId: string | null;
  actorName: string;
  /** Сотрудник, которого касается запись (чей план, кому напоминание) */
  subjectId: string | null;
  subjectName: string | null;
  summary: string;
  changes: FieldChange[];
  exception?: LogException;
}

/** Решения по части: действие журнала → тип для фильтра и подпись. */
const PART_ACTION: Record<string, [LogKind, string]> = {
  approved: ["approve", "Часть отпуска согласована"],
  approve: ["approve", "Часть отпуска согласована"],
  manager_approve: ["approve", "Согласовано руководителем, передано РО1"],
  returned: ["return", "Часть возвращена на доработку"],
  return: ["return", "Часть возвращена на доработку"],
  rejected: ["return", "Часть отпуска отклонена"],
  undo: ["return", "Решение по части отменено"],
  manager_undo: ["return", "Согласование руководителя отменено"],
};

/** Утверждение графика (actions/route.ts): действие → подпись, к ней добавляется год. */
const SCHEDULE_ACTION: Record<string, string> = {
  schedule_submit: "График отправлен на утверждение,",
  schedule_approve: "График утверждён и разослан,",
  schedule_return: "График возвращён на доработку,",
};

/** Карточка сотрудника (экран «Сотрудники»): действие → подпись. */
const PERSON_ACTION: Record<string, string> = {
  update: "Изменена карточка сотрудника",
  create: "Принят новый сотрудник",
  dismiss: "Сотрудник уволен",
  restore: "Увольнение отменено",
};

/** Заявка на изменение согласованной части (src/server/actions/changes.ts): действие → подпись. */
const CHANGE_ACTION: Record<string, (c: PartChange) => string> = {
  change_request: (c) => `Запрос: ${CHANGE_KIND_LABEL[c.kind].toLowerCase()}`,
  change_withdraw: (c) => `Запрос отозван: ${CHANGE_KIND_LABEL[c.kind].toLowerCase()}`,
  change_manager: (c) => `${CHANGE_KIND_LABEL[c.kind]}: руководитель передал РО1`,
  change_return: (c) => `${CHANGE_KIND_LABEL[c.kind]}: запрос возвращён на доработку`,
  change_reject: (c) => `${CHANGE_KIND_LABEL[c.kind]}: отказано`,
  change_approve: (c) => `${CHANGE_KIND_LABEL[c.kind]}: согласовано`,
};
/** Изменение самой части по решению: перенос, продление по болезни (ст. 171), отзыв (ст. 174). */
const PART_CHANGE_ACTION: Record<string, string> = {
  part_reschedule: "Даты части изменены по согласованному запросу",
  part_extend: "Отпуск продлён (ст. 171 ТК)",
  part_recall: "Отзыв из отпуска (ст. 174 ТК)",
};
const changeDates = (start: string | null, end: string | null) => (start && end ? fmtRange(start, end) : "без дат");

const partText = (p: Pick<RequestPart, "partNo" | "type" | "startDate" | "endDate" | "days">) =>
  `${fmtRange(p.startDate, p.endDate)}, ${p.days} дн.${p.type !== "main" ? ` (${VACATION_TYPE_LABEL[p.type]})` : ""}`;

function partsDiff(beforeRaw: unknown, afterRaw: unknown): FieldChange[] {
  const before = Array.isArray(beforeRaw) ? (beforeRaw as RequestPart[]) : [];
  const after = Array.isArray(afterRaw) ? (afterRaw as RequestPart[]) : [];
  const out: FieldChange[] = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = before[i], b = after[i];
    const at = a ? partText(a) : "—", bt = b ? partText(b) : "—";
    if (at !== bt) out.push({ label: `Часть ${i + 1}`, before: at, after: bt });
  }
  return out;
}

function exceptionOf(x: Partial<RuleException> | undefined, ruleMap: Map<string, Rule>, name: (id?: string | null) => string, partById: Map<number, RequestPart>, actor: string): LogException | undefined {
  if (!x?.ruleCode) return undefined;
  const r = ruleMap.get(x.ruleCode);
  const p = x.partId != null ? partById.get(x.partId) : undefined;
  return {
    ruleCode: x.ruleCode, ruleTitle: r ? ruleTitle(r) : x.ruleCode, reason: x.reason ?? "", decision: x.decision ?? "allow",
    approvedBy: x.createdBy ? name(x.createdBy) : actor, part: p ? `часть ${p.partNo}, ${fmtRange(p.startDate, p.endDate)}` : null,
  };
}

export function getJournal(limit = 500) {
  const emps = employees.list();
  const names = new Map(emps.map((e) => [e.id, e.fullName]));
  const name = (id?: string | null) => (id ? names.get(id) ?? id : "система");
  const reqOwner = new Map(requests.list(PLAN_YEAR).map((r) => [String(r.id), r.employeeId]));
  const allParts = parts.forYear(PLAN_YEAR);
  const partById = new Map(allParts.map((p) => [p.id, p]));
  const partOwner = new Map(allParts.map((p) => [String(p.id), p.employeeId]));
  const ruleMap = new Map(rules.list().map((r) => [r.code, r]));
  const groupMap = new Map(roles.groups().map((g) => [String(g.id), g]));
  const roleTitle = new Map(roles.list().map((r) => [r.code, r.title]));
  const excById = new Map(exceptions.list().map((x) => [String(x.id), x]));
  const roleGroup = new Map(roles.list().map((r) => [r.code, roles.groups().find((g) => g.id === r.groupId)?.name ?? null]));
  const groupOfRole = (code: RoleCode) => roleGroup.get(code) ?? null;
  const personLookups = {
    name: (id: string | null) => (id ? name(id) : null), roleTitle: (c: RoleCode) => roleTitle.get(c) ?? c, groupOf: groupOfRole,
    label189: (code: string | null) => (code ? BENEFITS_189.find((b) => b.code === code)?.label ?? code : null),
  };

  const toRow = (a: AuditEntry): LogRow => {
    const actorName = a.actorId ? name(a.actorId) : "система";
    const base = { id: a.id, at: a.at, actorId: a.actorId, actorName, subjectId: null as string | null, changes: [] as FieldChange[] };
    const b = a.before as Record<string, unknown> | null, f = a.after as Record<string, unknown> | null;
    const row = (kind: LogKind, summary: string, extra: Partial<LogRow> = {}): LogRow => {
      const subjectId = extra.subjectId ?? base.subjectId;
      return { ...base, kind, summary, subjectName: subjectId ? name(subjectId) : null, ...extra, subjectId };
    };

    if (a.entity === "request" && a.action === "update") {
      const owner = reqOwner.get(a.entityId ?? "") ?? a.actorId;
      return row("plan", "План отпуска сохранён", { subjectId: owner, changes: partsDiff(a.before as RequestPart[], a.after as RequestPart[]) });
    }
    if (a.entity === "request" && a.action === "submit") {
      const owner = reqOwner.get(a.entityId ?? "") ?? a.actorId;
      return row("submit", "План отправлен на согласование", {
        subjectId: owner,
        changes: [{ label: "Статус плана", before: REQUEST_STATUS_LABEL[b?.status as keyof typeof REQUEST_STATUS_LABEL] ?? String(b?.status ?? "—"), after: REQUEST_STATUS_LABEL.submitted }],
      });
    }
    if (a.entity === "change" && CHANGE_ACTION[a.action]) {
      const c = ((f ?? b) as PartChange | null) ?? partChanges.get(Number(a.entityId));
      if (!c) return row("change", "Запрос на изменение отпуска");
      const out: FieldChange[] = [{ label: "Даты", before: changeDates(c.oldStart, c.oldEnd), after: c.kind === "cancel" ? "часть отменена" : changeDates(c.newStart, c.newEnd) }];
      if (a.action === "change_request") out.push({ label: "Основание", before: "", after: CHANGE_REASON_LABEL[c.reason] ?? String(c.reason) });
      if (a.action === "change_request" && c.note) out.push({ label: "Причина", before: "", after: c.note });
      if (a.action === "change_manager") out.push({ label: "Этап", before: "у руководителя", after: "у РО1" });
      if (c.decisionNote && a.action !== "change_request") out.push({ label: "Комментарий", before: "", after: c.decisionNote });
      return row("change", CHANGE_ACTION[a.action](c), {
        subjectId: c.employeeId, changes: out,
      });
    }
    if (a.entity === "part" && PART_CHANGE_ACTION[a.action]) {
      const before = b as Partial<RequestPart> | null;
      const changeId = Number(f?.changeId);
      const owner = (f?.employeeId as string | undefined) ?? partOwner.get(a.entityId ?? "") ?? (changeId ? partChanges.get(changeId)?.employeeId : null) ?? null;
      const out: FieldChange[] = [];
      if (before?.startDate && before?.endDate && f?.startDate && f?.endDate)
        out.push({ label: "Даты", before: fmtRange(before.startDate, before.endDate), after: fmtRange(String(f.startDate), String(f.endDate)) });
      if (f?.basis) out.push({ label: "Основание", before: "", after: String(f.basis) });
      if (f?.consent) out.push({ label: "Согласие работника", before: "", after: "получено" });
      return row("change", PART_CHANGE_ACTION[a.action], { subjectId: owner, changes: out });
    }
    if (a.entity === "part" && PART_ACTION[a.action]) {
      const owner = partOwner.get(a.entityId ?? "") ?? null;
      const p = partById.get(Number(a.entityId));
      const st = (s: unknown) => PART_STATUS_LABEL[s as keyof typeof PART_STATUS_LABEL] ?? String(s ?? "—");
      // даты части с тех пор могли поменяться: берём их из самой записи, иначе только номер
      const at = (f?.startDate ?? b?.startDate) && (f?.endDate ?? b?.endDate) ? `, ${fmtRange(String(f?.startDate ?? b?.startDate), String(f?.endDate ?? b?.endDate))}` : "";
      const label = p ? `Часть ${p.partNo}${at}` : "Часть";
      const changes: FieldChange[] = [];
      if (b?.status !== f?.status && (b?.status || f?.status)) changes.push({ label, before: st(b?.status), after: st(f?.status) });
      const stage = (x: unknown) => (x === "hr" ? "у РО1" : x === "manager" ? "у руководителя" : String(x ?? "—"));
      if (b?.stage !== f?.stage && (b?.stage || f?.stage)) changes.push({ label: changes.length ? "Этап" : `${label}, этап`, before: stage(b?.stage), after: stage(f?.stage) });
      if (f?.startDate && f?.endDate && b?.startDate && b?.endDate)
        changes.push({ label: "Даты", before: fmtRange(String(b.startDate), String(b.endDate)), after: fmtRange(String(f.startDate), String(f.endDate)) });
      if (f?.comment) changes.push({ label: "Комментарий", before: "", after: String(f.comment) });
      const windows = Array.isArray(f?.windows) ? (f.windows as { start: string; end: string }[]) : [];
      if (windows.length) changes.push({ label: "Предложены даты", before: "", after: windows.map((w) => fmtRange(w.start, w.end)).join(", ") });
      const [kind, verb] = PART_ACTION[a.action];
      return row(kind, f?.by === "hr" && a.action === "approve" ? "Часть согласована HR" : verb, { subjectId: owner, changes });
    }
    if (a.entity === "exception" || a.action === "exception") {
      const saved = excById.get(a.entityId ?? "");
      const x = (f as Partial<RuleException> | null) ?? saved;
      const ex = exceptionOf({ ...saved, ...x }, ruleMap, name, partById, actorName);
      return row("exception", ex?.decision === "return" ? "В исключении отказано" : "Разрешено исключение из правила", {
        subjectId: (x?.employeeId ?? saved?.employeeId) || null, exception: ex,
      });
    }
    if (a.entity === "rule") {
      const before = a.before as Rule | null, after = a.after as Rule | null;
      const r = after ?? before;
      return row("rule", `Изменено правило ${a.entityId}${r ? `. ${ruleTitle(before ?? r)}` : ""}`, {
        changes: before && after ? ruleChanges(before, after) : [],
      });
    }
    if (a.entity === "group") {
      const before = a.before as LimitGroup | null, after = a.after as LimitGroup | null;
      const g = after ?? before ?? groupMap.get(a.entityId ?? "");
      const changes: FieldChange[] = [];
      if (before && after && before.maxConcurrent !== after.maxConcurrent) changes.push({ label: "Лимит одновременно", before: String(before.maxConcurrent), after: String(after.maxConcurrent) });
      if (before && after && before.scope !== after.scope) changes.push({ label: "В пределах", before: before.scope, after: after.scope });
      return row("rule", `Изменён лимит группы «${g?.name ?? a.entityId}»`, { changes });
    }
    if (a.entity === "setting" && a.entityId === "show_colleague_names") {
      const shown = (v: unknown) => ((v as { showColleagueNames?: boolean } | null)?.showColleagueNames ? "видят" : "скрыты");
      const on = (a.after as { showColleagueNames?: boolean } | null)?.showColleagueNames;
      return row("rule", on ? "Сотрудникам открыты имена коллег в календаре" : "Имена коллег скрыты от сотрудников", {
        changes: [{ label: "Имена коллег", before: a.before ? shown(a.before) : "", after: shown(a.after) }],
      });
    }
    if (a.entity === "dependency") {
      const d =(a.after ?? a.before) as RoleDependency | null;
      const what = d ? `${roleTitle.get(d.roleCode) ?? d.roleCode} ждёт: ${(roleTitle.get(d.requiresRole) ?? d.requiresRole).toLowerCase()}` : `№ ${a.entityId}`;
      const before = a.before as RoleDependency | null, after = a.after as RoleDependency | null;
      const verb = a.action === "create" ? "Добавлена зависимость ролей" : a.action === "delete" ? "Удалена зависимость ролей" : "Изменена зависимость ролей";
      return row("rule", `${verb}: ${what}`, {
        changes: [{ label: "В пределах", before: before?.scope ?? "нет", after: after?.scope ?? "удалена" }],
      });
    }
    if (a.entity === "settings" && a.action === "route_update") {
      const who = (id: unknown) => (id ? shortName(name(String(id))) : "—");
      const out: FieldChange[] = [];
      for (const [k, label] of [["ro1Id", "РО1"], ["ro1ReviewerId", "Отпуск РО1 проверяет"], ["scheduleApproverId", "Утверждает график"]] as const)
        if (b?.[k] !== f?.[k]) out.push({ label, before: who(b?.[k]), after: who(f?.[k]) });
      if (b?.unionRequired !== f?.unionRequired) out.push({ label: "Профсоюз", before: b?.unionRequired ? "согласует" : "не участвует", after: f?.unionRequired ? "согласует" : "не участвует" });
      if (b?.showColleagueNames !== f?.showColleagueNames && f?.showColleagueNames !== undefined)
        out.push({ label: "Имена коллег", before: b?.showColleagueNames ? "видят" : "скрыты", after: f.showColleagueNames ? "видят" : "скрыты" });
      return row("rule", "Изменён маршрут согласования", { changes: out });
    }
    if (a.entity === "schedule" && SCHEDULE_ACTION[a.action]) {
      const s = f as Partial<Schedule> | null;
      const out: FieldChange[] = [{ label: "График", before: SCHEDULE_STATUS_LABEL[(b?.status as ScheduleStatus) ?? "collecting"], after: SCHEDULE_STATUS_LABEL[(s?.status as ScheduleStatus) ?? "collecting"] }];
      if (a.action === "schedule_approve") out.push({ label: "Рассылка", before: "", after: "уведомление всем работникам (ч. 2 ст. 168 ТК)" });
      if (s?.unionProtocol && a.action === "schedule_submit") out.push({ label: "Профсоюз", before: "", after: `протокол № ${s.unionProtocol}${s.unionDate ? ` от ${fmtDate(s.unionDate, true)}` : ""}` });
      if (s?.comment) out.push({ label: "Комментарий", before: "", after: s.comment });
      // entityId — «2027-1» / «2027-2» (полугодие по регламенту) или «2027» в записях до полугодий
      const [y, h] = String(a.entityId ?? "").split("-");
      if (h && a.action === "schedule_submit")
        out.push({ label: "Срок", before: "", after: "полугодие по регламенту, по ч. 2 ст. 168 ТК — год", risky: true });
      return row("schedule", `${SCHEDULE_ACTION[a.action]} ${h ? `${SCHEDULE_HALF_LABEL[Number(h) as ScheduleHalf].toLowerCase()} ` : ""}${y}`.trim(), { changes: out });
    }
    if (a.entity === "employee" && PERSON_ACTION[a.action]) {
      const before = b as Employee | null, after = f as Employee | null;
      const changes = a.action === "update" && before && after ? personChanges(before, after, personLookups)
        : a.action === "create" && after ? personChanges(null, after, personLookups).filter((c) => ["Должность", "Отдел", "Руководитель", "Роль", "Дата приёма"].includes(c.label))
        : a.action === "dismiss" && after?.dismissedOn ? [{ label: "Дата увольнения", before: "", after: fmtDate(after.dismissedOn, true) }]
        : [];
      return row("people", PERSON_ACTION[a.action], { subjectId: a.entityId, changes });
    }
    if (a.action === "remind") {
      const kind = f?.kind === "decision" ? "решить по плану" : "подать план отпуска";
      const to = f?.to ? name(String(f.to)) : name(a.entityId);
      return row("remind", f?.kind === "decision" ? `Напоминание руководителю: ${to}` : "Напоминание подать план", {
        subjectId: a.entityId,
        changes: [{ label: "Напоминание", before: "", after: `${kind}${f?.deadline ? ` до ${fmtDate(String(f.deadline), true)}` : ""}` }],
      });
    }
    if (a.entity === "request" && a.action === "restore") {
      const owner = reqOwner.get(a.entityId ?? "") ?? a.actorId;
      return row("plan", "План восстановлен", { subjectId: owner, changes: partsDiff(a.before as RequestPart[], a.after as RequestPart[]) });
    }
    if (a.action === "login") return row("other", `Демо-вход как ${name(String(f?.as ?? a.entityId))}`);
    if (a.action === "seed") return row("other", "База заполнена демо-данными");
    return row("other", `${a.action} ${a.entity}${a.entityId ? ` ${a.entityId}` : ""}`, {
      changes: a.before != null || a.after != null ? [{ label: "Данные", before: short(a.before), after: short(a.after) }] : [],
    });
  };

  const rows = audit.list({ limit }).map(toRow);
  // исключения HR из базы, у которых нет записи в журнале (например, из демо-данных)
  const logged = new Set(rows.filter((r) => r.kind === "exception").map((r) => r.exception?.reason));
  const registry = exceptions.list().map((x) => ({
    id: x.id, at: x.createdAt, employeeId: x.employeeId, employeeName: name(x.employeeId), active: x.active,
    ...exceptionOf(x, ruleMap, name, partById, name(x.createdBy))!,
    logged: logged.has(x.reason),
  }));
  return {
    rows,
    exceptions: registry,
    people: emps.map((e) => ({ id: e.id, name: e.fullName, position: e.position })),
  };
}

function short(v: unknown) {
  if (v == null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}
