/**
 * Точка подключения движка правил: собирает контекст из репозиториев и зовёт чистые функции
 * `@/domain` (движок в базу не ходит). Описание правил и API — `src/domain/README.md`.
 */
import "server-only";
import {
  DEFAULT_SETTINGS, checkPlan as checkDomainPlan, createContext, findWindows as findDomainWindows, groupAbsences as domainGroupAbsences,
  edgeVerdicts as domainEdgeVerdicts, groupOf, substituteCandidates as domainSubstituteCandidates, isBeneficiary, loadRange, shiftVerdicts as domainShiftVerdicts, teamConflicts as domainTeamConflicts,
  EDGE_PART_ID, type ChangeKind, type CheckContext, type CheckResult, type Consequence, type PartChange, type RescheduleReason, type RuleCode, type RuleResult, type SubstituteCandidate, type TeamReport, type VacationWindow, type WindowOptions,
} from "@/domain";
import { normFixes as domainNormFixes, trimSuggestions as domainTrimSuggestions } from "@/domain/trim";
import {
  applyChange, checkChange as domainCheckChange, extendForSickness, recallFromVacation, withOpenChanges,
  type Recall, type SicknessExtension,
} from "@/domain/change";
import {
  changeFromDb, dbRuleCode, employeeFromDb, exceptionsFromDb, planFromDb, rolesFromDb, rulesFromDb,
} from "@/domain/fromDb";
import { PLAN_YEAR } from "@/lib/config";
import { changes, employees, exceptions, parts, requests, roles, rules, schedules } from "./db/repo";
import type { PartInput, RequestPart, Severity, VacationType } from "./db/types";

export interface Finding {
  ruleCode: string; // код в базе: R01…
  level: Exclude<Severity, "off"> | "ok" | "exception";
  message: string;
  partNo?: number;
  dates?: string[]; // конфликтные дни
  title?: string;
  basis?: string;
  /** Затронутые коллеги — имена показывают только экраны руководителя и HR */
  employeeIds?: string[];
  /** Сдвиг дат может исправить (лимит, зависимости, лето…); false — норма, число частей, часть от 14 дней */
  dateBound: boolean;
  /**
   * Что нарушение значит для подачи (только у block и warn): law — норма ТК или ошибка данных,
   * подать нельзя; exception — запрет регламента, план уходит как запрос исключения; warning — не мешает
   */
  consequence?: Consequence;
}

export interface PlanCheck {
  employeeId: string;
  /** Худший статус находок; для решения «можно ли подать» — canSubmit и needsException */
  verdict: "ok" | "warn" | "block";
  findings: Finding[];
  // checkPlan заполняет их всегда; необязательные — чтобы не ломать места, где PlanCheck собирают вручную
  /** Нет нарушений закона и ошибок данных */
  canSubmit?: boolean;
  /** Есть запреты регламента: план уйдёт как запрос исключения */
  needsException?: boolean;
  /** Почему подать нельзя / что согласовывать исключением — тексты находок */
  reasons?: { law: string[]; exception: string[] };
}

/**
 * Контекст проверки на год: все сотрудники, части (с открытыми заявками на перенос), роли,
 * правила и исключения из базы. overrides подменяет любое поле — например, черновик правил или
 * ролей на экране HR, чтобы показать, что изменится до сохранения.
 */
export function engineContext(year = PLAN_YEAR, overrides: Partial<CheckContext> = {}): CheckContext {
  const all = parts.forYear(year);
  const byEmployee = new Map<string, RequestPart[]>();
  for (const p of all) byEmployee.set(p.employeeId, [...(byEmployee.get(p.employeeId) ?? []), p]);
  // открытые заявки на перенос: у коллег заняты и старые, и новые даты, пока заявка не решена
  const open = changes.forYear(year).map(changeFromDb).filter((c): c is PartChange => c !== null);
  return createContext({
    employees: employees.list().map(employeeFromDb),
    plans: withOpenChanges([...byEmployee].map(([id, list]) => planFromDb(id, year, list)), open),
    roles: rolesFromDb(roles.list(), roles.groups(), roles.dependencies()),
    rules: rulesFromDb(rules.list()),
    // даты частей из базы — даты исключений: к части на других датах исключение не применяется
    exceptions: exceptionsFromDb(exceptions.list(), all),
    // полугодовые графики (п. 5, R19): срок и утверждён ли
    settings: {
      ...DEFAULT_SETTINGS, year,
      halfYears: schedules.list(year).map((s) => ({ year: s.year, half: s.half, deadline: s.deadline, approved: s.status === "approved" })),
    },
    ...overrides,
  });
}

