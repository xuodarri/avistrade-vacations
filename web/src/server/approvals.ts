/**
 * Маршрут согласования по регламенту: сотрудник → непосредственный руководитель → HR.
 * Шаг руководителя хранится в журнале (`audit_log`, action `manager_approve`, entity `part`):
 * часть остаётся «На согласовании», пока HR не согласует её окончательно. Здесь же — контекст
 * движка на год для экранов HR и руководителя.
 */
import "server-only";
import { checkPlan as checkDomainPlan, withOpenChanges, type CheckContext, type CheckResult, type PartChange as DomainPartChange } from "@/domain";
import { changeFromDb, planFromDb } from "@/domain/fromDb";
import { audit, changes, parts, requests, routeSettings } from "./db/repo";
import type { RequestPart, VacationRequest } from "./db/types";
import type { BoardChange, BoardFinding, LeaveKind, Range, RouteStage, SubstituteInfo } from "@/components/gantt/types";
import { CHANGE_KIND_LABEL, CHANGE_REASON_LABEL, OCCUPYING, VACATION_TYPE_BASIS, VACATION_TYPE_LABEL, leaveReasonLabel, type Employee as DbEmployee, type PartChange } from "./db/types";
import { checkPartChange, engineContext as sharedContext, type Finding } from "./engine";

export const MANAGER_APPROVE = "manager_approve";
/** Руководитель отменил своё согласие (toast «Отменить»): запись журнала, а не удаление. */
export const MANAGER_UNDO = "manager_undo";

/**
 * Контекст проверки на год — общий сборщик `engineContext` из engine.ts (сотрудники, роли, правила,
 * исключения, открытые переносы, полугодовые графики `settings.halfYears`), чтобы /me, /team и /hr
 * считали одинаково. Отличие одно: у каждого плана дата подачи — для срока подачи (R04) и срока
 * полугодия (R19); на /me её проставляет checkPlan только проверяемому сотруднику.
 */
export function engineContext(year: number): CheckContext {
  const all = parts.forYear(year);
  const byEmployee = new Map<string, RequestPart[]>();
  for (const p of all) byEmployee.set(p.employeeId, [...(byEmployee.get(p.employeeId) ?? []), p]);
  const open = changes.forYear(year).map(changeFromDb).filter((c): c is DomainPartChange => c !== null);
  const plans = withOpenChanges([...byEmployee].map(([id, list]) => planFromDb(id, year, list, requests.forEmployee(id, year)?.submittedAt)), open);
  return sharedContext(year, { plans });
}

/** Проверка плана сотрудника движком в готовом контексте. */
export function checkInContext(ctx: CheckContext, employeeId: string): CheckResult | null {
  const e = ctx.employees.find((x) => x.id === employeeId);
  const plan = ctx.plans.find((p) => p.employeeId === employeeId);
  return e && plan ? checkDomainPlan(e, plan, ctx) : null;
}

/** Согласования руководителей по частям: id части → кто и когда. Решает последняя запись: согласие или его отмена. */
export function managerApprovals(): Map<number, { actorId: string; at: string }> {
  const out = new Map<number, { actorId: string; at: string }>();
  const seen = new Set<number>();
  for (const a of audit.list({ entity: "part", limit: 100_000 })) { // от новых к старым
    if ((a.action !== MANAGER_APPROVE && a.action !== MANAGER_UNDO) || !a.entityId || !a.actorId) continue;
    const id = Number(a.entityId);
    if (seen.has(id)) continue;
    seen.add(id);
    if (a.action === MANAGER_APPROVE) out.set(id, { actorId: a.actorId, at: a.at });
  }
  return out;
}

/** Шаг маршрута части. Без руководителя (ИД) заявка идёт сразу к HR. */
export function routeStage(
  p: RequestPart, req: VacationRequest | null, managerId: string | null,
  approvals: Map<number, { actorId: string; at: string }>,
): RouteStage {
  if (p.status === "approved") return "approved";
  if (p.status === "returned") return "returned";
  if (p.status === "rejected") return "rejected";
  if (p.status === "draft") return "draft";
  if (!managerId) return "hr";
  const a = approvals.get(p.id);
  const fresh = a && (!req?.submittedAt || a.at >= req.submittedAt);
  return fresh ? "hr" : "manager";
}

/** Статус заявки по её частям после решения: всё согласовано / что-то вернули. */
export function syncRequestStatus(req: VacationRequest) {
  const list = parts.forRequest(req.id).filter((p) => p.status !== "rejected");
  const next = list.length && list.every((p) => p.status === "approved") ? "approved"
    : list.some((p) => p.status === "returned") ? "returned" : null;
  if (next && next !== req.status) requests.setStatus(req.id, next);
  return next ?? req.status;
}

/** Иванова Анна Сергеевна → Иванова А. С. */
export function shortName(full: string) {
  const [last, ...rest] = full.split(" ");
  return [last, ...rest.map((x) => `${x[0]}.`)].join(" ");
}

/** id замещающего у части (колонка substitute_id); null — не указан. */
export const substituteIdOf = (p: RequestPart): string | null => p.substituteId ?? null;

