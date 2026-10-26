"use server";

/**
 * Изменение согласованного отпуска (Решения.md, «Изменение согласованного отпуска»).
 * Сотрудник: requestChange / withdrawChange. Руководитель: managerApproveChange / returnChange.
 * HR: approveChange (даты части меняются) / rejectChange / returnChange, оформить продление и отзыв.
 * Проверку новых дат (загрузка группы со старыми и новыми датами, R14) делает движок — экраны зовут его сами.
 *
 * События журнала (entity, entityId — id заявки или части):
 *   change_request   change  after: PartChange                                  — сотрудник подал заявку
 *   change_withdraw  change  before/after: PartChange                           — сотрудник отозвал
 *   change_manager   change  before/after: PartChange (stage manager → hr)      — руководитель пропустил к HR
 *   change_return    change  before/after: PartChange (status returned)        — вернули на доработку
 *   change_reject    change  before/after: PartChange (status rejected)        — HR отказал, часть как была
 *   change_approve   change  before/after: PartChange (status approved)        — HR согласовал
 *   part_reschedule  part    before/after: RequestPart + after.changeId, basis — даты части «было → стало»
 *   part_extend      part    before/after: RequestPart + after.changeId, basis — продление (ст. 171)
 *   part_recall      part    before/after: RequestPart + after.changeId, basis, consent — отзыв (ст. 174)
 */
import { revalidatePath } from "next/cache";
import { changes, employees, parts, requests } from "../db/repo";
import { transaction } from "../db/client";
import { CHANGE_REASON_LABEL, type ChangeKind, type ChangeReason, type PartChange } from "../db/types";
import { logAudit } from "../audit";
import { notify } from "../notify";
import { shortName } from "../approvals";
import { routeSettings } from "../db/repo";
import { AccessDenied, can, currentUser, requireAccess } from "../session";
import { todayIso } from "@/domain/config";

const who = (id: string) => shortName(employees.get(id)?.fullName ?? id);
const KIND_TEXT: Record<string, string> = { move: "перенос", shorten: "сокращение", cancel: "отказ от части" };
const dates = (c: PartChange) => c.kind === "cancel" ? `${fmt(c.oldStart)}–${fmt(c.oldEnd)}` : `${fmt(c.oldStart)}–${fmt(c.oldEnd)} → ${fmt(c.newStart!)}–${fmt(c.newEnd!)}`;
const fmt = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7);
/** Кто решает на шаге HR: РО1, а для отпуска самого РО1 — проверяющий из маршрута. */
const hrDecider = (employeeId: string) => { const r = routeSettings.get(); return employeeId === r.ro1Id ? r.ro1ReviewerId : r.ro1Id; };

const refresh = () => { revalidatePath("/me"); revalidatePath("/team"); revalidatePath("/hr"); revalidatePath("/hr/log"); };

function ownerOf(partId: number) {
  const p = parts.get(partId);
  if (!p) throw new Error(`Нет части ${partId}`);
  const req = requests.get(p.requestId);
  if (!req) throw new Error(`Нет заявки части ${partId}`);
  return { part: p, employee: employees.get(req.employeeId)! };
}

/** Заявки по частям года и все открытые (в т. ч. по отпуску текущего года) — для экранов. */
export async function getChanges(year: number) {
  const u = await currentUser();
  const all = [...new Map([...changes.forYear(year), ...changes.open()].map((c) => [c.id, c])).values()];
  if (can(u, "hr")) return all;
  const team = new Set(employees.reports(u.id).map((e) => e.id));
  return all.filter((c) => c.employeeId === u.id || team.has(c.employeeId));
}