const context = (year = PLAN_YEAR) => engineContext(year);

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Правила, у которых дни конфликта — часть выделения, а не вся часть целиком */
const EXACT_DATES: RuleCode[] = ["groupLimit", "roleDependencies", "noOverlap"];

/**
 * compact — для батчей на сотни вариантов: без title и basis (одинаковы везде, экран берёт их из
 * checkPlan по ruleCode) и без дней у лета, срока подачи и первого отпуска (там это вся часть).
 */
function toFinding(r: RuleResult, partNo: (id: string) => number | undefined, compact = false): Finding | null {
  if (r.status === "off") return null;
  const no = r.partIds.length === 1 ? partNo(r.partIds[0]) : undefined;
  return {
    ruleCode: dbRuleCode(r.code), level: r.status, message: r.message, dateBound: r.dateBound,
    ...(r.consequence ? { consequence: r.consequence } : {}),
    ...(compact ? {} : { title: r.title, basis: r.basis }),
    ...(no ? { partNo: no } : {}),
    ...(r.dates.length && (!compact || EXACT_DATES.includes(r.code)) ? { dates: r.dates.flatMap((d) => eachDay(d.start, d.end)) } : {}),
    ...(r.employeeIds.length ? { employeeIds: r.employeeIds } : {}),
  };
}

/**
 * Проверить план сотрудника: сохранённые части или части с экрана (ещё не сохранённые).
 * `{ submitting: true }` — проверка при отправке: незаполненный замещающий (R15) тогда не
 * предупреждение, а по жёсткости правила (при сборке графика — запрет).
 */
export function checkPlan(
  employeeId: string, list: (PartInput | RequestPart)[], year = PLAN_YEAR, opts: { submitting?: boolean } = {},
): PlanCheck {
  const ctx = { ...context(year), submitting: !!opts.submitting };
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) throw new Error(`Нет сотрудника ${employeeId}`);
  const plan = planFromDb(employeeId, year, list, requests.forEmployee(employeeId, year)?.submittedAt);
  return toPlanCheck(employeeId, checkDomainPlan(employee, plan, ctx));
}

function toPlanCheck(employeeId: string, res: CheckResult): PlanCheck {
  const partNo = (id: string) => res.parts.find((p) => p.partId === id)?.index;
  return {
    employeeId,
    verdict: res.status,
    findings: res.results.map((r) => toFinding(r, partNo)).filter((f): f is Finding => f !== null),
    canSubmit: res.summary.canSubmit,
    needsException: res.summary.needsException,
    reasons: { law: res.summary.law.map((r) => r.message), exception: res.summary.exceptions.map((r) => r.message) },
  };
}

/**
 * Загрузка группы по дням года без имён: сколько коллег в отпуске и лимит (0 — лимита нет).
 * full — уйти в этот день нельзя: мест нет или нет на месте связанной роли. Льготнику
 * ч. 4 ст. 168 лимиты не действуют, поэтому у него full всегда false.
 */
export function groupLoad(employeeId: string, year: number): Record<string, { busy: number; limit: number; full: boolean }> {
  const ctx = context(year);
  const me = ctx.employees.find((e) => e.id === employeeId);
  if (!me) return {};
  const group = groupOf(me, ctx.employees, ctx.roles);
  const free = isBeneficiary(me);
  const out: Record<string, { busy: number; limit: number; full: boolean }> = {};
  for (const d of loadRange(group, `${year}-01-01`, `${year}-12-31`, ctx.plans, { excludeEmployeeId: me.id, occupying: ctx.occupying })) {
    out[d.date] = { busy: d.absent, limit: d.limit ?? 0, full: !free && d.full };
  }
  return out;
}

