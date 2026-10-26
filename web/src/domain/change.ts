/**
 * Изменение согласованного отпуска (Решения.md, «Изменение согласованного отпуска»):
 * заявка сотрудника на перенос, сокращение или отказ, загрузка группы, пока заявка открыта,
 * и пересчёты для отдела кадров — продление по болезни (ст. 171) и отзыв (ст. 174).
 */
import { holidaysBetween, vacationDays, vacationEnd, type Holiday } from './calendar';
import { param, ruleOf } from './config';
import { dateText, daysText, rangeText, toDay, toIso } from './dates';
import { checkPlan, judge, overall, summarize } from './engine';
import type { CheckContext, CheckResult, Employee, IsoDate, PartChange, Plan, RuleResult, VacationPart } from './types';

/**
 * План с изменением на месте старой части: перенос и сокращение ставят новые даты (часть
 * становится заявкой, R14 считает срок от прежнего начала), отказ убирает часть.
 */
export function applyChange(plan: Plan, change: PartChange): Plan {
  const old = plan.parts.find((p) => p.id === change.partId);
  if (!old) return plan;
  if (change.kind === 'cancel') return { ...plan, parts: plan.parts.filter((p) => p.id !== change.partId) };
  return {
    ...plan,
    parts: plan.parts.map((p): VacationPart => (p.id !== change.partId ? p : {
      ...p,
      start: change.newStart ?? p.start,
      end: change.newEnd ?? p.end,
      status: 'pending',
      submittedOn: change.requestedOn,
      reschedule: { fromStart: old.start, fromEnd: old.end, requestedOn: change.requestedOn, reason: change.reason ?? 'agreement' },
    })),
  };
}

/**
 * Проверка заявки на изменение согласованной части: план с новыми датами (старые у самого
 * сотрудника не учитываются) по всем правилам, плюс:
 * — R14: перенос по соглашению позже чем за 14 дней до прежнего начала — запрет регламента (нужно исключение);
 * — начавшуюся или прошедшую часть сотрудник не меняет (law): это продление или отзыв через HR.
 * Отказ от части проверяется так же: без неё может не остаться части от 14 дней.
 */
export function checkChange(employee: Employee, plan: Plan, change: PartChange, context: CheckContext): CheckResult {
  const old = plan.parts.find((p) => p.id === change.partId);
  if (!old) throw new Error(`В плане нет части ${change.partId}`);
  const index = plan.parts.filter((p) => p.status !== 'rejected').indexOf(old) + 1;
  const changed = applyChange(plan, change);
  const res = checkPlan(employee, changed, context);
  const extra: RuleResult[] = [];

  const lock = ruleOf(context.rules, 'changeLocked');
  const started = old.start <= context.today;
  extra.push(judge(context, lock, employee, context.stage, started
    ? {
      violated: true,
      message: `Часть ${index}: ${old.end < context.today ? `${rangeText(old.start, old.end)} уже прошла` : `идёт с ${dateText(old.start)}`}`
        + ' — изменить её может только отдел кадров (продление по болезни или отзыв)',
      dates: [{ start: old.start, end: old.end }],
    }
    : { violated: false, message: 'Часть ещё не началась' }, [change.partId]));

  // у отказа части в новом плане нет — срок переноса проверяем здесь
  if (change.kind === 'cancel') {
    const rule = ruleOf(context.rules, 'rescheduleNotice');
    const days = param(rule, 'days');
    const ahead = toDay(old.start) - toDay(change.requestedOn);
    const legal = (change.reason ?? 'agreement') !== 'agreement';
    extra.push(judge(context, rule, employee, context.stage, legal || ahead >= days
      ? { violated: false, message: legal ? 'Основание ст. 171 ТК, срок не нужен' : `Отказ заявлен за ${daysText(ahead)}` }
      : {
        violated: true,
        message: `Часть ${index}: отказ заявлен за ${daysText(Math.max(ahead, 0))}, по регламенту — за ${days}`,
        dates: [{ start: old.start, end: old.end }],
      }, [change.partId], changed.parts));
  }

  const results = [...extra, ...res.results];
  return { ...res, results, status: overall(results.map((r) => r.status)), summary: summarize(results) };
}