/** Замещающий части: кто он и когда сам отсутствует в её даты. */
export function substituteInfo(
  p: RequestPart, byId: Map<string, DbEmployee>, all: (RequestPart & { employeeId: string })[],
): SubstituteInfo | null {
  const id = substituteIdOf(p);
  const e = id ? byId.get(id) : undefined;
  if (!id || !e) return null;
  const his = all.filter((x) => x.employeeId === id && x.status !== "returned" && x.status !== "rejected");
  return {
    id, name: shortName(e.fullName), fullName: e.fullName, position: e.position,
    away: his.filter((x) => OCCUPYING.includes(x.status) && x.startDate <= p.endDate && x.endDate >= p.startDate)
      .map((x) => ({ start: x.startDate > p.startDate ? x.startDate : p.startDate, end: x.endDate < p.endDate ? x.endDate : p.endDate })),
    parts: his.map((x) => ({ start: x.startDate, end: x.endDate, tone: x.status === "approved" ? "approved" : x.status === "draft" ? "draft" : "pending" })),
  };
}

/** Вид отпуска и причина: «За свой счёт — рождение ребёнка», с пояснением сотрудника. */
export function leaveKind(p: RequestPart): LeaveKind {
  const reason = leaveReasonLabel(p.type, p.reason, p.reasonNote);
  // пояснение показываем и у причин без обязательного комментария, если сотрудник его написал
  const note = p.reasonNote?.trim();
  return {
    label: VACATION_TYPE_LABEL[p.type], basis: VACATION_TYPE_BASIS[p.type], main: p.type === "main",
    reason: reason && note && !reason.includes(note) ? `${reason}; комментарий: ${note}` : reason,
  };
}

/** Обоснование сотрудника к запросу исключения (requests.exception_note). */
export const exceptionNoteOf = (req: VacationRequest | null): string | null => req?.exceptionNote?.trim() || null;

/**
 * Запрос исключения — по сводке движка (`summary`), как на /me: часть на согласовании, план можно
 * подать (нет нарушений закона), и среди того, что придётся согласовать исключением, есть эта часть.
 */
export function isExceptionRequest(p: RequestPart, res: CheckResult | null | LegacyResult[]): boolean {
  if (p.status !== "pending" || !res) return false;
  const touches = (r: { partIds: string[] }) => r.partIds.length === 0 || r.partIds.includes(String(p.id));
  if (!Array.isArray(res)) return res.summary.canSubmit && res.summary.needsException && res.summary.exceptions.some(touches);
  // список результатов (дашборд): по consequence движка, без него — по источнику правила
  const open = res.filter((r) => (r.status === "block" || r.status === "warn") && touches(r));
  const law = (r: LegacyResult) => (r.consequence ? r.consequence === "law" : !r.regulation && r.status === "block");
  const exc = (r: LegacyResult) => (r.consequence ? r.consequence === "exception" : !!r.regulation);
  return open.some(exc) && !open.some(law);
}
type LegacyResult = { status: string; partIds: string[]; regulation?: boolean; consequence?: "law" | "exception" | "warning" };

/** Дни находки (список дат) → отрезки подряд идущих дней. */
function rangesOf(days: string[] = []): Range[] {
  const out: Range[] = [];
  for (const d of [...days].sort()) {
    const last = out[out.length - 1];
    const next = last && new Date(Date.parse(last.end) + 86_400_000).toISOString().slice(0, 10);
    if (last && next === d) last.end = d; else out.push({ start: d, end: d });
  }
  return out;
}

/** Находка серверной проверки → вид для экранов. */
export function boardFinding(f: Finding, short: (id: string) => string, source: (code: string) => "ТК" | "регламент", partId: number): BoardFinding {
  return {
    ruleCode: f.ruleCode, title: f.title ?? f.ruleCode, level: f.level as BoardFinding["level"], message: f.message, basis: f.basis ?? "",
    source: source(f.ruleCode), partIds: f.partNo ? [partId] : [], dates: rangesOf(f.dates), people: (f.employeeIds ?? []).map(short),
    actionable: true, ...(f.consequence ? { consequence: f.consequence } : {}),
  };
}

/** Открытая заявка на изменение части с проверкой новых дат движком. */
export function changeView(c: PartChange, short: (id: string) => string, source: (code: string) => "ТК" | "регламент"): BoardChange {
  const kind = c.kind as BoardChange["kind"];
  // проверка сохранённой заявки движком: её requestedOn, год части; у extend и recall — null
  const check = checkPartChange(c.id);
  const findings = (check?.findings ?? []).filter((f) => f.level !== "ok").map((f) => boardFinding(f, short, source, c.partId));
  const open = findings.filter((f) => f.level === "block" || f.level === "warn");
  return {
    id: c.id, partId: c.partId, employeeId: c.employeeId, kind, kindLabel: CHANGE_KIND_LABEL[c.kind],
    oldStart: c.oldStart, oldEnd: c.oldEnd, newStart: c.newStart, newEnd: c.newEnd,
    reason: CHANGE_REASON_LABEL[c.reason], note: c.note, stage: c.stage, requestedOn: c.requestedOn,
    managerBy: c.managerBy ? short(c.managerBy) : null, findings,
    law: open.some((f) => f.consequence === "law"), needsException: open.some((f) => f.consequence === "exception"),
    windows: (check?.windows ?? []).map((w) => ({ start: w.start, end: w.end, days: w.days, shift: w.shift })),
  };
}

/** Открытые заявки на изменение по id части. Пока таблицы нет (миграция не применена) — пусто. */
export function openChanges(): Map<number, PartChange> {
  try {
    return new Map(changes.open().map((c) => [c.partId, c]));
  } catch {
    return new Map();
  }
}

/** Кто решает на шаге HR: РО1 из настроек маршрута, а по отпуску самого РО1 — проверяющий за РО1. */
export function hrDeciderFor(employeeId: string): { id: string; asReviewer: boolean } {
  const r = routeSettings.get();
  return employeeId === r.ro1Id ? { id: r.ro1ReviewerId, asReviewer: true } : { id: r.ro1Id, asReviewer: false };
}
