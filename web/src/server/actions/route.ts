"use server";

/**
 * Маршрут согласования, утверждение графика (ч. 1–2 ст. 168 ТК) и уведомления текущего пользователя.
 *
 * События журнала:
 *   route_update      settings  "route"  before/after: RouteSettings          — HR поменял РО1, проверяющего, утверждающего, профсоюз
 *   (график — по полугодиям, регламент — график на полугодие: entityId «2027-1» / «2027-2»; в Schedule есть half и deadline)
 *   schedule_submit   schedule  год-пол. before/after: Schedule              — график отправлен на утверждение
 *   schedule_approve  schedule  год      before/after: Schedule              — «График утверждён» (уведомление всем работающим)
 *   schedule_return   schedule  год      before/after: Schedule              — возвращён на доработку с комментарием
 */
import { revalidatePath } from "next/cache";
import { employees, notifications, routeSettings, schedules } from "../db/repo";
import { transaction } from "../db/client";
import { SCHEDULE_HALF_LABEL, type RouteSettings, type ScheduleHalf } from "../db/types";
import { logAudit } from "../audit";
import { notify } from "../notify";
import { AccessDenied, can, currentUser, requireAccess } from "../session";
import { shortName } from "../approvals";
import { PLAN_YEAR } from "@/lib/config";

const nameOf = (id: string | null) => (id ? shortName(employees.get(id)?.fullName ?? id) : "");

/* ---------------- настройки маршрута ---------------- */

export async function getRouteSettings() {
  await currentUser();
  return routeSettings.get();
}

/** HR меняет маршрут или приватность. Проверяет, что указанные люди есть и работают. */
export async function updateRouteSettings(patch: Partial<RouteSettings>) {
  const u = await requireAccess("hr");
  for (const k of ["ro1Id", "ro1ReviewerId", "scheduleApproverId"] as const) {
    const id = patch[k];
    if (id !== undefined && !employees.listActive().some((e) => e.id === id)) throw new Error(`Сотрудник ${id} не найден среди работающих`);
  }
  const res = transaction(() => {
    const r = routeSettings.set(patch);
    logAudit({ actorId: u.id, action: "route_update", entity: "settings", entityId: "route", before: r.before, after: r.after });
    return r.after;
  });
  revalidatePath("/", "layout");
  return res;
}

/* ---------------- утверждение графика ---------------- */

/** Графики года по полугодиям (регламент: график на полугодие) и маршрут. schedule — I полугодие (для совместимости). */
export async function getSchedule(year = PLAN_YEAR) {
  await currentUser();
  const halves = schedules.list(year);
  return { schedule: halves[0], halves, route: routeSettings.get() };
}

/** HR (РО1) отправляет график на утверждение. Если нужен профсоюз — дата и номер протокола обязательны. */
export async function submitSchedule(input: { year?: number; half?: ScheduleHalf; unionDate?: string | null; unionProtocol?: string | null; comment?: string | null } = {}) {
  const u = await requireAccess("hr");
  const year = input.year ?? PLAN_YEAR;
  const route = routeSettings.get();
  const half = input.half ?? 1;
  const cur = schedules.get(year, half);
  if (cur.status === "pending") throw new Error("График уже на утверждении");
  if (cur.status === "approved") throw new Error("График уже утверждён");
  if (route.unionRequired && (!input.unionDate || !input.unionProtocol?.trim()))
    throw new Error("Нужно согласование с профсоюзом: укажите дату и номер протокола");
  const res = transaction(() => {
    const r = schedules.save({
      ...cur, status: "pending", submittedBy: u.id, submittedAt: new Date().toISOString(), decidedBy: null, decidedAt: null,
      comment: input.comment?.trim() || null, unionDate: input.unionDate ?? cur.unionDate, unionProtocol: input.unionProtocol?.trim() || cur.unionProtocol,
    });
    logAudit({ actorId: u.id, action: "schedule_submit", entity: "schedule", entityId: `${year}-${half}`, before: r.before, after: r.after });
    notify([route.scheduleApproverId], `График отпусков на ${SCHEDULE_HALF_LABEL[half]} ${year} года ждёт вашего утверждения (отправил отдел кадров: ${nameOf(u.id)})`, "/team", "request");
    return r.after;
  });
  revalidatePath("/", "layout");
  return res;
}

function requireApprover(u: Awaited<ReturnType<typeof currentUser>>) {
  if (u.id !== routeSettings.get().scheduleApproverId) throw new AccessDenied("Утверждает график только назначенный в маршруте руководитель");
}

/** Утвердить график: запись в журнал «График утверждён» и уведомление всем работающим (ч. 2 ст. 168 ТК). */
export async function approveSchedule(input: { year?: number; half?: ScheduleHalf; comment?: string | null } = {}) {
  const u = await currentUser();
  requireApprover(u);
  const year = input.year ?? PLAN_YEAR;
  const half = input.half ?? 1;
  const cur = schedules.get(year, half);
  if (cur.status !== "pending") throw new Error("График не на утверждении");
  const res = transaction(() => {
    const r = schedules.save({ ...cur, status: "approved", decidedBy: u.id, decidedAt: new Date().toISOString(), comment: input.comment?.trim() || cur.comment });
    logAudit({ actorId: u.id, action: "schedule_approve", entity: "schedule", entityId: `${year}-${half}`, before: r.before, after: { ...r.after, title: "График утверждён" } });
    notify(employees.listActive().map((e) => e.id), `График отпусков на ${SCHEDULE_HALF_LABEL[half]} ${year} года утверждён. Проверьте свои даты`, "/me", "schedule");
    return r.after;
  });
  revalidatePath("/", "layout");
  return res;
}

/** Вернуть график на доработку с комментарием — уведомление РО1. */
export async function returnSchedule(input: { year?: number; half?: ScheduleHalf; comment: string }) {
  const u = await currentUser();
  requireApprover(u);
  if (!input.comment?.trim()) throw new Error("Напишите, что поправить");
  const year = input.year ?? PLAN_YEAR;
  const half = input.half ?? 1;
  const cur = schedules.get(year, half);
  if (cur.status !== "pending") throw new Error("График не на утверждении");
  const res = transaction(() => {
    const r = schedules.save({ ...cur, status: "returned", decidedBy: u.id, decidedAt: new Date().toISOString(), comment: input.comment.trim() });
    logAudit({ actorId: u.id, action: "schedule_return", entity: "schedule", entityId: `${year}-${half}`, before: r.before, after: r.after });
    notify([routeSettings.get().ro1Id], `График на ${SCHEDULE_HALF_LABEL[half]} ${year} года возвращён на доработку (${nameOf(u.id)}): «${input.comment.trim()}»`, "/hr/dashboard", "decision");
    return r.after;
  });
  revalidatePath("/", "layout");
  return res;
}

/* ---------------- уведомления текущего пользователя ---------------- */

export async function getMyNotifications(limit = 30) {
  const u = await currentUser();
  return { items: notifications.forEmployee(u.id, limit), unread: notifications.unreadCount(u.id) };
}

export async function markNotificationRead(id: number) {
  const u = await currentUser();
  notifications.markRead(id, u.id);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const u = await currentUser();
  notifications.markAllRead(u.id);
  revalidatePath("/", "layout");
}

/** HR и руководители видят, кому что ушло, — служебный помощник для экранов (без записи). */
export async function canSeeSchedule() {
  const u = await currentUser();
  return can(u, "hr") || u.id === routeSettings.get().scheduleApproverId;
}