/**
 * Планы для загрузки группы, пока заявки открыты: у сотрудника остаются старые даты и
 * добавляются новые (часть «change-<id>», статус pending). Место не освобождается до решения,
 * и новые даты не обещаются дважды.
 */
export function withOpenChanges(plans: Plan[], changes: PartChange[]): Plan[] {
  const open = changes.filter((c) => (c.status ?? 'open') === 'open' && c.kind !== 'cancel' && c.newStart && c.newEnd);
  if (!open.length) return plans;
  return plans.map((plan) => {
    const mine = open.filter((c) => c.employeeId === plan.employeeId);
    if (!mine.length) return plan;
    const added = mine.flatMap((c): VacationPart[] => {
      const old = plan.parts.find((p) => p.id === c.partId);
      return old ? [{ ...old, id: `change-${c.id}`, start: c.newStart!, end: c.newEnd!, status: 'pending' }] : [];
    });
    return { ...plan, parts: [...plan.parts, ...added] };
  });
}

/* ---------------- для отдела кадров ---------------- */

export interface SicknessExtension {
  start: IsoDate;
  /** Новый последний день отпуска */
  end: IsoDate;
  /** Дней отпуска, пришедшихся на болезнь: на столько отпуск продлевается */
  addedDays: number;
  /** Праздники в продлённом хвосте: в дни отпуска не входят и сдвигают конец (ст. 151) */
  holidays: Holiday[];
  message: string;
}

/**
 * Продление по болезни (ч. 1 ст. 171): дни отпуска, на которые пришёлся больничный, переносятся
 * в конец. Праздники в отпуск не входят, поэтому они и не «съедаются» болезнью, а в хвосте
 * сдвигают конец. Если болезнь длится дольше отпуска, хвост начинается на следующий день после неё.
 */
export function extendForSickness(start: IsoDate, end: IsoDate, sickStart: IsoDate, sickEnd: IsoDate): SicknessExtension {
  const a = sickStart > start ? sickStart : start;
  const b = sickEnd < end ? sickEnd : end;
  const added = a <= b ? vacationDays(a, b) : 0;
  if (!added) return { start, end, addedDays: 0, holidays: [], message: 'Больничный не пришёлся на дни отпуска' };
  const from = toIso(Math.max(toDay(end), toDay(sickEnd)) + 1);
  const newEnd = vacationEnd(from, added);
  return {
    start, end: newEnd, addedDays: added, holidays: holidaysBetween(from, newEnd),
    message: `Отпуск продлён на ${daysText(added)}: до ${dateText(newEnd, true)}`,
  };
}

export interface Recall {
  allowed: boolean;
  /** Первый рабочий день после отзыва */
  returnOn: IsoDate;
  /** Последний день использованного отпуска */
  end: IsoDate;
  usedDays: number;
  /** Сколько дней отпуска вернётся в остаток */
  returnedDays: number;
  message: string;
  basis: string;
}

/**
 * Отзыв из отпуска (ст. 174): только с согласия работника; работников до 18 лет отзывать нельзя
 * (ч. 5). Неиспользованные дни возвращаются в остаток — их дают в течение года или присоединяют
 * к отпуску следующего года.
 */
export function recallFromVacation(employee: Employee, part: { start: IsoDate; end: IsoDate }, returnOn: IsoDate): Recall {
  const basis = 'ст. 174 ТК';
  const end = toIso(toDay(returnOn) - 1);
  const total = vacationDays(part.start, part.end);
  const base = { returnOn, end, usedDays: 0, returnedDays: 0, basis };
  if (employee.minor) {
    return { ...base, allowed: false, message: 'Работника моложе 18 лет отзывать из отпуска нельзя (ч. 5 ст. 174 ТК)' };
  }
  if (returnOn <= part.start || returnOn > part.end) {
    return { ...base, allowed: false,
      message: `Дата выхода должна быть внутри отпуска: с ${dateText(toIso(toDay(part.start) + 1))} по ${dateText(part.end)}` };
  }
  const used = vacationDays(part.start, end);
  const returned = total - used;
  return {
    ...base, allowed: true, usedDays: used, returnedDays: returned,
    message: `Выход ${dateText(returnOn, true)}: использовано ${daysText(used)}, в остаток вернётся ${daysText(returned)}. `
      + 'Отзыв — только с согласия работника',
  };
}
