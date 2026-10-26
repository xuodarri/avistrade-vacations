/**
 * Функции для экранов: проверка плана, загрузка группы по дням, свободные окна, конфликты компании.
 *
 * Как находка правила превращается в результат (judge):
 *   правило выключено → off;
 *   к этой части не относится или сотрудник — льготник, а правило льготникам не применяется → off;
 *   не нарушено → ok (или info, если правило просит обратить внимание);
 *   нарушено → жёсткость правила на этапе части; для правил регламента исключение HR даёт exception.
 */
import { holidaysBetween, summerDays, vacationDays, vacationEnd, type Holiday } from './calendar';
import { DATE_BOUND_RULES, createContext, ruleOf } from './config';
import { isValidIso, parts as dateParts, runs, toDay, toIso } from './dates';
import { absencesOf, absentOn, groupOf, type Group } from './groups';
import * as R from './rules';
import type { Finding, PartView } from './rules';
import type {
  CheckContext, CheckResult, Consequence, DateRange, Employee, HrException, IsoDate, LeaveType, PartStatus, PartSummary, Plan, PlanSummary, ResultStatus,
  RuleCode, RuleConfig, RuleResult, Severity, Stage, VacationPart,
} from './types';

const RANK: Record<ResultStatus, number> = { off: 0, ok: 1, info: 2, exception: 3, warn: 4, block: 5 };

export function worst(list: ResultStatus[]): ResultStatus {
  return list.reduce<ResultStatus>((w, s) => (RANK[s] > RANK[w] ? s : w), 'off');
}

export function overall(list: ResultStatus[]): 'ok' | 'warn' | 'block' {
  const w = worst(list);
  return w === 'block' || w === 'warn' ? w : 'ok';
}

export function isBeneficiary(e: Employee): boolean {
  return !!e.minor || !!e.benefits?.length;
}

function beneficiaryText(e: Employee): string {
  return e.minor ? 'работник до 18 лет' : `льгота ч. 4 ст. 168 ТК (${e.benefits!.join(', ')})`;
}

const STAGE_TEXT: Record<Stage, string> = { collect: 'сбор графика', adhoc: 'вне графика', approved: 'уже в графике' };

/** Части плана с посчитанными днями; отклонённые части в план не входят */
export function measurePlan(plan: Plan, stage: CheckContext['stage']): PartView[] {
  return plan.parts.filter((p) => p.status !== 'rejected').map((part, i) => {
    const valid = isValidIso(part.start) && isValidIso(part.end) && part.end >= part.start;
    return {
      part,
      index: i + 1,
      s: valid ? toDay(part.start) : 0,
      e: valid ? toDay(part.end) : -1,
      valid,
      days: valid ? vacationDays(part.start, part.end) : 0,
      holidays: valid ? holidaysBetween(part.start, part.end).map((h) => h.date) : [],
      summerDays: valid ? summerDays(part.start, part.end) : 0,
      stage: part.status === 'approved' ? 'approved' : stage,
    };
  });
}

/**
 * Исключение HR к результату правила: только своего сотрудника и правила. Исключение на часть —
 * только к этой части и только пока её даты не изменились (сдвиг, перенос, новое выделение — уже
 * другое решение). Исключение на план — к нарушениям плана в целом или к частям, пересекающим его даты.
 */
function findException(
  ctx: CheckContext, employeeId: string, code: RuleCode, partIds: string[], parts: VacationPart[],
): HrException | undefined {
  const own = partIds.map((id) => parts.find((p) => p.id === id)).filter((p): p is VacationPart => !!p);
  return ctx.exceptions.find((x) => {
    if (x.employeeId !== employeeId || x.ruleCode !== code) return false;
    if (!x.partId) return x.dates ? own.some((p) => p.start <= x.dates!.end && x.dates!.start <= p.end) : partIds.length === 0;
    const p = own.find((y) => y.id === x.partId);
    if (!p || p.reschedule) return false;
    return !x.dates || (p.start === x.dates.start && p.end === x.dates.end);
  });
}

