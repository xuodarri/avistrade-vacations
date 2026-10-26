"use server";

/**
 * Очередь руководителя (`/team`): заявки прямых подчинённых. Маршрут по регламенту —
 * сотрудник → непосредственный руководитель → HR. Согласие руководителя пишется в журнал
 * (`manager_approve`), часть остаётся «На согласовании» до решения HR; «Вернуть» — сразу сотруднику.
 */
import { revalidatePath } from "next/cache";
import { changes, employees, holidays, parts, requests, routeSettings, rules } from "../db/repo";
import { transaction } from "../db/client";
import { OCCUPYING, type Employee as DbEmployee } from "../db/types";
import { logAudit } from "../audit";
import { AccessDenied, can, currentUser } from "../session";
import { MANAGER_APPROVE, MANAGER_UNDO, changeView, checkInContext, hrDeciderFor, engineContext, exceptionNoteOf, isExceptionRequest, leaveKind, managerApprovals, openChanges, routeStage, shortName, substituteIdOf, substituteInfo, syncRequestStatus } from "../approvals";
import { PLAN_YEAR } from "@/lib/config";
import { addDays, fmtRange } from "@/lib/dates";
import { notify } from "../notify";
import { dbRuleCode } from "@/domain/fromDb";
import type { BarTone, BoardChange, BoardFinding, Decision, LeaveKind, RouteStage, SubstituteInfo, UndoToken } from "@/components/gantt/types";

export interface LanePart { start: string; end: string; tone: BarTone; days: number }
export interface LaneRow { employeeId: string; name: string; fullName: string; role: string; me: boolean; parts: LanePart[] }

export interface QueueItem {
  partId: number;
  partNo: number;
  start: string;
  end: string;
  days: number;
  stage: RouteStage;
  verdict: "ok" | "warn" | "block";
  findings: BoardFinding[];
  /** Окно мини-ленты: часть ± неделя */
  from: string;
  to: string;
  /** Кто из команды отсутствует в эти даты (пересекается с частью) */
  overlaps: { name: string; start: string; end: string; tone: BarTone }[];
  /** Замещающий; null — не указан */
  substitute: SubstituteInfo | null;
  /** Вид отпуска и причина */
  kind: LeaveKind;
  /** Запрос исключения: нарушение регламента, решает HR */
  exceptionRequest: boolean;
  /** Открытая заявка на перенос, сокращение или отказ по этой части */
  change: BoardChange | null;
}

export interface QueuePerson {
  employeeId: string;
  fullName: string;
  name: string;
  position: string;
  department: string | null;
  submittedAt: string | null;
  requestStatus: string | null;
  /** Обоснование сотрудника к запросу исключения */
  exceptionNote: string | null;
  items: QueueItem[];
}

async function requireManager() {
  const u = await currentUser();
  if (!can(u, "manager")) throw new AccessDenied("Раздел для руководителей");
  return u;
}