/** Сотрудник просит перенести, сократить или отменить свою согласованную часть, которая ещё не началась. */
export async function requestChange(input: { partId: number; kind: Extract<ChangeKind, "move" | "shorten" | "cancel">; newStart?: string | null; newEnd?: string | null; note: string }) {
  const u = await currentUser();
  const { part, employee } = ownerOf(input.partId);
  if (employee.id !== u.id) throw new AccessDenied();
  if (part.status !== "approved") throw new Error("Заявка на перенос — только для согласованной части; черновик меняйте в плане");
  if (part.startDate <= todayIso()) throw new Error("Отпуск уже начался или прошёл — изменить его может только отдел кадров");
  if (!input.note?.trim()) throw new Error("Укажите причину");
  if (input.kind !== "cancel") {
    if (!input.newStart || !input.newEnd || input.newEnd < input.newStart) throw new Error("Укажите новые даты");
    if (input.kind === "shorten" && (input.newStart < part.startDate || input.newEnd > part.endDate)) throw new Error("Сокращённая часть должна лежать внутри прежних дат");
  }
  const c = transaction(() => {
    const c = changes.create({
      partId: part.id, kind: input.kind, newStart: input.newStart ?? null, newEnd: input.newEnd ?? null, note: input.note,
      requestedBy: u.id, requestedOn: todayIso(), stage: employee.managerId ? "manager" : "hr",
    });
    logAudit({ actorId: u.id, action: "change_request", entity: "change", entityId: c.id, after: c });
    notify([c.stage === "manager" ? employee.managerId : hrDecider(employee.id)],
      `Заявка на ${KIND_TEXT[c.kind]}: ${who(employee.id)}, ${dates(c)}`, c.stage === "manager" ? "/team" : "/hr", "request");
    return c;
  });
  refresh();
  return c;
}

export async function withdrawChange(id: number) {
  const u = await currentUser();
  const c = changes.get(id);
  if (!c) throw new Error(`Нет заявки ${id}`);
  if (c.employeeId !== u.id) throw new AccessDenied();
  if (c.status !== "open" && c.status !== "returned") throw new Error("Заявку уже решили");
  const res = transaction(() => {
    const r = changes.withdraw(id);
    logAudit({ actorId: u.id, action: "change_withdraw", entity: "change", entityId: id, before: r.before, after: r.after });
    return r.after;
  });
  refresh();
  return res;
}

function canDecide(u: Awaited<ReturnType<typeof currentUser>>, c: PartChange) {
  if (c.status !== "open") throw new Error("Заявка не ждёт решения");
  if (c.stage === "hr") { if (!can(u, "hr")) throw new AccessDenied(); return; }
  const boss = employees.get(c.employeeId)?.managerId;
  if (u.id !== boss && !can(u, "hr")) throw new AccessDenied();
}

/** Руководитель согласен — заявка уходит к HR. */
export async function managerApproveChange(id: number, note?: string) {
  const u = await currentUser();
  const c = changes.get(id);
  if (!c) throw new Error(`Нет заявки ${id}`);
  canDecide(u, c);
  if (c.stage !== "manager") throw new Error("Заявка уже у HR");
  const res = transaction(() => {
    const r = changes.managerApprove(id, u.id, note);
    logAudit({ actorId: u.id, action: "change_manager", entity: "change", entityId: id, before: r.before, after: r.after });
    notify([hrDecider(c.employeeId)], `Заявка на ${KIND_TEXT[c.kind]} ждёт решения HR: ${who(c.employeeId)}, ${dates(c)} (руководитель согласен)`, "/hr", "request");
    notify([c.employeeId], `Руководитель согласовал вашу заявку на ${KIND_TEXT[c.kind]} (${dates(c)}), решение — за отделом кадров`, "/me", "decision");
    return r.after;
  });
  refresh();
  return res;
}

/** Вернуть сотруднику на доработку (руководитель на своём шаге или HR). Старые даты остаются. */
export async function returnChange(id: number, note: string) {
  const u = await currentUser();
  const c = changes.get(id);
  if (!c) throw new Error(`Нет заявки ${id}`);
  canDecide(u, c);
  if (!note?.trim()) throw new Error("Напишите, что поправить");
  const res = transaction(() => {
    const r = changes.returnBack(id, u.id, note);
    logAudit({ actorId: u.id, action: "change_return", entity: "change", entityId: id, before: r.before, after: r.after });
    notify([c.employeeId], `Заявка на ${KIND_TEXT[c.kind]} (${dates(c)}) возвращена (${who(u.id)}): «${note.trim()}»`, "/me", "decision");
    return r.after;
  });
  refresh();
  return res;
}

