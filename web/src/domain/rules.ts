/**
 * Правила проверки. Каждое — отдельная функция: на вход часть или план и параметры правила,
 * на выход находка (нарушено ли, пояснение, затронутые даты и люди). Жёсткость, льготы и
 * исключения HR к находке применяет движок (engine.ts), правила о них не знают.
 */
import { holidaysBetween, isWorkingDay } from './calendar';
import { param, policyOf, ruleOf } from './config';
import { addMonths, dateText, dayNum, daysText, overlaps, rangeText, rangesText, runs, toDay, toIso } from './dates';
import { absentOn, type Absence, type Group } from './groups';
import type { CheckContext, DateRange, Employee, IsoDate, RuleConfig, Severity, Stage, VacationPart } from './types';

/** Часть плана с посчитанными днями */
export interface PartView {
  part: VacationPart;
  /** Номер части с 1 */
  index: number;
  s: number;
  e: number;
  valid: boolean;
  days: number;
  holidays: IsoDate[];
  summerDays: number;
  stage: Stage;
}

export interface Finding {
  violated: boolean;
  message: string;
  /** Правило к этой части не относится: пояснение, почему (статус off) */
  notApplicable?: boolean;
  /** Не нарушение, но стоит показать (статус info) */
  notice?: boolean;
  dates?: DateRange[];
  employeeIds?: string[];
  /** Потолок жёсткости для этой находки: правило может быть мягче, но не строже */
  severity?: Severity;
  /** Ошибка данных (замещающий — сам сотрудник и т. п.): последствие law, исключением не снимается */
  dataError?: boolean;
}

const ok = (message: string): Finding => ({ violated: false, message });
const na = (message: string): Finding => ({ violated: false, notApplicable: true, message });
const label = (p: PartView) => `Часть ${p.index}`;

/** Плановое лечение при выключенном пункте регламента о лечении (R20): правила регламента к нему не применяются */
function treatmentOff(p: PartView, ctx?: CheckContext): Finding | null {
  if (p.part.type === 'treatment' && ctx && !ruleOf(ctx.rules, 'treatmentLeave').enabled) {
    return na('Плановое лечение не проверяется правилами отпусков (пункт регламента о плановом лечении выключен)');
  }
  return null;
}

/** Под лимиты и сроки регламента не попадают: ст. 189 и социальные отпуска всегда, лечение — при выключенном пункте о лечении */
function exemptType(p: PartView, ctx?: CheckContext): Finding | null {
  if (p.part.type === 'unpaid189') return na('Ст. 189: отказать нельзя, ограничения состава не действуют');
  if (p.part.type === 'social') return na('Социальный отпуск: даты задаёт документ');
  return treatmentOff(p, ctx);
}

/* ---------------- правила части ---------------- */

/** Лимит группы: на каждый день части отсутствующих коллег плюс сам сотрудник не больше лимита */
export function groupLimit(p: PartView, group: Group, peers: Absence[], ctx?: CheckContext): Finding {
  const ex = exemptType(p, ctx);
  if (ex) return ex;
  if (group.limit === null) return ok('Для группы лимита нет');
  const bad: number[] = [];
  const who = new Set<string>();
  for (let n = p.s; n <= p.e; n++) {
    const off = absentOn(peers, n);
    if (off.length + 1 > group.limit) { bad.push(n); off.forEach((id) => who.add(id)); }
  }
  if (!bad.length) return ok('Места есть на все дни');
  const dates = runs(bad);
  return {
    violated: true,
    message: `${label(p)}: ${rangesText(dates)} мест нет (лимит ${group.limit})`,
    dates,
    employeeIds: [...who],
  };
}

/** Зависимости ролей: пока сотрудник в отпуске, связанные роли должны быть на месте */
export function roleDependencies(p: PartView, group: Group, deps: Absence[], ctx: CheckContext): Finding {
  const ex = exemptType(p, ctx);
  if (ex) return ex;
  if (!group.dependencyIds.length) return ok('Для роли зависимостей нет');
  const byPerson = new Map<string, number[]>();
  for (let n = p.s; n <= p.e; n++) {
    for (const id of absentOn(deps, n)) {
      if (!byPerson.has(id)) byPerson.set(id, []);
      byPerson.get(id)!.push(n);
    }
  }
  if (!byPerson.size) return ok('Связанные роли на месте');
  const dates: DateRange[] = [];
  const texts: string[] = [];
  for (const [id, days] of byPerson) {
    const r = runs(days);
    dates.push(...r);
    const x = ctx.employees.find((e) => e.id === id);
    texts.push(`${rangesText(r)} в отпуске ${x ? policyOf(ctx.roles, x.role).name : id}`);
  }
  return { violated: true, message: `${label(p)}: ${texts.join('; ')}`, dates, employeeIds: [...byPerson.keys()] };
}