/** Очередь: прямые подчинённые и их части по шагам маршрута плюс лента команды. */
export async function getManagerQueue(year = PLAN_YEAR) {
  const u = await requireManager();
  const team = employees.reports(u.id);
  const ctx = engineContext(year);
  const approvals = managerApprovals();
  const source = new Map(rules.list().map((r) => [r.code, r.source]));
  const names = new Map(employees.list().map((e) => [e.id, e.fullName]));
  const short = (id: string) => shortName(names.get(id) ?? id);
  const all = parts.forYear(year);
  const byId = new Map(employees.list().map((e) => [e.id, e]));

  // лента: руководитель и прямые подчинённые со всеми частями года
  const laneIds = [u.id, ...team.map((e) => e.id)];
  const toneOf = (status: string, st?: "ok" | "warn" | "block"): BarTone =>
    status === "draft" ? "draft" : status === "returned" || status === "rejected" ? "returned"
      : status === "approved" ? (st === "warn" ? "warn" : "approved") : st === "block" ? "block" : st === "warn" ? "warn" : "pending";
  const partTone = new Map<number, BarTone>();
  for (const id of laneIds) {
    const res = checkInContext(ctx, id);
    for (const p of all.filter((x) => x.employeeId === id)) partTone.set(p.id, toneOf(p.status, res?.parts.find((s) => s.partId === String(p.id))?.status));
  }
  const lane: LaneRow[] = laneIds.map((id) => ({
    employeeId: id, name: id === u.id ? "Вы" : short(id), fullName: names.get(id) ?? id, role: employees.get(id)?.roleCode ?? "", me: id === u.id,
    parts: all.filter((p) => p.employeeId === id).map((p) => ({ start: p.startDate, end: p.endDate, tone: partTone.get(p.id) ?? "pending", days: p.days })),
  }));

  const openCh = openChanges();
  const buildPerson = (e: DbEmployee): QueuePerson => {
    const req = requests.forEmployee(e.id, year);
    const list = req ? parts.forRequest(req.id) : [];
    const res = checkInContext(ctx, e.id);
    const results = (res?.results ?? []).filter((r) => r.status !== "off");
    const items = list.map((p): QueueItem => {
      const rel = results.filter((r) => r.partIds.length === 0 || r.partIds.includes(String(p.id)));
      const from = addDays(p.startDate, -7), to = addDays(p.endDate, 7);
      return {
        partId: p.id, partNo: p.partNo, start: p.startDate, end: p.endDate, days: p.days, substitute: substituteInfo(p, byId, all), kind: leaveKind(p),
        exceptionRequest: isExceptionRequest(p, res),
        change: openCh.has(p.id) ? changeView(openCh.get(p.id)!, short, (code) => source.get(code) ?? "ТК") : null,
        stage: routeStage(p, req, e.managerId, approvals),
        verdict: res?.parts.find((s) => s.partId === String(p.id))?.status ?? "ok",
        findings: rel.map((r): BoardFinding => {
          const code = dbRuleCode(r.code);
          return {
            ruleCode: code, title: r.title, level: r.status as BoardFinding["level"], message: r.message, basis: r.basis,
            source: source.get(code) ?? "ТК", partIds: r.partIds.map(Number), dates: r.dates, people: r.employeeIds.map(short),
            ...(r.exception ? { exceptionReason: r.exception.reason } : {}), actionable: OCCUPYING.includes(p.status),
            ...(r.consequence ? { consequence: r.consequence } : {}),
          };
        }),
        from, to,
        overlaps: all.filter((o) => o.employeeId !== e.id && laneIds.includes(o.employeeId) && OCCUPYING.includes(o.status)
          && o.startDate <= p.endDate && o.endDate >= p.startDate)
          .map((o) => ({ name: o.employeeId === u.id ? "Вы" : short(o.employeeId), start: o.startDate > p.startDate ? o.startDate : p.startDate,
            end: o.endDate < p.endDate ? o.endDate : p.endDate, tone: partTone.get(o.id) ?? "pending" })),
      };
    });
    return {
      employeeId: e.id, fullName: e.fullName, name: shortName(e.fullName), position: e.position, department: e.department,
      submittedAt: req?.submittedAt ?? null, requestStatus: req?.status ?? null, exceptionNote: exceptionNoteOf(req), items,
    };
  };
  const people: QueuePerson[] = team.map(buildPerson);
  // проверяющий за РО1: заявки самого РО1, дошедшие до шага HR, решает он вместо отдела кадров
  const route = routeSettings.get();
  const ro1 = route.ro1ReviewerId === u.id ? employees.get(route.ro1Id) : null;
  const review: QueuePerson[] = ro1 ? [buildPerson(ro1)].map((p) => ({ ...p, items: p.items.filter((i) => (i.change ? i.change.stage === "hr" : i.stage === "hr")) }))
    .filter((p) => p.items.length) : [];
  const decider = hrDeciderFor(team[0]?.id ?? u.id);

  return {
    manager: { id: u.id, name: u.fullName, position: u.position }, year, people, lane, review,
    /** Кто решает после руководителя: РО1 */
    hrName: short(decider.asReviewer ? route.ro1Id : decider.id),
    holidays: holidays.list(year).filter((h) => h.nonWorking).map((h) => h.date),
  };
}

/** Часть подчинённого: только прямой руководитель, только «На согласовании». */
async function partForManager(partId: number) {
  const u = await requireManager();
  const part = parts.get(partId);
  if (!part) throw new Error(`Нет части ${partId}`);
  const req = requests.list(PLAN_YEAR).find((r) => r.id === part.requestId);
  const owner = req ? employees.get(req.employeeId) : null;
  if (!req || !owner || owner.managerId !== u.id) throw new AccessDenied("Решает непосредственный руководитель");
  return { u, part, req };
}