/**
 * Кто из группы отсутствует по дням года: `peers` — коллеги по группе лимита, `deputies` — те,
 * без кого сотрудник не уходит. Только id, без дат чужих отпусков; ключи — все дни года.
 * Показывать ли имена (настройка HR) — решает вызывающий.
 */
export function groupAbsences(employeeId: string, year: number): Record<string, { peers: string[]; deputies: string[] }> {
  const ctx = context(year);
  const me = ctx.employees.find((e) => e.id === employeeId);
  if (!me) return {};
  const group = groupOf(me, ctx.employees, ctx.roles);
  const out: Record<string, { peers: string[]; deputies: string[] }> = {};
  for (const d of domainGroupAbsences(group, `${year}-01-01`, `${year}-12-31`, ctx.plans, { excludeEmployeeId: me.id, occupying: ctx.occupying })) {
    out[d.date] = { peers: d.peers, deputies: d.deputies };
  }
  return out;
}

/**
 * Ближайшие свободные окна той же длины для части partNo (с 1).
 * `{ strict: true }` — только окна, с которыми весь план проходит проверку без запретов.
 */
export function freeWindows(
  employeeId: string, list: (PartInput | RequestPart)[], partNo: number, year = PLAN_YEAR, opts: WindowOptions = {},
): VacationWindow[] {
  const ctx = context(year);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) return [];
  const plan = planFromDb(employeeId, year, list);
  const part = plan.parts.filter((p) => p.status !== "rejected")[partNo - 1];
  return part ? findDomainWindows(employee, plan, part.id, ctx, opts) : [];
}

/**
 * Вердикты для перетаскивания части partNo (с 1): для каждого допустимого начала той же длины
 * в пределах года — проверка всего плана с частью на новых датах. Ключ — дата начала.
 * results — запреты, предупреждения и исключения этой части и плана в целом (без partNo); status — худший.
 * Контекст собирается один раз: ~350 кандидатов считаются за десятки миллисекунд.
 */
export function shiftVerdicts(
  employeeId: string, list: (PartInput | RequestPart)[], partNo: number, year = PLAN_YEAR,
): Record<string, { status: "ok" | "warn" | "block"; results: Finding[] }> {
  const ctx = context(year);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) return {};
  const plan = planFromDb(employeeId, year, list, requests.forEmployee(employeeId, year)?.submittedAt);
  const part = plan.parts.filter((p) => p.status !== "rejected")[partNo - 1];
  if (!part) return {};
  return partVerdicts(domainShiftVerdicts(employee, plan, part.id, ctx), part.id);
}

type PartVerdict = { status: "ok" | "warn" | "block"; results: Finding[] };

/** Из проверок плана — запреты, предупреждения и исключения части partId и плана в целом; статус — худший. */
function partVerdicts(all: Record<string, CheckResult>, partId: string): Record<string, PartVerdict> {
  const out: Record<string, PartVerdict> = {};
  for (const [key, res] of Object.entries(all)) {
    // только то, что красит выделение: info (праздники, «не распределено») экран берёт из checkPlan
    const own = res.results.filter((r) => (r.status === "block" || r.status === "warn" || r.status === "exception")
      && (r.partIds.includes(partId) || r.partIds.length === 0));
    const no = (id: string) => res.parts.find((p) => p.partId === id)?.index;
    const results = own.map((r) => toFinding(r, no, true)).filter((f): f is Finding => f !== null);
    const status = own.some((r) => r.status === "block") ? "block" : own.some((r) => r.status === "warn") ? "warn" : "ok";
    out[key] = { status, results };
  }
  return out;
}

/**
 * Вердикты для растягивания края выделения: для каждого дня d года — проверка плана, где
 * выделение стоит на [min(fixed, d), max(fixed, d)]. partNo — какую часть тянут (с 1, без
 * отклонённых), null — новая часть в конце плана. Ключ — d; results и status — как у shiftVerdicts.
 */