export function judge(
  ctx: CheckContext, rule: RuleConfig, employee: Employee, stage: Stage, f: Finding, partIds: string[], parts: VacationPart[] = [],
): RuleResult {
  const out = (status: ResultStatus, message: string): RuleResult => ({
    code: rule.code, title: rule.title, status, message, basis: rule.basis,
    partIds, dates: f.dates ?? [], employeeIds: f.employeeIds ?? [], dateBound: DATE_BOUND_RULES.includes(rule.code),
    ...(rule.legalRisk ? { legalRisk: rule.legalRisk } : {}),
  });
  if (!rule.enabled) return out('off', 'Правило выключено');
  if (f.notApplicable) return out('off', f.message);
  if (!rule.appliesToBeneficiaries && isBeneficiary(employee)) return out('off', `Не применяется: ${beneficiaryText(employee)}`);
  if (!f.violated) return out(f.notice ? 'info' : 'ok', f.message);
  const base = rule.severityByStage?.[stage] ?? rule.severity;
  if (base === 'off') return out('off', `Не применяется на этапе «${STAGE_TEXT[stage]}»`);
  // ошибка данных — всегда запрет; иначе у находки может быть свой потолок: мягче, но не строже
  const sev: Severity = f.dataError ? 'block' : f.severity && SEV_RANK[f.severity] < SEV_RANK[base] ? f.severity : base;
  if (rule.source === 'regulation' && sev !== 'info' && !f.dataError) {
    const x = findException(ctx, employee.id, rule.code, partIds, parts);
    if (x) return { ...out('exception', `${f.message}. Разрешено исключением РО1: ${x.reason}`), exception: x, severity: sev };
  }
  const consequence: Consequence | undefined = sev === 'warn' ? 'warning'
    : sev === 'block' ? (rule.source === 'law' || f.dataError ? 'law' : 'exception') : undefined;
  return { ...out(sev, f.message), severity: sev, ...(consequence ? { consequence } : {}) };
}

/** Сводка для подачи: нет нарушений закона — подать можно; есть запреты регламента — нужен запрос исключения */
export function summarize(results: RuleResult[]): PlanSummary {
  const law = results.filter((r) => r.consequence === 'law');
  const exceptions = results.filter((r) => r.consequence === 'exception');
  const warnings = results.filter((r) => r.consequence === 'warning');
  return { canSubmit: !law.length, needsException: exceptions.length > 0, law, exceptions, warnings };
}

const SEV_RANK: Record<Severity, number> = { info: 0, warn: 1, block: 2 };

const PART_RULES: RuleCode[] = [
  'pastDates', 'halfYearDeadline', 'payRequest', 'treatmentLeave', 'groupLimit', 'roleDependencies', 'summerLength', 'noticeMonth', 'rescheduleNotice', 'firstVacation', 'substitute', 'holidays',
];

/**
 * Проверка плана сотрудника. context.plans — планы всей компании: из них берётся, кто когда
 * отсутствует (собственный план сотрудника оттуда не читается, только из аргумента plan).
 * В results каждое включённое правило есть хотя бы раз: нарушения — по одному на часть,
 * если нарушений нет — одна строка «ok».
 */