function revalidateScreens() {
  revalidatePath("/team");
  revalidatePath("/hr");
  revalidatePath("/me");
}

const short = (id: string) => shortName(employees.get(id)?.fullName ?? id);

/** Согласие руководителя: сотруднику — что заявка ушла дальше, решающему на шаге HR — что она ждёт его. */
function toHr(managerId: string, employeeId: string, what: string) {
  const d = hrDeciderFor(employeeId);
  notify([employeeId], `${what[0].toUpperCase()}${what.slice(1)}: согласовано руководителем (${short(managerId)}), решение за ${d.asReviewer ? "проверяющим за РО1" : "РО1"} ${short(d.id)}`, "/me", "decision");
  notify([d.id], `Ждёт решения: ${short(employeeId)}, ${what}`, d.asReviewer ? "/team" : "/hr", "request");
}

/** Открытые запреты и предупреждения по части — с ними массово не согласуем. */
function hasOpenConflict(employeeId: string, partId: number) {
  const res = checkInContext(engineContext(PLAN_YEAR), employeeId);
  return (res?.results ?? []).some((r) => (r.status === "block" || r.status === "warn") && (r.partIds.length === 0 || r.partIds.includes(String(partId))));
}

/** Руководитель согласовал: заявка уходит к HR (РО1 по регламенту — специалист HR в прототипе). */
export async function managerApprove(partId: number, comment = ""): Promise<Decision> {
  const { u, part, req } = await partForManager(partId);
  if (part.status !== "pending") return { ok: false, error: "Часть уже не на согласовании." };
  transaction(() => {
    logAudit({ actorId: u.id, action: MANAGER_APPROVE, entity: "part", entityId: partId, before: { status: part.status, stage: "manager" },
      after: { status: part.status, stage: "hr", ...(comment.trim() ? { comment: comment.trim() } : {}) } });
    toHr(u.id, req.employeeId, fmtRange(part.startDate, part.endDate));
  });
  revalidateScreens();
  return { ok: true, undo: { partId, expect: "pending", partStatus: "pending", requestId: req.id, requestStatus: req.status, exceptionIds: [], managerApprove: true } };
}