export function edgeVerdicts(
  employeeId: string, list: (PartInput | RequestPart)[], partNo: number | null, type: VacationType, fixed: string, year = PLAN_YEAR,
): Record<string, PartVerdict> {
  const ctx = context(year);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) return {};
  const plan = planFromDb(employeeId, year, list, requests.forEmployee(employeeId, year)?.submittedAt);
  const partId = partNo === null ? null : plan.parts.filter((p) => p.status !== "rejected")[partNo - 1]?.id;
  if (partId === undefined) return {};
  return partVerdicts(domainEdgeVerdicts(employee, plan, partId, type, fixed, ctx), partId ?? EDGE_PART_ID);
}

export interface TrimAdvice {
  partNo: number;
  /** Это новое выделение (draftPartNo) */
  draft: boolean;
  side: "end" | "start";
  from: { start: string; end: string };
  to: { start: string; end: string };
  /** Дней в части после обрезки и сколько освобождается */
  days: number;
  freedDays: number;
  status: "ok" | "warn";
  touchesApproved: boolean;
  shift: number;
  message: string;
  /** Предупреждения плана после обрезки */
  findings: Finding[];
}

/**
 * Где освободить дни, если основных дней больше нормы: каждая часть (и новое выделение
 * draftPartNo) обрезается с конца или с начала ровно на лишние дни отпуска, план проверяется
 * целиком. Только варианты без запретов; сначала без предупреждений, затем не задевающие
 * согласованные части, затем с меньшим сдвигом начала. Пусто — без превышения или если ничего не проходит.
 */
export function trimSuggestions(
  employeeId: string, list: (PartInput | RequestPart)[], draftPartNo?: number | null, year = PLAN_YEAR,
): TrimAdvice[] {
  const ctx = context(year);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) return [];
  const plan = planFromDb(employeeId, year, list, requests.forEmployee(employeeId, year)?.submittedAt);
  const draftId = draftPartNo ? plan.parts.filter((p) => p.status !== "rejected")[draftPartNo - 1]?.id : undefined;
  return domainTrimSuggestions(employee, plan, ctx, { draftId }).map((s) => {
    const no = (id: string) => s.result.parts.find((p) => p.partId === id)?.index;
    return {
      partNo: s.index, draft: s.draft, side: s.side, from: s.from, to: s.to, days: s.days, freedDays: s.freedDays,
      status: s.status, touchesApproved: s.touchesApproved, shift: s.shift, message: s.message,
      findings: s.result.results.filter((r) => r.status === "warn").map((r) => toFinding(r, no)).filter((f): f is Finding => f !== null),
    };
  });
}

export interface NormFix {
  /** Какую часть в list сокращать (с 1), может быть и сама target */
  partNo: number;
  side: "start" | "end";
  from: { start: string; end: string };
  to: { start: string; end: string };
  /** Сколько дней отпуска освободится */
  freed: number;
  status: "ok" | "warn";
  /** «Часть 2: 22 ноября – 2 декабря → 22–25 ноября, освободится 7 дней» */
  message: string;
}

/**
 * До 3 выполнимых советов «что сократить» при переборе нормы: каждая не согласованная часть list,
 * включая target (номер с 1 новой или изменяемой части), обрезается с конца или с начала ровно на
 * лишние дни отпуска, план проверяется целиком, варианты с запретом отброшены. Порядок: ok раньше
 * warn, затем target раньше других, затем с конца раньше, чем с начала. Пусто — лишних нет или ничего не проходит.
 */
export function normFixes(employeeId: string, list: (PartInput | RequestPart)[], target: number, year = PLAN_YEAR): NormFix[] {
  const ctx = context(year);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) return [];
  const plan = planFromDb(employeeId, year, list, requests.forEmployee(employeeId, year)?.submittedAt);
  const targetId = plan.parts.filter((p) => p.status !== "rejected")[target - 1]?.id ?? "";
  return domainNormFixes(employee, plan, targetId, ctx).map((s) => ({
    partNo: s.index, side: s.side, from: s.from, to: s.to, freed: s.freedDays, status: s.status, message: s.message,
  }));
}