export function checkPlan(employee: Employee, plan: Plan, context: CheckContext): CheckResult {
  const ctx = context;
  const views = measurePlan(plan, ctx.stage);
  const valid = views.filter((p) => p.valid);
  const group = groupOf(employee, ctx.employees, ctx.roles);
  const others = ctx.plans.filter((p) => p.employeeId !== employee.id);
  const peers = absencesOf(group.memberIds.filter((id) => id !== employee.id), others, ctx.occupying);
  const deps = absencesOf(group.dependencyIds, others, ctx.occupying);

  const partFinding = (code: RuleCode, p: PartView, rule: RuleConfig): Finding => {
    switch (code) {
      case 'groupLimit': return R.groupLimit(p, group, peers, ctx);
      case 'roleDependencies': return R.roleDependencies(p, group, deps, ctx);
      case 'summerLength': return R.summerLength(p, views, rule);
      case 'noticeMonth': return R.noticeMonth(p, rule, ctx.today, ctx);
      case 'rescheduleNotice': return R.rescheduleNotice(p, rule);
      case 'firstVacation': return R.firstVacation(p, employee, rule);
      case 'substitute': return R.substitute(p, employee, ctx);
      case 'pastDates': return R.pastDates(p, rule, ctx.today);
      case 'halfYearDeadline': return R.halfYearDeadline(p, rule, ctx.today, ctx);
      case 'payRequest': return R.payRequest(p);
      case 'treatmentLeave': return R.treatmentLeave(p);
      default: return R.holidays(p);
    }
  };

  const results: RuleResult[] = [];
  const perPart = new Map<string, ResultStatus[]>();
  for (const code of PART_RULES) {
    const rule = ruleOf(ctx.rules, code);
    const list = valid.map((p) => {
      const r = judge(ctx, rule, employee, p.stage, partFinding(code, p, rule), [p.part.id], plan.parts);
      if (!perPart.has(p.part.id)) perPart.set(p.part.id, []);
      perPart.get(p.part.id)!.push(r.status);
      return r;
    });
    const notable = list.filter((r) => RANK[r.status] >= RANK.info);
    if (notable.length) results.push(...notable);
    else results.push(list.find((r) => r.status === 'ok') ?? list[0] ?? judge(ctx, rule, employee, ctx.stage, { violated: false, notApplicable: true, message: 'В плане нет частей' }, []));
  }

  const planStage: Stage = valid.length && valid.every((p) => p.stage === 'approved') ? 'approved' : ctx.stage;
  const planRule = (code: RuleCode, f: Finding, partIds: string[]) => {
    const r = judge(ctx, ruleOf(ctx.rules, code), employee, planStage, f, partIds, plan.parts);
    results.push(r);
    for (const id of partIds) perPart.get(id)?.push(r.status);
  };
  const overlap = R.noOverlap(views);
  planRule('noOverlap', overlap, overlap.violated ? overlapIds(views) : []);
  planRule('longPart', R.longPart(views, ruleOf(ctx.rules, 'longPart')), []);
  planRule('yearNorm', R.yearNorm(views, employee), []);
  planRule('maxParts', R.maxParts(views, ruleOf(ctx.rules, 'maxParts')), []);
  for (const code of ['unpaid190Limit', 'unpaid189Limit'] as const) {
    const rule = ruleOf(ctx.rules, code);
    const f = code === 'unpaid190Limit' ? R.unpaid190Limit(views, rule) : R.unpaid189Limit(views, rule);
    planRule(code, f, f.violated ? f.partIds : []);
  }

  const summaries: PartSummary[] = views.map((p) => ({
    partId: p.part.id, index: p.index, days: p.days, holidays: p.holidays, summerDays: p.summerDays, stage: p.stage,
    status: overall(perPart.get(p.part.id) ?? (p.valid ? [] : ['block'])),
  }));
  return {
    employeeId: employee.id,
    status: overall(results.map((r) => r.status)),
    summary: summarize(results),
    results,
    parts: summaries,
    totalDays: valid.filter((p) => p.part.type === 'main').reduce((s, p) => s + p.days, 0),
    normDays: employee.normDays + (employee.extraDays ?? 0),
  };
}

/** Части с неверными датами или пересечением — для подсветки */
function overlapIds(views: PartView[]): string[] {
  const ids = new Set<string>();
  for (const p of views) if (!p.valid) ids.add(p.part.id);
  for (let a = 0; a < views.length; a++) {
    for (let b = a + 1; b < views.length; b++) {
      const x = views[a], y = views[b];
      if (x.valid && y.valid && x.s <= y.e && y.s <= x.e) { ids.add(x.part.id); ids.add(y.part.id); }
    }
  }
  return [...ids];
}

/* ---------------- загрузка группы ---------------- */

export interface DayLoad {
  date: IsoDate;
  /** Сколько членов группы отсутствует */
  absent: number;
  /** Лимит группы; null — без лимита */
  limit: number | null;
  /** Свободных мест; null — без лимита */
  free: number | null;
  /** Кто-то из тех, без кого нельзя уходить, в этот день в отпуске */
  dependencyAbsent: boolean;
  /** Уйти в этот день нельзя: мест нет или нет связанной роли */
  full: boolean;
  holiday?: string;
}

export interface LoadOptions {
  /** Чей экран: его собственный отпуск в загрузку не входит */
  excludeEmployeeId?: string;
  occupying?: PartStatus[];
}