/** «Согласовать все без конфликтов»: только части у руководителя, где движок не нашёл запретов и предупреждений. */
export async function managerApproveClean(partIds: number[]): Promise<{ ok: true; undo: UndoToken[] } | { ok: false; error: string }> {
  const u = await requireManager();
  const approvals = managerApprovals();
  const picked = partIds.slice(0, 200).map((id) => {
    const part = parts.get(id);
    const req = part ? requests.list(PLAN_YEAR).find((r) => r.id === part.requestId) : undefined;
    const owner = req ? employees.get(req.employeeId) : null;
    return part && req && owner && owner.managerId === u.id && routeStage(part, req, owner.managerId, approvals) === "manager"
      && !hasOpenConflict(owner.id, part.id) ? { part, req } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (!picked.length) return { ok: false, error: "Нечего согласовывать: у оставшихся заявок есть конфликты." };
  transaction(() => {
    for (const { part, req } of picked) {
      logAudit({ actorId: u.id, action: MANAGER_APPROVE, entity: "part", entityId: part.id, before: { status: part.status, stage: "manager" }, after: { status: part.status, stage: "hr", bulk: true } });
      toHr(u.id, req.employeeId, fmtRange(part.startDate, part.endDate));
    }
  });
  revalidateScreens();
  return { ok: true, undo: picked.map(({ part, req }) => ({ partId: part.id, expect: "pending" as const, partStatus: "pending" as const, requestId: req.id, requestStatus: req.status, exceptionIds: [], managerApprove: true })) };
}

/** Руководитель вернул часть сотруднику с комментарием. */
/**
 * Руководитель вернул часть сотруднику с комментарием. Можно предложить другого замещающего:
 * это предложение (в журнале after.substituteId), заявку меняет сам сотрудник.
 */
export async function managerReturn(partId: number, comment: string, substituteId?: string | null): Promise<Decision> {
  const text = comment.trim();
  if (text.length < 5) return { ok: false, error: "Напишите сотруднику, что поменять." };
  const { u, part, req } = await partForManager(partId);
  if (part.status !== "pending") return { ok: false, error: "Часть уже не на согласовании." };
  const proposed = substituteId ? employees.get(substituteId) : null;
  if (substituteId && (!proposed || proposed.id === req.employeeId)) return { ok: false, error: "Такого замещающего предложить нельзя." };
  transaction(() => {
    parts.setStatus(partId, "returned");
    logAudit({ actorId: u.id, action: "return", entity: "part", entityId: partId, before: { status: part.status, substituteId: substituteIdOf(part) },
      after: { status: "returned", by: "manager", comment: text, ...(proposed ? { substituteId: proposed.id, substituteName: proposed.fullName } : {}) } });
    notify([req.employeeId], `Часть ${fmtRange(part.startDate, part.endDate)} возвращена руководителем (${short(u.id)}): «${text}»${proposed ? `. Предложен замещающий: ${short(proposed.id)}` : ""}`, "/me", "decision");
    syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true, undo: { partId, expect: "returned", partStatus: part.status, requestId: req.id, requestStatus: req.status, exceptionIds: [] } };
}

/** «Отменить» в уведомлении: снять своё согласие (запись manager_undo) или вернуть часть на согласование. */
export async function managerUndo(tokens: UndoToken[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await requireManager();
  const checked = await Promise.all(tokens.slice(0, 200).map(async (t) => ({ t, ...(await partForManager(t.partId)) })));
  if (checked.some(({ t, part, req }) => part.status !== t.expect || req.id !== t.requestId)) return { ok: false, error: "Заявку уже изменили — отменить нельзя." };
  transaction(() => {
    for (const { t, part, req } of checked) {
      if (t.managerApprove) {
        logAudit({ actorId: u.id, action: MANAGER_UNDO, entity: "part", entityId: part.id, before: { stage: "hr" }, after: { stage: "manager" } });
      } else {
        parts.setStatus(part.id, t.partStatus);
        requests.restoreStatus(req.id, t.requestStatus);
        logAudit({ actorId: u.id, action: "undo", entity: "part", entityId: part.id, before: { status: part.status }, after: { status: t.partStatus } });
      }
    }
  });
  revalidateScreens();
  return { ok: true };
}

/* ---------------- заявки на перенос, сокращение, отказ ---------------- */

/** Открытая заявка подчинённого на шаге руководителя. */
async function changeForManager(changeId: number) {
  const u = await requireManager();
  const c = changes.get(changeId);
  const owner = c ? employees.get(c.employeeId) : null;
  if (!c || !owner || owner.managerId !== u.id) throw new AccessDenied("Решает непосредственный руководитель");
  if (c.status !== "open" || c.stage !== "manager") throw new Error("Заявка уже не ждёт вашего решения");
  return { u, c };
}

/** Руководитель согласовал перенос со своей стороны: заявка уходит к HR. */
export async function managerApproveChange(changeId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { u, c } = await changeForManager(changeId);
  transaction(() => {
    changes.managerApprove(changeId, u.id);
    logAudit({ actorId: u.id, action: MANAGER_APPROVE, entity: "change", entityId: changeId, before: { stage: "manager" }, after: { stage: "hr", kind: c.kind } });
    toHr(u.id, c.employeeId, `изменение ${fmtRange(c.oldStart, c.oldEnd)}`);
  });
  revalidateScreens();
  return { ok: true };
}

/** Руководитель вернул заявку на перенос сотруднику с комментарием. */
export async function managerReturnChange(changeId: number, comment: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = comment.trim();
  if (text.length < 5) return { ok: false, error: "Напишите сотруднику, что поменять." };
  const { u, c } = await changeForManager(changeId);
  transaction(() => {
    changes.returnBack(changeId, u.id, text);
    notify([c.employeeId], `Заявка на изменение части ${fmtRange(c.oldStart, c.oldEnd)} возвращена руководителем (${short(u.id)}): «${text}»`, "/me", "decision");
    logAudit({ actorId: u.id, action: "return", entity: "change", entityId: changeId, before: { status: "open" }, after: { status: "returned", by: "manager", comment: text } });
  });
  revalidateScreens();
  return { ok: true };
}