/** HR отказывает: часть остаётся с прежними датами. */
export async function rejectChange(id: number, note: string) {
  const u = await requireAccess("hr");
  const c = changes.get(id);
  if (!c || c.status !== "open") throw new Error("Заявка не ждёт решения");
  if (!note?.trim()) throw new Error("Укажите основание отказа");
  const res = transaction(() => {
    const r = changes.reject(id, u.id, note);
    logAudit({ actorId: u.id, action: "change_reject", entity: "change", entityId: id, before: r.before, after: r.after });
    notify([c.employeeId], `В заявке на ${KIND_TEXT[c.kind]} (${dates(c)}) отказано: «${note.trim()}». Отпуск остаётся в прежние даты`, "/me", "decision");
    return r.after;
  });
  refresh();
  return res;
}

/**
 * HR согласует окончательно: даты части меняются (или часть отменяется). Заявка позже чем за 14 дней
 * (R14) проходит только с обоснованием исключения — его кладите в note.
 */
export async function approveChange(id: number, note?: string) {
  const u = await requireAccess("hr");
  const c = changes.get(id);
  if (!c || c.status !== "open") throw new Error("Заявка не ждёт решения");
  const res = transaction(() => {
    const r = changes.approve(id, u.id, note);
    logAudit({ actorId: u.id, action: "change_approve", entity: "change", entityId: id, before: r.before, after: r.after });
    notify([c.employeeId, employees.get(c.employeeId)?.managerId], c.kind === "cancel"
      ? `Отказ от части ${dates(c)} согласован (${who(c.employeeId)})` : `Перенос согласован: ${who(c.employeeId)}, ${dates(c)}`, "/me", "decision");
    logAudit({ actorId: u.id, action: "part_reschedule", entity: "part", entityId: c.partId, before: r.part.before,
      after: { ...r.part.after, changeId: id, basis: `заявка на ${c.kind === "cancel" ? "отказ от части" : c.kind === "shorten" ? "сокращение" : "перенос"}${note ? `; ${note}` : ""}` } });
    return r.after;
  });
  refresh();
  return res;
}

/** HR продлевает часть по ст. 171 (больничный и др.): newEnd — новый последний день отпуска. */
export async function extendPart(input: { partId: number; newEnd: string; reason?: ChangeReason; note: string }) {
  const u = await requireAccess("hr");
  if (!input.note?.trim()) throw new Error("Укажите основание (например, номер листка нетрудоспособности)");
  const reason = input.reason ?? "illness";
  const res = transaction(() => {
    const r = parts.extend(input.partId, input.newEnd, { by: u.id, on: todayIso(), note: input.note, reason });
    notify([r.change.employeeId], `Отпуск продлён до ${fmt(input.newEnd)} (ст. 171 ТК): ${input.note.trim()}`, "/me", "decision");
    logAudit({ actorId: u.id, action: "part_extend", entity: "part", entityId: input.partId, before: r.part.before,
      after: { ...r.part.after, changeId: r.change.id, basis: `ст. 171 ТК, ${CHANGE_REASON_LABEL[reason]}; ${input.note}` } });
    return r;
  });
  refresh();
  return res;
}

/** HR отзывает из отпуска по ст. 174 — только с согласия работника. returnDate — день выхода на работу. */
export async function recallPart(input: { partId: number; returnDate: string; consent: boolean; note: string }) {
  const u = await requireAccess("hr");
  if (!input.consent) throw new Error("Отзыв из отпуска — только с согласия работника (ст. 174 ТК)");
  if (!input.note?.trim()) throw new Error("Укажите основание отзыва");
  const res = transaction(() => {
    const r = parts.recall(input.partId, input.returnDate, { by: u.id, on: todayIso(), note: input.note });
    notify([r.change.employeeId], `Отзыв из отпуска оформлен: выход на работу ${fmt(input.returnDate)} (ст. 174 ТК). Неиспользованные дни вернулись в остаток`, "/me", "decision");
    logAudit({ actorId: u.id, action: "part_recall", entity: "part", entityId: input.partId, before: r.part.before,
      after: { ...r.part.after, changeId: r.change.id, basis: `ст. 174 ТК; ${input.note}`, consent: true } });
    return r;
  });
  refresh();
  return res;
}