/** Загрузка группы на день — только числа, без имён: для экрана сотрудника */
export function dayLoad(group: Group, date: IsoDate, allPlans: Plan[], opts: LoadOptions = {}): DayLoad {
  return loadRange(group, date, date, allPlans, opts)[0];
}

/** То же на отрезок дней — для календаря */
export function loadRange(group: Group, from: IsoDate, to: IsoDate, allPlans: Plan[], opts: LoadOptions = {}): DayLoad[] {
  const occ = opts.occupying ?? ['pending', 'approved'];
  const skip = (id: string) => id !== opts.excludeEmployeeId;
  const members = absencesOf(group.memberIds.filter(skip), allPlans, occ);
  const deps = absencesOf(group.dependencyIds.filter(skip), allPlans, occ);
  const holidays = new Map(holidaysBetween(from, to).map((h: Holiday) => [h.date, h.name]));
  const out: DayLoad[] = [];
  for (let n = toDay(from); n <= toDay(to); n++) {
    const date = toIso(n);
    const absent = absentOn(members, n).length;
    const dependencyAbsent = absentOn(deps, n).length > 0;
    // сам сотрудник — тоже член группы: место есть, если отсутствующих меньше лимита
    const free = group.limit === null ? null : Math.max(0, group.limit - absent);
    out.push({
      date, absent, limit: group.limit, free, dependencyAbsent,
      full: dependencyAbsent || free === 0,
      ...(holidays.has(date) ? { holiday: holidays.get(date) } : {}),
    });
  }
  return out;
}

export interface DayAbsences {
  date: IsoDate;
  /** Коллеги по группе лимита, которые в этот день в отпуске */
  peers: string[];
  /** Те, без кого сотрудник не уходит (зависимости ролей), которые в этот день в отпуске */
  deputies: string[];
}

/**
 * Кто из группы отсутствует по дням — id, без дат чужих отпусков. Для экранов, где HR
 * разрешил показывать имена коллег; фильтр приватности — забота вызывающего.
 */
export function groupAbsences(group: Group, from: IsoDate, to: IsoDate, allPlans: Plan[], opts: LoadOptions = {}): DayAbsences[] {
  const occ = opts.occupying ?? ['pending', 'approved'];
  const skip = (id: string) => id !== opts.excludeEmployeeId;
  const members = absencesOf(group.memberIds.filter(skip), allPlans, occ);
  const deps = absencesOf(group.dependencyIds.filter(skip), allPlans, occ);
  const out: DayAbsences[] = [];
  for (let n = toDay(from); n <= toDay(to); n++) {
    out.push({ date: toIso(n), peers: absentOn(members, n), deputies: absentOn(deps, n) });
  }
  return out;
}

/* ---------------- замещающие ---------------- */

export interface SubstituteCandidate {
  employeeId: string;
  name: string;
  /** Тот же отдел (или то же отделение, если отдела нет) */
  sameDept: boolean;
  sameUnit: boolean;
  /** Свободен все дни отрезка */
  free: boolean;
  /** Дни отрезка, когда он в отпуске (его части в любом статусе, кроме отклонённых) */
  busy: DateRange[];
}

/**
 * Коллеги, из которых выбирают замещающего на отрезок range: без самого сотрудника и уволенных.
 * Порядок: свой отдел, своё отделение, остальные; внутри — сначала свободные, потом по имени.
 */
export function substituteCandidates(employee: Employee, range: DateRange, context: CheckContext): SubstituteCandidate[] {
  const a = toDay(range.start), b = toDay(range.end);
  const out = context.employees.filter((e) => e.id !== employee.id && !R.isDismissed(e, range.end)).map((e): SubstituteCandidate => {
    const days: number[] = [];
    for (const plan of context.plans) {
      if (plan.employeeId !== e.id) continue;
      for (const p of plan.parts) {
        if (p.status === 'rejected' || p.end < p.start) continue;
        for (let n = Math.max(a, toDay(p.start)); n <= Math.min(b, toDay(p.end)); n++) if (!days.includes(n)) days.push(n);
      }
    }
    const busy = runs(days.sort((x, y) => x - y));
    const sameUnit = e.unit === employee.unit;
    return { employeeId: e.id, name: e.name, sameDept: sameUnit && (e.dept ?? '') === (employee.dept ?? ''), sameUnit, free: !busy.length, busy };
  });
  const rank = (c: SubstituteCandidate) => (c.sameDept ? 0 : c.sameUnit ? 1 : 2) * 2 + (c.free ? 0 : 1);
  return out.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name, 'ru'));
}