const summerType = (p: PartView) => p.valid && p.part.type !== 'social' && p.part.type !== 'treatment';

/** Между частями нет ни одного рабочего дня: только выходные и праздники — для лета это один отпуск */
function adjacent(a: PartView, b: PartView): boolean {
  for (let n = a.e + 1; n < b.s; n++) if (isWorkingDay(toIso(n))) return false;
  return b.s > a.e;
}

/**
 * Летом (1 июня — 31 августа) не больше N дней подряд (регламент, летний период). Части, между которыми
 * нет рабочих дней, считаются одним отпуском: 1–14 и 15–28 июня — это 28 дней, а не дважды по 14.
 */
export function summerLength(p: PartView, parts: PartView[], rule: RuleConfig): Finding {
  const max = param(rule, 'days');
  if (p.part.type === 'social') return na('Социальный отпуск: даты задаёт документ');
  if (p.part.type === 'treatment') return na('Плановое лечение: правило о летнем отпуске к нему не относится');
  if (!p.summerDays) return ok('Не летом');
  // цепочка смежных частей вокруг p
  const list = parts.filter(summerType).sort((a, b) => a.s - b.s);
  let i = list.indexOf(p), j = i;
  while (i > 0 && adjacent(list[i - 1], list[i])) i--;
  while (j < list.length - 1 && adjacent(list[j], list[j + 1])) j++;
  const chain = list.slice(i, j + 1);
  const days = chain.reduce((s, x) => s + x.summerDays, 0);
  if (days <= max) return ok(`Летом ${daysText(days)}`);
  const first = chain[0].part, last = chain[chain.length - 1].part;
  const joined = chain.length > 1 ? ` (части ${chain.map((x) => x.index).join(' и ')} подряд, ${rangeText(first.start, last.end)})` : '';
  return {
    violated: true,
    message: `${label(p)}: летом (1 июня — 31 августа) можно не больше ${daysText(max)} — у вас ${days}${joined}`,
    dates: [{ start: first.start, end: last.end }],
  };
}

/** Заявка не позже чем за N дней до начала */
export function noticeMonth(p: PartView, rule: RuleConfig, today: IsoDate, ctx?: CheckContext): Finding {
  if (p.part.type === 'unpaid189' || p.part.type === 'social') return na('Для обязательных и социальных отпусков срок не нужен');
  const ex = exemptType(p, ctx);
  if (ex) return ex;
  // у переноса свой срок — правило «Перенос за 14 дней»
  if (p.part.reschedule) return na('Перенос: срок подачи — по правилу переноса');
  const days = param(rule, 'days');
  const from = p.part.submittedOn ?? today;
  const ahead = p.s - toDay(from);
  if (ahead >= days) return ok('Подана заранее');
  return {
    violated: true,
    message: `${label(p)}: до начала ${daysText(Math.max(ahead, 0))}, по регламенту заявка за ${days}`,
    dates: [{ start: p.part.start, end: p.part.end }],
  };
}

/** Перенос по соглашению — заявление не позже чем за N дней до начала прежних дат */
export function rescheduleNotice(p: PartView, rule: RuleConfig): Finding {
  const r = p.part.reschedule;
  if (!r) return na('Переноса нет');
  if (r.reason !== 'agreement') return ok('Перенос по основанию ст. 171 ТК, срок не нужен');
  const days = param(rule, 'days');
  const ahead = toDay(r.fromStart) - toDay(r.requestedOn);
  if (ahead >= days) return ok(`Перенос заявлен за ${daysText(ahead)}`);
  return {
    violated: true,
    message: `${label(p)}: перенос заявлен за ${daysText(Math.max(ahead, 0))}, по регламенту — за ${days}`,
    dates: [{ start: r.fromStart, end: r.fromEnd }, { start: p.part.start, end: p.part.end }],
  };
}

