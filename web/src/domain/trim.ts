/**
 * Советы «где освободить дни», когда основных дней в плане больше нормы: каждая основная
 * часть (и новое выделение тоже) обрезается с конца или с начала ровно на лишние дни
 * отпуска, и весь план проверяется заново. Остаются варианты, которые не добавляют запретов.
 */
import { holidayAt, vacationEnd } from './calendar';
import { daysText, rangeText, toDay, toIso } from './dates';
import { checkPlan, measurePlan } from './engine';
import type { CheckContext, CheckResult, DateRange, Employee, IsoDate, Plan, RuleResult } from './types';

export interface TrimSuggestion {
  partId: string;
  /** Номер части в плане с 1 */
  index: number;
  /** Это новое выделение, а не уже стоящая часть */
  draft: boolean;
  /** С какой стороны обрезана часть */
  side: 'end' | 'start';
  from: DateRange;
  to: DateRange;
  /** Дней отпуска в части после обрезки */
  days: number;
  /** Сколько дней освобождается */
  freedDays: number;
  /**
   * ok — после обрезки план чист; warn — остались предупреждения или запреты, которые были и до
   * обрезки и ею не вызваны (новых запретов вариант не добавляет)
   */
  status: 'ok' | 'warn';
  /** Обрезка задевает согласованную часть */
  touchesApproved: boolean;
  /** На сколько календарных дней сдвигается начало части (у обрезки с конца — 0) */
  shift: number;
  /** «Часть 2: 22 ноября – 2 декабря → 22–25 ноября, освободится 7 дней» */
  message: string;
  result: CheckResult;
}

/** Первый день, с которого до end ровно days дней отпуска (праздники не в счёт) */
function startFor(end: IsoDate, days: number): IsoDate {
  let n = toDay(end), k = 0;
  for (;;) {
    if (!holidayAt(n)) k++;
    if (k >= days) return toIso(n);
    n--;
  }
}

/**
 * Варианты освободить overflow дней (по умолчанию — превышение нормы основным отпуском).
 * draftId — id нового выделения в plan.parts, если оно есть. Порядок: сначала без
 * предупреждений, затем не задевающие согласованные части, затем с меньшим сдвигом начала.
 */
export function trimSuggestions(
  employee: Employee, plan: Plan, context: CheckContext, opts: { draftId?: string; overflow?: number } = {},
): TrimSuggestion[] {
  const views = measurePlan(plan, context.stage).filter((p) => p.valid && p.part.type === 'main');
  const norm = employee.normDays + (employee.extraDays ?? 0);
  const overflow = opts.overflow ?? views.reduce((s, p) => s + p.days, 0) - norm;
  if (overflow <= 0) return [];

  // запреты, которые уже есть в плане с выделением и обрезкой не вызваны (например, лимит на
  // нетронутой части), совету не мешают; отбрасываем, только если появился новый запрет или
  // не ушёл перебор нормы
  const key = (r: RuleResult) => `${r.code}|${r.partIds.join(',')}`;
  const before = new Set(checkPlan(employee, plan, context).results
    .filter((r) => r.status === 'block' && r.code !== 'yearNorm').map(key));

  const out: TrimSuggestion[] = [];
  for (const v of views) {
    const days = v.days - overflow;
    // целиком часть не убираем: это уже не обрезка
    if (days < 1) continue;
    const { start, end } = v.part;
    const variants: { side: 'end' | 'start'; to: DateRange }[] = [
      { side: 'end', to: { start, end: vacationEnd(start, days) } },
      { side: 'start', to: { start: startFor(end, days), end } },
    ];
    for (const x of variants) {
      const trimmed: Plan = { ...plan, parts: plan.parts.map((p) => (p.id === v.part.id ? { ...p, ...x.to } : p)) };
      const result = checkPlan(employee, trimmed, context);
      if (result.results.some((r) => r.status === 'block' && (r.code === 'yearNorm' || !before.has(key(r))))) continue;
      const draft = v.part.id === opts.draftId;
      out.push({
        partId: v.part.id, index: v.index, draft, side: x.side,
        from: { start, end }, to: x.to, days, freedDays: overflow,
        status: result.status === 'ok' ? 'ok' : 'warn',
        touchesApproved: v.part.status === 'approved',
        shift: toDay(x.to.start) - toDay(start),
        message: `${draft ? 'Новые даты' : `Часть ${v.index}`}: ${rangeText(start, end)} → ${rangeText(x.to.start, x.to.end)}, `
          + `освободится ${daysText(overflow)}`,
        result,
      });
    }
  }
  const rank = (s: TrimSuggestion) => [s.status === 'ok' ? 0 : 1, s.touchesApproved ? 1 : 0, s.shift, s.index];
  return out.sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

/**
 * До limit выполнимых советов «что сократить» для экрана сотрудника: согласованные части не
 * трогаются; порядок — без предупреждений раньше, затем сама изменяемая часть targetId раньше
 * других, затем обрезка с конца раньше, чем с начала.
 */
export function normFixes(employee: Employee, plan: Plan, targetId: string, context: CheckContext, limit = 3): TrimSuggestion[] {
  const rank = (s: TrimSuggestion) => [s.status === 'ok' ? 0 : 1, s.draft ? 0 : 1, s.side === 'end' ? 0 : 1, s.index];
  return trimSuggestions(employee, plan, context, { draftId: targetId })
    .filter((s) => !s.touchesApproved)
    .sort((a, b) => {
      const x = rank(a), y = rank(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    })
    .slice(0, limit);
}
