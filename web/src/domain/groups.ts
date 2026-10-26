/**
 * Группы: с кем сотрудник делит лимит и кто должен быть на месте, пока он в отпуске.
 * Плюс индекс отсутствий: кто из списка в отпуске в данный день.
 */
import { policyOf } from './config';
import { toDay } from './dates';
import type { Employee, LeaveType, PartStatus, Plan, RoleCode, RolePolicy, Scope } from './types';

export interface Group {
  /** Устойчивый ключ группы: роль и круг, например «МПП|Оптовое отделение|отдел оптовых продаж» */
  key: string;
  label: string;
  role: RoleCode;
  /** Все, кто делит лимит, включая самого сотрудника */
  memberIds: string[];
  /** Сколько членов группы может отдыхать одновременно; null — без лимита */
  limit: number | null;
  /** Кто должен быть на месте (зависимости ролей) */
  dependencyIds: string[];
}

function inScope(scope: Scope | undefined, me: Employee, x: Employee): boolean {
  switch (scope) {
    case 'company': return true;
    case 'unit': return x.unit === me.unit;
    case 'dept': return x.unit === me.unit && (x.dept ?? '') === (me.dept ?? '');
    case 'same-manager': return !!me.managerId && x.managerId === me.managerId;
    case 'own-manager': return !!me.managerId && x.id === me.managerId;
    default: return false;
  }
}

function scopeKey(scope: Scope | undefined, me: Employee): string {
  switch (scope) {
    case 'company': return 'вся компания';
    case 'unit': return me.unit;
    case 'dept': return `${me.unit}|${me.dept ?? ''}`;
    case 'same-manager': return `руководитель ${me.managerId ?? ''}`;
    default: return me.id;
  }
}

export function groupOf(me: Employee, employees: Employee[], roles: RolePolicy[]): Group {
  const p = policyOf(roles, me.role);
  const peers = p.peerScope ? employees.filter((x) => x.id !== me.id && x.role === me.role && inScope(p.peerScope, me, x)) : [];
  const deps = employees.filter((x) => x.id !== me.id && (p.dependsOn ?? []).some((d) => d.role === x.role && inScope(d.scope, me, x)));
  return {
    key: `${me.role}|${p.peerScope ? scopeKey(p.peerScope, me) : me.id}`,
    label: p.groupLabel ?? p.name,
    role: me.role,
    memberIds: [me.id, ...peers.map((x) => x.id)],
    limit: p.limit && peers.length ? p.limit : null,
    dependencyIds: deps.map((x) => x.id),
  };
}

export interface Absence {
  employeeId: string;
  partId: string;
  type: LeaveType;
  s: number;
  e: number;
}

/** Отсутствия выбранных сотрудников по частям, которые занимают место */
export function absencesOf(ids: string[], plans: Plan[], occupying: PartStatus[]): Absence[] {
  const set = new Set(ids);
  const out: Absence[] = [];
  for (const plan of plans) {
    if (!set.has(plan.employeeId)) continue;
    for (const p of plan.parts) {
      if (!occupying.includes(p.status)) continue;
      const s = toDay(p.start), e = toDay(p.end);
      if (e >= s) out.push({ employeeId: plan.employeeId, partId: p.id, type: p.type, s, e });
    }
  }
  return out;
}

/** Кто из списка отсутствия в отпуске в день n (без повторов) */
export function absentOn(list: Absence[], n: number): string[] {
  const out: string[] = [];
  for (const a of list) if (n >= a.s && n <= a.e && !out.includes(a.employeeId)) out.push(a.employeeId);
  return out;
}