/** Первый отпуск — после N месяцев работы, раньше — по соглашению или по праву ч. 2–3 ст. 166 */
export function firstVacation(p: PartView, employee: Employee, rule: RuleConfig): Finding {
  if (p.part.type !== 'main') return na('Только для основного отпуска');
  const from = addMonths(employee.hiredOn, param(rule, 'months'));
  if (p.part.start >= from) return ok('Стаж для отпуска есть');
  if (employee.earlyFirstLeave) return ok('Право на отпуск раньше 6 месяцев (ч. 2–3 ст. 166 ТК)');
  if (p.part.earlyConsent) return ok('Раньше 6 месяцев по соглашению с работником');
  return {
    violated: true,
    message: `${label(p)}: работает с ${dateText(employee.hiredOn, true)}, без соглашения отпуск — с ${dateText(from, true)}`,
    dates: [{ start: p.part.start, end: p.part.end }],
  };
}

/** Уволен ли сотрудник к дате date (или вообще, если дата не важна) */
export function isDismissed(e: Employee, date?: IsoDate): boolean {
  return !!e.dismissed || (!!e.dismissedOn && (!date || e.dismissedOn <= date));
}

/**
 * Замещающий на месте: указан, это не сам сотрудник и не уволенный, и он не в отпуске ни в один
 * день части (его части в любом статусе, кроме отклонённых). Не указан — в черновике только
 * предупреждение, при отправке плана — по жёсткости правила.
 */
export function substitute(p: PartView, employee: Employee, ctx: CheckContext): Finding {
  if (p.part.type === 'social') return na('Социальный отпуск: даты задаёт документ');
  const off = treatmentOff(p, ctx);
  if (off) return off;
  const id = p.part.substituteId;
  if (!id) {
    const draft = p.part.status === 'draft' || p.part.status === 'returned';
    return {
      violated: true,
      message: draft ? `${label(p)}: укажите, кто вас замещает` : `${label(p)}: замещающий не указан`,
      ...(ctx.submitting ? {} : { severity: 'warn' as const }),
    };
  }
  if (id === employee.id) return { violated: true, dataError: true, message: `${label(p)}: замещающим указан сам сотрудник`, employeeIds: [id] };
  const sub = ctx.employees.find((e) => e.id === id);
  if (!sub || isDismissed(sub, p.part.end)) {
    return { violated: true, dataError: true, message: `${label(p)}: замещающий не найден среди работающих сотрудников`, employeeIds: [id] };
  }
  const busy: number[] = [];
  for (const plan of ctx.plans) {
    if (plan.employeeId !== id) continue;
    for (const x of plan.parts) {
      if (x.status === 'rejected' || x.end < x.start) continue;
      for (let n = Math.max(p.s, toDay(x.start)); n <= Math.min(p.e, toDay(x.end)); n++) if (!busy.includes(n)) busy.push(n);
    }
  }
  if (!busy.length) return ok('Замещающий на месте');
  const dates = runs(busy.sort((a, b) => a - b));
  return {
    violated: true,
    message: `${label(p)}: замещающий в отпуске ${rangesText(dates)} — выберите другого коллегу или сдвиньте даты`,
    dates,
    employeeIds: [id],
  };
}

/** Праздники внутри части: отпуск длиннее (ст. 151) */
export function holidays(p: PartView): Finding {
  const list = holidaysBetween(p.part.start, p.part.end);
  if (!list.length) return ok('Праздников нет');
  const names = list.map((h) => `${dateText(h.date)} — ${h.name}`).join(', ');
  return {
    violated: false,
    notice: true,
    message: `${label(p)}: ${names}; отпуск длиннее на ${daysText(list.length)}`,
    dates: list.map((h) => ({ start: h.date, end: h.date })),
  };
}

/**
 * Даты не в прошлом: часть, которая ещё не согласована, начинается не раньше сегодня + N дней.
 * Отпуск задним числом не оформляется — это ошибка заполнения, исключением не снимается.
 */
export function pastDates(p: PartView, rule: RuleConfig, today: IsoDate): Finding {
  if (p.part.status === 'approved') return na('Часть уже согласована');
  const first = toIso(toDay(today) + param(rule, 'daysAhead'));
  if (p.part.start >= first) return ok('Даты впереди');
  const when = p.part.end < today
    ? `${rangeText(p.part.start, p.part.end)} уже прошли`
    : p.part.start < today ? `${dateText(p.part.start)} уже прошло` : `начать ${dateText(p.part.start)} уже не успеть`;
  return {
    violated: true,
    dataError: true,
    message: `${label(p)}: ${when} — выберите даты не раньше ${dateText(first, true)}`,
    dates: [{ start: p.part.start, end: p.part.end < first ? p.part.end : toIso(toDay(first) - 1) }],
  };
}