/* ---------------- свободные окна ---------------- */

export interface VacationWindow {
  start: IsoDate;
  end: IsoDate;
  /** Дней отпуска — столько же, сколько в исходной части */
  days: number;
  holidays: Holiday[];
  /** На сколько дней сдвинуто начало */
  shift: number;
}

export interface WindowOptions {
  count?: number;
  /** Сколько дней искать назад и вперёд от исходного начала */
  before?: number;
  after?: number;
  /** День недели начала (0 — понедельник); null — любой */
  weekday?: number | null;
  /**
   * Только проверенные окна: план с частью на этих датах проходит checkPlan без запретов.
   * Если запрет не от дат (норма, число частей), окон не будет: сдвиг его не исправит.
   * По умолчанию ищет шире: 120 дней назад и 240 вперёд, в пределах года плана.
   */
  strict?: boolean;
}

/** Правила, которые окно обязано пройти */
const HARD: RuleCode[] = ['pastDates', 'groupLimit', 'roleDependencies', 'noOverlap'];
/** Эти окно может нарушать, только если их нарушала и исходная часть */
const SOFT: RuleCode[] = ['noticeMonth', 'firstVacation', 'summerLength', 'substitute'];

/**
 * Ближайшие свободные окна той же длины для части partId: без запретов и предупреждений по
 * лимиту, зависимостям и пересечениям, в пределах года плана. Кандидаты проверяются от
 * ближайшего к исходной дате, поиск останавливается на count найденных. Возвращаются по
 * возрастанию даты.
 */
export function findWindows(employee: Employee, plan: Plan, partId: string, context: CheckContext, opts: WindowOptions = {}): VacationWindow[] {
  const { count = 3, weekday = 0, strict = false } = opts;
  const before = opts.before ?? (strict ? 120 : 42);
  const after = opts.after ?? (strict ? 240 : 84);
  const target = measurePlan(plan, context.stage).find((p) => p.part.id === partId);
  if (!target || !target.valid || !target.days) return [];
  const flagged = (res: CheckResult) => new Set(res.results
    .filter((r) => (r.status === 'block' || r.status === 'warn') && (r.partIds.includes(partId)))
    .map((r) => r.code));
  const original = flagged(checkPlan(employee, plan, context));

  // сдвиги от ближайшего: 0, −1, +1, −2, +2…
  const shifts: number[] = [];
  for (let k = 1; k <= Math.max(before, after); k++) {
    if (k <= before) shifts.push(-k);
    if (k <= after) shifts.push(k);
  }
  const found: VacationWindow[] = [];
  for (const shift of shifts) {
    if (found.length >= count) break;
    const c = target.s + shift;
    if (weekday !== null && dateParts(c).wd !== weekday) continue;
    const start = toIso(c);
    const end = vacationEnd(start, target.days);
    if (dateParts(c).y !== plan.year || dateParts(toDay(end)).y !== plan.year) continue;
    const moved: Plan = {
      ...plan,
      parts: plan.parts.map((p) => (p.id === partId ? { ...p, start, end, submittedOn: undefined, reschedule: undefined } : p)),
    };
    const res = checkPlan(employee, moved, context);
    if (strict && res.status === 'block') continue;
    const okay = [...flagged(res)].every((code) => !HARD.includes(code) && (!SOFT.includes(code) || original.has(code)));
    if (okay) found.push({ start, end, days: target.days, holidays: holidaysBetween(start, end), shift });
  }
  return found.sort((a, b) => (a.start < b.start ? -1 : 1));
}

/**
 * Проверка плана для каждого допустимого начала части partId той же длины (в днях отпуска)
 * в пределах года плана — для перетаскивания части: один вызов на старте, дальше экран
 * берёт готовый вердикт по дате начала. Ключ — дата начала, исходное начало тоже входит.
 */
