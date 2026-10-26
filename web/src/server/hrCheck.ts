/**
 * Проверка графика для экранов HR (правила, сотрудники): все конфликты компании с подменой
 * части настроек — правил, групп, связей ролей или карточки сотрудника. Ничего не пишет.
 */
import "server-only";
import { createContext, teamConflicts, withOpenChanges, type PartChange } from "@/domain";
import { changeFromDb, dbRuleCode, employeeFromDb, exceptionsFromDb, planFromDb, rolesFromDb, rulesFromDb } from "@/domain/fromDb";
import { PLAN_YEAR } from "@/lib/config";
import { changes, employees, exceptions, parts, roles, rules } from "./db/repo";
import type { Employee, LimitGroup, RequestPart, RoleDependency, Rule } from "./db/types";

export interface ConflictItem {
  key: string;
  employeeId: string;
  employeeName: string;
  ruleCode: string;
  title: string;
  message: string;
  level: "block" | "warn" | "exception";
}

export interface CheckSummary {
  block: number;
  warn: number;
  exception: number;
  /** Сотрудников с запретом или предупреждением */
  people: number;
  byRule: Record<string, { block: number; warn: number; exception: number }>;
  items: ConflictItem[];
}

export interface CheckDiff {
  now: CheckSummary;
  next: CheckSummary;
  gone: ConflictItem[];
  added: ConflictItem[];
}

/** Что подменить в проверке; не заданное берётся из базы. */
export interface CheckOverride {
  rules?: Rule[];
  groups?: LimitGroup[];
  dependencies?: RoleDependency[];
  employees?: Employee[];
}

export function checkSummary(o: CheckOverride = {}): CheckSummary {
  const people = o.employees ?? employees.listActive();
  // контекст собран как в server/engine.ts, только с подменой: открытые переносы занимают и старые, и новые даты,
  // исключения HR привязаны к датам частей из базы
  const all = parts.forYear(PLAN_YEAR);
  const byEmployee = new Map<string, RequestPart[]>();
  for (const p of all) byEmployee.set(p.employeeId, [...(byEmployee.get(p.employeeId) ?? []), p]);
  const open = changes.forYear(PLAN_YEAR).map(changeFromDb).filter((c): c is PartChange => c !== null);
  const ctx = createContext({
    employees: people.map(employeeFromDb),
    plans: withOpenChanges([...byEmployee].filter(([id]) => people.some((e) => e.id === id)).map(([id, list]) => planFromDb(id, PLAN_YEAR, list)), open),
    roles: rolesFromDb(roles.list(), o.groups ?? roles.groups(), o.dependencies ?? roles.dependencies()),
    rules: rulesFromDb(o.rules ?? rules.list()),
    exceptions: exceptionsFromDb(exceptions.list(), all),
  });
  const report = teamConflicts(ctx.employees, ctx.plans, ctx.rules, ctx);
  const names = new Map(people.map((e) => [e.id, e.fullName]));
  const items: ConflictItem[] = report.conflicts.map((c) => {
    const ruleCode = dbRuleCode(c.code);
    return {
      key: `${c.employeeId}|${ruleCode}|${c.partIds.join(",")}`,
      employeeId: c.employeeId, employeeName: names.get(c.employeeId) ?? c.employeeId,
      ruleCode, title: c.title, message: c.message,
      level: c.status === "exception" ? "exception" : c.status === "block" ? "block" : "warn",
    };
  });
  const byRule: CheckSummary["byRule"] = {};
  for (const i of items) (byRule[i.ruleCode] ??= { block: 0, warn: 0, exception: 0 })[i.level]++;
  const count = (l: ConflictItem["level"]) => items.filter((i) => i.level === l).length;
  return {
    block: count("block"), warn: count("warn"), exception: count("exception"),
    people: new Set(items.filter((i) => i.level !== "exception").map((i) => i.employeeId)).size,
    byRule, items,
  };
}

/** Конфликты сейчас и с подменой: какие снимутся, какие появятся (разрешённые исключением не в счёт). */
export function checkDiff(o: CheckOverride): CheckDiff {
  const now = checkSummary();
  const next = checkSummary(o);
  const open = (s: CheckSummary) => new Set(s.items.filter((i) => i.level !== "exception").map((i) => i.key));
  const nowKeys = open(now), nextKeys = open(next);
  return {
    now, next,
    gone: now.items.filter((i) => i.level !== "exception" && !nextKeys.has(i.key)),
    added: next.items.filter((i) => i.level !== "exception" && !nowKeys.has(i.key)),
  };
}