/**
 * Полугодовой график (регламент, график на полугодие): часть первого полугодия — заявление до 15 января,
 * второго — до 15 июля того же года (или срок из settings.halfYears). Считается от даты подачи
 * (или сегодня). Если график полугодия уже утверждён — новая часть в нём только по договорённости.
 */
export function halfYearDeadline(p: PartView, rule: RuleConfig, today: IsoDate, ctx?: CheckContext): Finding {
  if (p.part.type === 'social' || p.part.type === 'unpaid189') return na('Для обязательных и социальных отпусков срок не нужен');
  const off = treatmentOff(p, ctx);
  if (off) return off;
  if (p.part.reschedule) return na('Перенос: срок — по правилу переноса');
  const y = +toIso(p.s).slice(0, 4);
  const half = toIso(p.s).slice(5, 7) > '06' ? 2 : 1;
  const name = half === 2 ? 'второе' : 'первое';
  const hy = ctx?.settings.halfYears?.find((h) => h.year === y && h.half === half);
  if (hy?.approved) {
    return {
      violated: true,
      message: `${label(p)}: график на ${name} полугодие ${y} уже утверждён — нужна договорённость с отделом кадров`,
      dates: [{ start: p.part.start, end: p.part.end }],
    };
  }
  const deadline = hy?.deadline ?? toIso(dayNum(y, param(rule, half === 2 ? 'h2Month' : 'h1Month') - 1, param(rule, half === 2 ? 'h2Day' : 'h1Day')));
  const from = p.part.submittedOn ?? today;
  if (from <= deadline) return ok(`Заявление на ${name} полугодие — до ${dateText(deadline, true)}`);
  return {
    violated: true,
    message: `${label(p)}: заявление на ${name} полугодие нужно было подать до ${dateText(deadline, true)}`,
    dates: [{ start: p.part.start, end: p.part.end }],
  };
}

/**
 * Отпускные по заявлению (регламент): не нарушение, только пометка риска у частей, где отмечено
 * «нужны отпускные» (info). Без отметки — ничего.
 */
export function payRequest(p: PartView): Finding {
  if (p.part.type !== 'main') return na('Только для основного отпуска');
  if (!p.part.needsPay) return ok('Отпускные не запрошены');
  return { violated: false, notice: true, message: `${label(p)}: отпускные по заявлению, не больше оклада` };
}

/** Плановое лечение и за свой счёт проверяются по правилам отпусков (регламент) — показываем пометкой у части лечения */
export function treatmentLeave(p: PartView): Finding {
  if (p.part.type !== 'treatment') return na('Не плановое лечение');
  return { violated: false, notice: true, message: `${label(p)}: плановое лечение проверяется по лимитам и срокам регламента, как отпуск` };
}

/* ---------------- правила плана ---------------- */

/** Хотя бы одна основная часть не меньше N дней (ч. 1 ст. 174) */
export function longPart(parts: PartView[], rule: RuleConfig): Finding {
  const min = param(rule, 'days');
  const mains = parts.filter((p) => p.valid && p.part.type === 'main');
  if (!mains.length) return na('Основного отпуска в плане нет');
  if (mains.some((p) => p.days >= min)) return ok(`Есть часть от ${daysText(min)}`);
  return { violated: true, message: `Ни одна часть не дотягивает до ${daysText(min)}` };
}

/** Основных дней не больше нормы (ст. 155); меньше — пометка «не распределено» */
export function yearNorm(parts: PartView[], employee: Employee): Finding {
  const norm = employee.normDays + (employee.extraDays ?? 0);
  const total = parts.filter((p) => p.valid && p.part.type === 'main').reduce((s, p) => s + p.days, 0);
  if (total > norm) return { violated: true, message: `Запланировано ${daysText(total)} при норме ${norm}, лишних ${total - norm}` };
  if (total < norm) return { violated: false, notice: true, message: `Не распределено ещё ${daysText(norm - total)} из ${norm}` };
  return ok(`Распределены все ${daysText(norm)}`);
}