export function shiftVerdicts(employee: Employee, plan: Plan, partId: string, context: CheckContext): Record<IsoDate, CheckResult> {
  const target = measurePlan(plan, context.stage).find((p) => p.part.id === partId);
  if (!target || !target.valid || !target.days) return {};
  const out: Record<IsoDate, CheckResult> = {};
  const last = toDay(`${plan.year}-12-31`);
  for (let c = toDay(`${plan.year}-01-01`); c <= last; c++) {
    const start = toIso(c);
    const end = vacationEnd(start, target.days);
    if (toDay(end) > last) break;
    const moved: Plan = {
      ...plan,
      parts: plan.parts.map((p) => (p.id !== partId ? p
        : c === target.s ? p : { ...p, start, end, submittedOn: undefined, reschedule: undefined })),
    };
    out[start] = checkPlan(employee, moved, context);
  }
  return out;
}

/** id новой части в планах edgeVerdicts */
export const EDGE_PART_ID = 'edge-new';

/**
 * Проверка плана для каждого положения второго края выделения — для растягивания края:
 * выделение [min(fixed, d), max(fixed, d)] для каждого дня d года плана. partId — какую часть
 * растягивают; null — новая часть (id EDGE_PART_ID, в конце плана). type — тип выделения.
 * Ключ — второй край d.
 */
export function edgeVerdicts(
  employee: Employee, plan: Plan, partId: string | null, type: LeaveType, fixed: IsoDate, context: CheckContext,
): Record<IsoDate, CheckResult> {
  if (partId !== null && !plan.parts.some((p) => p.id === partId)) return {};
  const out: Record<IsoDate, CheckResult> = {};
  const last = toDay(`${plan.year}-12-31`);
  for (let d = toDay(`${plan.year}-01-01`); d <= last; d++) {
    const edge = toIso(d);
    const start = edge < fixed ? edge : fixed, end = edge < fixed ? fixed : edge;
    const parts: VacationPart[] = partId === null
      ? [...plan.parts, { id: EDGE_PART_ID, type, start, end, status: 'draft' }]
      : plan.parts.map((p) => (p.id === partId ? { ...p, type, start, end, submittedOn: undefined, reschedule: undefined } : p));
    out[edge] = checkPlan(employee, { ...plan, parts }, context);
  }
  return out;
}

/* ---------------- конфликты компании ---------------- */

export interface TeamConflict extends RuleResult {
  employeeId: string;
  /** Нарушение разрешено исключением HR */
  resolved: boolean;
}

export interface TeamReport {
  /** Все запреты, предупреждения и разрешённые исключением нарушения по компании */
  conflicts: TeamConflict[];
  /** Итог по сотруднику — для раскраски строк Ганта */
  statusByEmployee: Record<string, 'ok' | 'warn' | 'block'>;
  /** Флаги для HR, не привязанные к сотруднику: срок графика */
  notices: RuleResult[];
}

/** Конфликты по всей компании для Ганта HR. context — остальные настройки (сегодня, этап, роли, исключения). */
export function teamConflicts(
  allEmployees: Employee[], allPlans: Plan[], rules: RuleConfig[], context: Partial<CheckContext> = {},
): TeamReport {
  const ctx = createContext({ ...context, employees: allEmployees, plans: allPlans, rules });
  const conflicts: TeamConflict[] = [];
  const statusByEmployee: Record<string, 'ok' | 'warn' | 'block'> = {};
  for (const e of allEmployees) {
    const plan = allPlans.find((p) => p.employeeId === e.id);
    if (!plan) continue;
    const res = checkPlan(e, plan, ctx);
    statusByEmployee[e.id] = res.status;
    for (const r of res.results) {
      if (r.status === 'block' || r.status === 'warn' || r.status === 'exception') {
        conflicts.push({ ...r, employeeId: e.id, resolved: r.status === 'exception' });
      }
    }
  }
  const rule = ruleOf(rules, 'scheduleDeadline');
  const notice = R.scheduleDeadline(ctx, rule);
  const notices: RuleResult[] = [];
  if (rule.enabled && notice.violated) {
    notices.push({
      code: rule.code, title: rule.title, status: rule.severity, message: notice.message, basis: rule.basis,
      partIds: [], dates: notice.dates ?? [], employeeIds: [], dateBound: false,
    });
  }
  return { conflicts, statusByEmployee, notices };
}
