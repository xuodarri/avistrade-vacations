"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { employees } from "../db/repo";
import { transaction } from "../db/client";
import { logAudit } from "../audit";
import { SESSION_COOKIE, accessOf, currentUser, homeFor } from "../session";

/** Демо-вход «Войти как…». */
export async function loginAs(employeeId: string, next?: string) {
  const e = employees.get(employeeId);
  if (!e) throw new Error(`Нет сотрудника ${employeeId}`);
  const prev = await currentUser();
  (await cookies()).set(SESSION_COOKIE, e.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  transaction(() => logAudit({ actorId: e.id, action: "login", entity: "session", entityId: e.id, before: { as: prev.id }, after: { as: e.id } }));
  redirect(next ?? homeFor({ access: accessOf(e) }));
}