/** Даты частей корректны, части не пересекаются */
export function noOverlap(parts: PartView[]): Finding {
  const broken = parts.find((p) => !p.valid);
  if (broken) return { violated: true, message: `${label(broken)}: последний день раньше первого` };
  for (let a = 0; a < parts.length; a++) {
    for (let b = a + 1; b < parts.length; b++) {
      const x = parts[a].part, y = parts[b].part;
      if (overlaps(x, y)) {
        const s = x.start > y.start ? x.start : y.start, e = x.end < y.end ? x.end : y.end;
        return {
          violated: true,
          message: `Части ${parts[a].index} и ${parts[b].index} пересекаются: ${rangeText(s, e)}`,
          dates: [{ start: s, end: e }],
        };
      }
    }
  }
  return ok('Всё в порядке');
}

/** Частей в плане не больше N (ч. 1 ст. 174: больше двух — если разрешает ЛПА) */
export function maxParts(parts: PartView[], rule: RuleConfig): Finding {
  const max = param(rule, 'parts');
  const n = parts.filter((p) => p.part.type === 'main').length;
  if (n <= max) return ok(`Частей: ${n}`);
  return { violated: true, message: `Частей ${n}, можно не больше ${max}` };
}

/** Календарных дней частей типа type в плане (без отклонённых) */
function unpaidDays(parts: PartView[], type: VacationPart['type']): { days: number; ids: string[] } {
  const list = parts.filter((p) => p.valid && p.part.type === type);
  return { days: list.reduce((s, p) => s + p.e - p.s + 1, 0), ids: list.map((p) => p.part.id) };
}

/**
 * Ст. 190: за свой счёт до N календарных дней в году; больше — по коллективному договору,
 * ЛПА или решению нанимателя (предупреждение), сверх maxDays (3 месяца) — нельзя.
 */
export function unpaid190Limit(parts: PartView[], rule: RuleConfig): Finding & { partIds: string[] } {
  const { days, ids } = unpaidDays(parts, 'unpaid190');
  const lim = param(rule, 'days'), max = param(rule, 'maxDays');
  if (!days) return { ...na('Отпуска за свой счёт по ст. 190 нет'), partIds: [] };
  if (days <= lim) return { ...ok(`За свой счёт ${daysText(days)} из ${lim}`), partIds: ids };
  if (days > max) {
    return { violated: true, partIds: ids,
      message: `За свой счёт (ст. 190) в году — не больше ${daysText(max)}, у вас ${days}` };
  }
  return { violated: true, severity: 'warn', partIds: ids,
    message: `За свой счёт в году можно до ${lim} календарных дней — у вас ${days}. Больше — только по коллективному договору или решению нанимателя` };
}

/** Ст. 189: обязательный отпуск без сохранения — до N календарных дней в году, сверх — по договорённости (ст. 190) */
export function unpaid189Limit(parts: PartView[], rule: RuleConfig): Finding & { partIds: string[] } {
  const { days, ids } = unpaidDays(parts, 'unpaid189');
  const lim = param(rule, 'days');
  if (!days) return { ...na('Отпуска по ст. 189 нет'), partIds: [] };
  if (days <= lim) return { ...ok(`По ст. 189 ${daysText(days)} из ${lim}`), partIds: ids };
  return { violated: true, partIds: ids,
    message: `Обязательный отпуск за свой счёт (ст. 189) — до ${lim} календарных дней в году, у вас ${days}. Сверх ${lim} — только по договорённости (ст. 190)` };
}

/* ---------------- правило компании ---------------- */

/**
 * Срок графика: ТК (ч. 2 ст. 168) — годовой график до 5 января; регламент требует
 * полугодовой до 15 января и 15 июля. Иной срок законен только по коллективному договору
 * или с профсоюзом. Это флаг для HR, на заявки не влияет.
 */
export function scheduleDeadline(ctx: CheckContext, rule: RuleConfig): Finding {
  const { year, regulationDeadlines, collectiveAgreement } = ctx.settings;
  const lawDate = toIso(dayNum(year, param(rule, 'month') - 1, param(rule, 'day')));
  const later = regulationDeadlines.filter((d) => d > lawDate);
  const base = `График на ${year} год утвердить до ${dateText(lawDate, true)}`;
  if (!later.length) return ok(base);
  if (collectiveAgreement) return ok(`${base}; иной срок регламента опирается на коллективный договор`);
  return {
    violated: true,
    message: `${base}. Регламент требует ${regulationDeadlines.length > 1 ? 'полугодовой график до ' : 'график до '}`
      + `${regulationDeadlines.map((d) => dateText(d)).join(' и ')} — без коллективного договора это расходится с ТК`,
    dates: [{ start: lawDate, end: lawDate }],
  };
}
