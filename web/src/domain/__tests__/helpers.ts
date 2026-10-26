import { DEFAULT_RULES, checkPlan, createContext } from '..';
import { SAMPLE_EMPLOYEES, SAMPLE_PLANS } from '../sample';
import type { CheckContext, Plan, RuleCode, VacationPart } from '../types';

export const emp = (id: string) => {
  const e = SAMPLE_EMPLOYEES.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

/** Части в коротком виде: [с, по] или полная часть */
export type PartInput = [string, string] | (Partial<VacationPart> & { start: string; end: string });

export function planOf(employeeId: string, parts: PartInput[], extra: Partial<Plan> = {}): Plan {
  return {
    employeeId, year: 2027, ...extra,
    parts: parts.map((p, i) => {
      const base = { id: `${employeeId}-p${i + 1}`, type: 'main' as const, status: 'pending' as const };
      return Array.isArray(p) ? { ...base, start: p[0], end: p[1] } : { ...base, ...p };
    }),
  };
}

/** Правила по умолчанию без «Замещающий на месте» и «Отпускные по заявлению»: в демо-планах нет ни замещающих, ни отметок, их проверяют отдельные тесты */
export const RULES = DEFAULT_RULES.map((r) => (r.code === 'substitute' || r.code === 'payRequest' ? { ...r, enabled: false } : r));

export function ctxWith(over: Partial<CheckContext> = {}, plans: Plan[] = SAMPLE_PLANS): CheckContext {
  return createContext({ today: '2026-11-25', employees: SAMPLE_EMPLOYEES, plans, rules: RULES, ...over });
}

/** Проверка плана и результаты одного правила */
export function check(employeeId: string, parts: PartInput[], over: Partial<CheckContext> = {}, extra: Partial<Plan> = {}, plans?: Plan[]) {
  const ctx = ctxWith(over, plans);
  const employee = ctx.employees.find((e) => e.id === employeeId) ?? emp(employeeId);
  const res = checkPlan(employee, planOf(employeeId, parts, extra), ctx);
  return { res, of: (code: RuleCode) => res.results.filter((r) => r.code === code) };
}