/**
 * Коллеги для выбора замещающего на отрезок range: сначала свой отдел, потом отделение,
 * потом остальные; внутри — свободные раньше. busy — дни отрезка, когда кандидат в отпуске
 * (части в любом статусе, кроме отклонённых).
 */
export function substituteCandidates(employeeId: string, range: { start: string; end: string }, year = PLAN_YEAR): SubstituteCandidate[] {
  const ctx = context(year);
  const me = ctx.employees.find((e) => e.id === employeeId);
  return me ? domainSubstituteCandidates(me, range, ctx) : [];
}

/**
 * Проверка заявки на изменение согласованной части partId (id в базе): перенос, сокращение
 * или отказ. План с новыми датами проходит все правила (старые даты у самого сотрудника не
 * учитываются), плюс R14 — срок от прежнего начала (позже — нужно исключение) и R21 —
 * начавшуюся или прошедшую часть сотрудник не меняет (law). windows — свободные окна той же
 * длины, если новым датам мешает лимит группы или зависимость ролей.
 */
export function checkChange(
  employeeId: string, partId: number,
  change: { kind: ChangeKind; newStart?: string; newEnd?: string; reason?: RescheduleReason },
  opts: { requestedOn?: string; year?: number } = {},
): PlanCheck & { windows: VacationWindow[] } {
  // год — по самой части: заявка может касаться отпуска прошлого или текущего года
  const own = parts.get(partId);
  const year = opts.year ?? (own ? requests.get(own.requestId)?.year : undefined) ?? PLAN_YEAR;
  const ctx = context(year);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) throw new Error(`Нет сотрудника ${employeeId}`);
  const req = requests.forEmployee(employeeId, year);
  const plan = planFromDb(employeeId, year, req ? parts.forRequest(req.id) : [], req?.submittedAt);
  const pc: PartChange = {
    id: "check", employeeId, partId: String(partId), ...change, requestedOn: opts.requestedOn ?? ctx.today,
  };
  const res = domainCheckChange(employee, plan, pc, ctx);
  const blockedByGroup = change.kind !== "cancel" && res.results.some((r) => r.status === "block"
    && (r.code === "groupLimit" || r.code === "roleDependencies") && r.partIds.includes(pc.partId));
  const windows = blockedByGroup ? findDomainWindows(employee, applyChange(plan, pc), pc.partId, ctx, { strict: true }) : [];
  return { ...toPlanCheck(employeeId, res), windows };
}

/** Проверка сохранённой заявки на изменение (id в part_changes) — для очередей руководителя и HR. extend и recall — null. */
export function checkPartChange(changeId: number): (PlanCheck & { windows: VacationWindow[] }) | null {
  const c = changes.get(changeId);
  if (!c || (c.kind !== "move" && c.kind !== "shorten" && c.kind !== "cancel")) return null;
  return checkChange(c.employeeId, c.partId, {
    kind: c.kind, ...(c.newStart ? { newStart: c.newStart } : {}), ...(c.newEnd ? { newEnd: c.newEnd } : {}), reason: c.reason,
  }, { requestedOn: c.requestedOn });
}

/** Продление части partId по больничному (ст. 171): новый конец с пересчётом праздников. */
export function sicknessExtension(partId: number, sickStart: string, sickEnd: string): SicknessExtension | null {
  const p = parts.get(partId);
  return p ? extendForSickness(p.startDate, p.endDate, sickStart, sickEnd) : null;
}

/** Отзыв из части partId (ст. 174): сколько дней вернётся в остаток; запрет — allowed: false и message. */
export function recall(employeeId: string, partId: number, returnOn: string): Recall | null {
  const e = employees.get(employeeId), p = parts.get(partId);
  return e && p ? recallFromVacation(employeeFromDb(e), { start: p.startDate, end: p.endDate }, returnOn) : null;
}

/**
 * Конфликты по компании для Ганта HR. Коды правил — движка (groupLimit…), код в базе даёт
 * `dbRuleCode`; partIds — id частей в базе строкой.
 */
export function teamConflicts(year = PLAN_YEAR): TeamReport {
  const ctx = context(year);
  return domainTeamConflicts(ctx.employees, ctx.plans, ctx.rules, ctx);
}
