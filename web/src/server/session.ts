/**
 * Демо-вход: id сотрудника в cookie. Замена корпоративной авторизации (AD / SSO) для прототипа.
 * В бою `currentUser` читает пользователя из сессии SSO, остальной код не меняется.
 */
import "server-only";
import { cookies } from "next/headers";
import { employees } from "./db/repo";
import type { AccessKind, Employee } from "./db/types";

export const SESSION_COOKIE = "demo_user";
const DEFAULT_USER = "E13"; // Иванова, менеджер по продажам

export interface CurrentUser extends Employee {
  access: AccessKind[]; // всегда есть employee; manager — если есть подчинённые; hr — флаг is_hr
}

export function accessOf(e: Employee): AccessKind[] {
  const a: AccessKind[] = ["employee"];
  if (employees.reports(e.id).length) a.push("manager");
  if (e.isHr) a.push("hr");
  return a;
}

export async function currentUser(): Promise<CurrentUser> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value ?? DEFAULT_USER;
  const e = employees.get(id) ?? employees.get(DEFAULT_USER)!;
  return { ...e, access: accessOf(e) };
}

export const can = (u: CurrentUser, a: AccessKind) => u.access.includes(a);

export class AccessDenied extends Error {
  constructor(what = "Нет доступа") { super(what); this.name = "AccessDenied"; }
}

/** Видеть данные сотрудника может он сам, его руководитель по дереву и HR. */
export function canSeeEmployee(u: CurrentUser, employeeId: string) {
  if (u.id === employeeId || can(u, "hr")) return true;
  return can(u, "manager") && employees.subtree(u.id).some((e) => e.id === employeeId);
}

export async function requireAccess(a: AccessKind) {
  const u = await currentUser();
  if (!can(u, a)) throw new AccessDenied();
  return u;
}

/** Люди для переключателя «Войти как…», по группам. */
export function loginDirectory() {
  const list = employees.listActive().map((e) => ({ ...e, access: accessOf(e) }));
  return {
    hr: list.filter((e) => e.access.includes("hr")),
    manager: list.filter((e) => e.access.includes("manager") && !e.access.includes("hr")),
    employee: list.filter((e) => e.access.length === 1),
  };
}

/** Раздел по умолчанию для роли. */
export function homeFor(u: Pick<CurrentUser, "access">) {
  return u.access.includes("hr") ? "/hr" : u.access.includes("manager") ? "/team" : "/me";
}
