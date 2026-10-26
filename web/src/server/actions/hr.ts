"use server";

/** Серверные функции экранов HR: Гант, правила, исключения, журнал, сбор графика. */
import { revalidatePath } from "next/cache";
import { audit, changes, employees, exceptions, holidays, parts, requests, roles, routeSettings, rules, schedules } from "../db/repo";
import { transaction } from "../db/client";
import { OCCUPYING, SCHEDULE_HALF_LABEL, SCHEDULE_STATUS_LABEL, type Employee as DbEmployee, type ExceptionDecision, type PartStatus, type RequestPart, type Rule, type VacationRequest } from "../db/types";
import { logAudit } from "../audit";
import { AccessDenied, can, currentUser, requireAccess } from "../session";
import { checkPlan, recall, sicknessExtension } from "../engine";
import { changeView, checkInContext, hrDeciderFor, engineContext, exceptionNoteOf, isExceptionRequest, leaveKind, managerApprovals, openChanges, routeStage, shortName, substituteInfo, syncRequestStatus } from "../approvals";
import { PLAN_YEAR } from "@/lib/config";
import { addDays, fmtDate, fmtRange, toUtc } from "@/lib/dates";
import { notify } from "../notify";
import { findWindows, groupOf, teamConflicts, type CheckResult, type RuleResult } from "@/domain";
import { dbRuleCode } from "@/domain/fromDb";
import type {
  BarTone, BoardEmployee, BoardFinding, BoardPart, BoardSubgroup, BoardTier, Decision, FreeWindow, GanttBoardData, LoadLevel, LoadRow, Range, UndoToken,
} from "@/components/gantt/types";

/** Данные для Ганта: люди с иерархией, все части года, праздники, группы и зависимости. */
export async function getGanttData(year = PLAN_YEAR) {
  await requireAccess("hr");
  return {
    year,
    employees: employees.list(),
    parts: parts.forYear(year),
    holidays: holidays.list(year),
    groups: roles.groups(),
    roles: roles.list(),
    dependencies: roles.dependencies(),
    exceptions: exceptions.list(),
  };
}

export async function getRules() {
  await requireAccess("hr");
  return { rules: rules.list(), groups: roles.groups(), dependencies: roles.dependencies(), roles: roles.list() };
}

/** Изменить правило (параметр N, включено, жёсткость, основание). */
export async function updateRule(code: string, patch: Partial<Pick<Rule, "title" | "params" | "enabled" | "severity" | "basis" | "howChecked">>) {
  const u = await requireAccess("hr");
  const res = transaction(() => {
    const { before, after } = rules.update(code, patch);
    logAudit({ actorId: u.id, action: "update", entity: "rule", entityId: code, before, after });
    return after;
  });
  revalidatePath("/hr/rules");
  return res;
}

/** Исключение HR из правила регламента (правила ТК исключением не снимаются). */
export async function addException(input: { employeeId: string; partId: number | null; ruleCode: string; decision: ExceptionDecision; reason: string }) {
  const u = await requireAccess("hr");
  const rule = rules.get(input.ruleCode);
  if (!rule) throw new Error(`Нет правила ${input.ruleCode}`);
  if (rule.source === "ТК") throw new Error("Правило ТК исключением снять нельзя");
  if (!input.reason.trim()) throw new Error("Нужно обоснование");
  const id = transaction(() => {
    const id = exceptions.add({ ...input, createdBy: u.id });
    logAudit({ actorId: u.id, action: "exception", entity: "exception", entityId: id, after: input });
    return id;
  });
  revalidatePath("/hr");
  return id;
}

/** Журнал изменений с фильтрами. */
export async function getAuditLog(opts: { limit?: number; entity?: string; actorId?: string } = {}) {
  await requireAccess("hr");
  const names = new Map(employees.list().map((e) => [e.id, e.fullName]));
  return audit.list(opts).map((a) => ({ ...a, actorName: a.actorId ? names.get(a.actorId) ?? a.actorId : "система" }));
}

/** Сбор графика: кто подал план, кто нет, сколько с конфликтами. */
export async function getCollectionStatus(year = PLAN_YEAR) {
  await requireAccess("hr");
  const reqs = new Map(requests.list(year).map((r) => [r.employeeId, r]));
  const rows = employees.list().map((e) => {
    const req = reqs.get(e.id) ?? null;
    const list = req ? parts.forRequest(req.id) : [];
    return { employee: e, request: req, parts: list, days: list.reduce((s, p) => s + p.days, 0), check: checkPlan(e.id, list) };
  });
  const by = (s: string | null) => rows.filter((r) => (r.request?.status ?? null) === s).length;
  return {
    year, rows,
    totals: { employees: rows.length, none: by(null), draft: by("draft"), submitted: by("submitted"), approved: by("approved"), returned: by("returned") },
  };
}

/* ---------------- Гант HR и решения по заявкам ---------------- */

const DAY = 86_400_000;
const TIERS: { key: string; title: string; roles: string[] }[] = [
  { key: "lead", title: "Руководство", roles: ["ИД", "ЗАВ", "ЗТВ"] },
  { key: "ro", title: "Руководители отделений", roles: ["РО"] },
  { key: "no", title: "Начальники отделов", roles: ["НО"] },
  { key: "ms", title: "Менеджеры секций", roles: ["МС"] },
  { key: "mpp", title: "Менеджеры по продажам", roles: ["МПП"] },
  { key: "sp", title: "Специалисты", roles: [] },
];

const isOpen = (r: { status: string }) => r.status === "block" || r.status === "warn";
/** Результат относится к части: её собственный или на весь план (partIds пуст). */
const touches = (r: RuleResult, partId: number) => r.partIds.length === 0 || r.partIds.includes(String(partId));

/** Гант HR целиком: строки по иерархии, полосы с итогом проверки, загрузка групп, окна для возврата. */
export async function getGanttBoard(year = PLAN_YEAR): Promise<GanttBoardData> {
  const viewer = await currentUser();
  if (!can(viewer, "hr") && viewer.id !== routeSettings.get().scheduleApproverId) throw new AccessDenied();
  return buildBoard(year, viewer.id);
}

/** Гант для директора: только чтение, пока график на утверждении или после. */
export async function getApproverBoard(year = PLAN_YEAR): Promise<GanttBoardData> {
  const viewer = await currentUser();
  if (viewer.id !== routeSettings.get().scheduleApproverId && !can(viewer, "hr")) throw new AccessDenied("График открывает утверждающий");
  return buildBoard(year, viewer.id);
}

function buildBoard(year: number, viewerId: string): GanttBoardData {
  const ctx = engineContext(year);
  const emps = employees.list();
  const byId = new Map(emps.map((e) => [e.id, e]));
  const short = (id: string) => shortName(byId.get(id)?.fullName ?? id);
  const ruleSource = new Map(rules.list().map((r) => [r.code, r.source]));
  const reqs = new Map(requests.list(year).map((r) => [r.employeeId, r]));
  const approvals = managerApprovals();
  const all = parts.forYear(year);
  const y0 = toUtc(`${year}-01-01`);
  const nDays = (toUtc(`${year + 1}-01-01`) - y0) / DAY;
  const idx = (iso: string) => Math.round((toUtc(iso) - y0) / DAY);
  const holidayList = holidays.list(year).filter((h) => h.nonWorking);
  const holidaySet = new Set(holidayList.map((h) => h.date));

  const live = new Set(all.filter((p) => OCCUPYING.includes(p.status)).map((p) => String(p.id)));
  const results = new Map<string, RuleResult[]>();
  const checks = new Map<string, CheckResult | null>();
  const boardEmployees: Record<string, BoardEmployee> = {};
  for (const e of emps) {
    const res = checkInContext(ctx, e.id);
    checks.set(e.id, res);
    const mineLive = all.some((p) => p.employeeId === e.id && live.has(String(p.id)));
    const actionable = (r: RuleResult) => (r.partIds.length ? r.partIds.some((id) => live.has(id)) : mineLive);
    const list = (res?.results ?? []).filter((r) => r.status !== "off");
    results.set(e.id, list);
    const req = reqs.get(e.id) ?? null;
    boardEmployees[e.id] = {
      id: e.id, name: shortName(e.fullName), fullName: e.fullName, position: e.position, role: e.roleCode,
      division: e.division, department: e.department, managerName: e.managerId ? short(e.managerId) : null,
      benefit: e.benefit, requestStatus: req?.status ?? null, submittedAt: req?.submittedAt ?? null,
      hrDecider: (() => { const d = hrDeciderFor(e.id); return { id: d.id, name: short(d.id), asReviewer: d.asReviewer }; })(),
      verdict: res ? res.status : null, exceptionNote: exceptionNoteOf(req), open: list.filter((r) => isOpen(r) && actionable(r)).length,
      totalDays: res?.totalDays ?? 0, normDays: e.baseDays + e.extraDays,
      findings: list.map((r): BoardFinding => {
        const code = dbRuleCode(r.code);
        return {
          ruleCode: code, title: r.title, level: r.status as BoardFinding["level"], message: r.message, basis: r.basis,
          source: ruleSource.get(code) ?? "ТК", partIds: r.partIds.map(Number).filter(Number.isFinite), dates: r.dates,
          people: r.employeeIds.map(short), ...(r.exception ? { exceptionReason: r.exception.reason } : {}), actionable: actionable(r),
          ...(r.consequence ? { consequence: r.consequence } : {}),
        };
      }),
    };
  }

  const openCh = openChanges();
  const sourceOf = (code: string) => ruleSource.get(code) ?? "ТК";
  const toBoardPart = (p: RequestPart & { employeeId: string }): BoardPart => {
    const e = byId.get(p.employeeId)!;
    const mine = (results.get(p.employeeId) ?? []).filter((r) => r.partIds.includes(String(p.id)));
    const tone: BarTone = p.status === "draft" ? "draft" : p.status === "returned" || p.status === "rejected" ? "returned"
      : mine.some((r) => r.status === "block") ? "block" : mine.some((r) => r.status === "warn") ? "warn"
      : mine.some((r) => r.status === "exception") ? "exception" : p.status === "approved" ? "approved" : "pending";
    const hot: Range[] = mine.filter((r) => isOpen(r) && (r.code === "groupLimit" || r.code === "roleDependencies")).flatMap((r) => r.dates)
      .map((d) => ({ start: d.start < p.startDate ? p.startDate : d.start, end: d.end > p.endDate ? p.endDate : d.end }))
      .filter((d, i, a) => d.start <= d.end && a.findIndex((x) => x.start === d.start && x.end === d.end) === i);
    const hol: string[] = [];
    for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1)) if (holidaySet.has(d)) hol.push(d);
    const a = approvals.get(p.id);
    const stage = routeStage(p, reqs.get(p.employeeId) ?? null, e.managerId, approvals);
    return {
      id: p.id, employeeId: p.employeeId, partNo: p.partNo, type: p.type, start: p.startDate, end: p.endDate, days: p.days,
      status: p.status, tone, stage, holidays: hol, hot, substitute: substituteInfo(p, byId, all), kind: leaveKind(p),
      exceptionRequest: isExceptionRequest(p, checks.get(p.employeeId) ?? null),
      change: openCh.has(p.id) ? changeView(openCh.get(p.id)!, short, sourceOf) : null,
      ...(a && stage !== "manager" ? { managerApproval: { by: short(a.actorId), at: a.at } } : {}),
    };
  };
  const boardParts: BoardPart[] = all.map(toBoardPart);
  // заявки на изменение частей другого года (например, текущего): на шкалу не попадают, но в очереди HR нужны
  for (const c of openCh.values()) {
    if (all.some((p) => p.id === c.partId)) continue;
    const p = parts.get(c.partId);
    if (p) boardParts.push(toBoardPart({ ...p, employeeId: c.employeeId }));
  }

  /* загрузка: сколько отсутствует по дням, где лимит превышен и где нет связанной роли */
  const loadRow = (key: string, title: string, hint: string, limit: number | null, memberIds: string[]): LoadRow => {
    const absent = new Array<number>(nDays).fill(0);
    const who = Array.from({ length: nDays }, () => [] as string[]);
    const mark = () => new Array<boolean>(nDays).fill(false);
    const openLimit = mark(), doneLimit = mark(), openChain = mark(), doneChain = mark();
    for (const p of all) {
      if (!memberIds.includes(p.employeeId) || !OCCUPYING.includes(p.status)) continue;
      for (let i = Math.max(0, idx(p.startDate)); i <= Math.min(nDays - 1, idx(p.endDate)); i++) {
        absent[i]++;
        who[i].push(short(p.employeeId));
      }
    }
    for (const id of memberIds) {
      for (const r of results.get(id) ?? []) {
        if (r.code !== "groupLimit" && r.code !== "roleDependencies") continue;
        if ((!isOpen(r) && r.status !== "exception") || !r.partIds.some((pid) => live.has(pid))) continue;
        const target = r.code === "groupLimit" ? (isOpen(r) ? openLimit : doneLimit) : (isOpen(r) ? openChain : doneChain);
        for (const d of r.dates) for (let i = Math.max(0, idx(d.start)); i <= Math.min(nDays - 1, idx(d.end)); i++) target[i] = true;
      }
    }
    const level = absent.map((n, i): LoadLevel => {
      if (!n) return 0;
      const over = limit !== null && n > limit;
      if (openLimit[i] || (over && !doneLimit[i])) return 4;
      if (over) return 5;
      if (openChain[i]) return 3;
      if (doneChain[i]) return 5;
      return limit !== null && n === limit ? 2 : 1;
    });
    return { key, title, hint, limit, memberIds, absent, level, who };
  };

  const order = (a: DbEmployee, b: DbEmployee) =>
    a.division.localeCompare(b.division, "ru") || (a.department ?? "").localeCompare(b.department ?? "", "ru") || a.id.localeCompare(b.id);
  const tierOf = (e: DbEmployee) => TIERS.find((t) => t.roles.includes(e.roleCode))?.key ?? "sp";
  const engineEmp = new Map(ctx.employees.map((e) => [e.id, e]));
  const tiers: BoardTier[] = TIERS.map((t): BoardTier => {
    const members = emps.filter((e) => tierOf(e) === t.key).sort(t.key === "lead" ? (a, b) => a.id.localeCompare(b.id) : order);
    if (!members.length) return { key: t.key, title: t.title, subgroups: [] };
    if (t.key === "sp") return { key: t.key, title: t.title, subgroups: [{ key: "sp", load: null, employeeIds: members.map((e) => e.id), dependencyIds: [] }] };
    if (t.key === "lead") {
      const ids = members.map((e) => e.id);
      return { key: t.key, title: t.title, subgroups: [{ key: "lead", employeeIds: ids, dependencyIds: [], load: loadRow("lead", "Отсутствуют", "ИД уходит, только если ЗАВ и ЗТВ на месте, заместители — если на месте ИД", null, ids) }] };
    }
    const subs = new Map<string, { ids: string[]; limit: number | null; deps: string[] }>();
    for (const e of members) {
      const g = groupOf(engineEmp.get(e.id)!, ctx.employees, ctx.roles);
      const cur = subs.get(g.key) ?? { ids: [], limit: g.limit, deps: [] };
      cur.ids.push(e.id);
      for (const d of g.dependencyIds) if (!cur.deps.includes(d)) cur.deps.push(d);
      subs.set(g.key, cur);
    }
    const subgroups = [...subs].map(([key, s]): BoardSubgroup => {
      const first = byId.get(s.ids[0])!;
      const scope = t.key === "ro" ? `Под ${first.managerId ? short(first.managerId) : "директором"}`
        : t.key === "no" ? first.division : `${first.division}, ${first.department ?? "без отдела"}`;
      const deps = s.deps.length ? `. На месте: ${s.deps.map(short).join(", ")}` : "";
      const show = s.limit !== null || s.deps.length > 0;
      return {
        key, employeeIds: s.ids, dependencyIds: s.deps,
        load: show ? loadRow(key, s.limit !== null ? `Отсутствуют, лимит ${s.limit}` : "Отсутствуют", `${scope}${deps}`, s.limit, s.ids) : null,
      };
    });
    return { key: t.key, title: t.title, subgroups };
  }).filter((t) => t.subgroups.length);

  /* окна для «вернуть с датами»: по частям с конфликтом лимита или связанной роли */
  const windows: Record<number, FreeWindow[]> = {};
  for (const p of boardParts) {
    if (!live.has(String(p.id))) continue;
    const res = (results.get(p.employeeId) ?? []).filter((r) => isOpen(r) && r.partIds.includes(String(p.id)));
    if (!res.some((r) => r.code === "groupLimit" || r.code === "roleDependencies")) continue;
    const e = engineEmp.get(p.employeeId), plan = ctx.plans.find((x) => x.employeeId === p.employeeId);
    if (!e || !plan) continue;
    windows[p.id] = findWindows(e, plan, String(p.id), ctx).map((w) => ({ start: w.start, end: w.end, days: w.days, shift: w.shift }));
  }

  const findings = Object.values(boardEmployees).flatMap((e) => e.findings).filter((f) => f.actionable);
  const pending = boardParts.filter((p) => p.status === "pending");
  const conflicted = (p: BoardPart) => p.tone === "block" || p.tone === "warn";
  return {
    year, viewerId, ro1: short(routeSettings.get().ro1Id), employees: boardEmployees, parts: boardParts, tiers,
    schedule: (() => {
      // статус графика по полугодиям; если таблица ещё не обновлена миграцией — пусто
      let list: ReturnType<typeof schedules.list> = [];
      try { list = schedules.list(year); } catch { /* миграция не применена */ }
      return {
        approver: short(routeSettings.get().scheduleApproverId),
        halves: list.map((sc) => ({ half: sc.half, label: SCHEDULE_HALF_LABEL[sc.half], status: sc.status, statusLabel: SCHEDULE_STATUS_LABEL[sc.status],
          decidedAt: sc.decidedAt, decidedBy: sc.decidedBy ? short(sc.decidedBy) : null, comment: sc.comment })),
      };
    })(),
    holidays: holidayList.map((h) => ({ date: h.date, name: h.name })),
    windows,
    summary: {
      open: findings.filter((f) => f.level === "block" || f.level === "warn").length,
      blocks: findings.filter((f) => f.level === "block").length,
      warns: findings.filter((f) => f.level === "warn").length,
      resolved: findings.filter((f) => f.level === "exception").length,
      waitingHr: pending.filter((p) => p.stage === "hr" || conflicted(p)).length,
      exceptionRequests: pending.filter((p) => p.exceptionRequest).length,
      changesHr: boardParts.filter((p) => p.change?.stage === "hr").length,
      atManager: pending.filter((p) => p.stage === "manager" && !conflicted(p)).length,
      approved: boardParts.filter((p) => p.status === "approved").length,
      parts: boardParts.filter((p) => p.status !== "draft").length,
    },
    notices: teamConflicts(ctx.employees, ctx.plans, ctx.rules, ctx).notices.map((n) => n.message),
  };
}

/** Часть, её заявка и сотрудник; HR не решает по собственному отпуску. */
function partForHr(partId: number, hrId: string) {
  const part = parts.get(partId);
  if (!part) throw new Error(`Нет части ${partId}`);
  const req = requests.get(part.requestId);
  if (!req) throw new Error(`Нет заявки для части ${partId}`);
  requireDecider(req.employeeId, hrId);
  return { part, req };
}

const whoIs = (id: string) => shortName(employees.get(id)?.fullName ?? id);
const partText = (p: { startDate: string; endDate: string }) => fmtRange(p.startDate, p.endDate);

/** Шаг HR выполняет РО1 из маршрута; по отпуску самого РО1 — проверяющий за РО1. Остальные HR только смотрят. */
function requireDecider(employeeId: string, userId: string) {
  const d = hrDeciderFor(employeeId);
  if (d.id !== userId) {
    const name = shortName(employees.get(d.id)?.fullName ?? d.id);
    throw new AccessDenied(d.asReviewer ? `Отпуск РО1 проверяет ${name}` : `Решение принимает РО1 — ${name}`);
  }
}

/**
 * Регламент: «После одобрения непосредственным руководителем, РО1 проверяет…». Пока часть на шаге
 * руководителя, РО1 не согласует и не разрешает исключение (вернуть сотруднику можно на любом шаге).
 * У ИД руководителя нет — шаг пропускается.
 */
function waitingManager(part: Parameters<typeof routeStage>[0], req: VacationRequest): string | null {
  const managerId = employees.get(req.employeeId)?.managerId ?? null;
  if (routeStage(part, req, managerId, managerApprovals()) !== "manager") return null;
  return `Ждёт руководителя: ${dot(whoIs(managerId!))} РО1 проверяет после согласования руководителем.`;
}
const dot = (s: string) => (s.endsWith(".") ? s : `${s}.`);
const managerOf = (employeeId: string) => { const m = employees.get(employeeId)?.managerId; return m ? whoIs(m) : "руководитель"; };

function revalidateScreens() {
  revalidatePath("/hr");
  revalidatePath("/team");
  revalidatePath("/me");
}

/** Открытые запреты и предупреждения, которые касаются части (свои и на весь план). */
function openFor(employeeId: string, partId: number) {
  const res = checkInContext(engineContext(PLAN_YEAR), employeeId);
  return (res?.results ?? []).filter((r) => isOpen(r) && touches(r, partId))
    .map((r) => ({ r, code: dbRuleCode(r.code), law: r.consequence === "law", needsException: r.consequence === "exception" }));
}

/** Решение и то, как его отменить: статусы до решения и созданные исключения. */
function undoOf(part: { id: number; status: PartStatus }, req: VacationRequest, expect: PartStatus, exceptionIds: number[] = []): UndoToken {
  return { partId: part.id, expect, partStatus: part.status, requestId: req.id, requestStatus: req.status, exceptionIds };
}

/** HR согласует часть окончательно. С открытым конфликтом регламента — только исключением. */
export async function hrApprovePart(partId: number): Promise<Decision> {
  const u = await currentUser();
  const { part, req } = partForHr(partId, u.id);
  if (part.status === "approved") return { ok: false, error: "Часть уже согласована." };
  const wait = waitingManager(part, req);
  if (wait) return { ok: false, error: wait };
  const open = openFor(req.employeeId, partId);
  const lawBlock = open.find((x) => x.law);
  if (lawBlock) return { ok: false, error: `Нарушена норма ТК: ${lawBlock.r.message}. Верните сотруднику.` };
  if (open.some((x) => x.needsException)) return { ok: false, error: "Есть отступление от регламента: разрешите исключением с причиной или верните." };
  transaction(() => {
    parts.setStatus(partId, "approved");
    logAudit({ actorId: u.id, action: "approve", entity: "part", entityId: partId, before: { status: part.status }, after: { status: "approved", by: "hr" } });
    notify([req.employeeId], `Часть ${partText(part)} согласована (${whoIs(u.id)})`, "/me", "decision");
    syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true, undo: undoOf(part, req, "approved") };
}

/** Разрешить исключением: по каждому открытому правилу регламента — запись в exceptions, часть согласована. */
export async function hrApproveWithException(partId: number, reason: string): Promise<Decision> {
  const u = await currentUser();
  const text = reason.trim();
  if (text.length < 5) return { ok: false, error: "Напишите причину исключения: она попадёт в журнал." };
  const { part, req } = partForHr(partId, u.id);
  const wait = waitingManager(part, req);
  if (wait) return { ok: false, error: wait };
  const open = openFor(req.employeeId, partId);
  const law = open.find((x) => x.law);
  if (law) return { ok: false, error: `Норма ТК исключением не снимается: ${law.r.title}.` };
  const byCode = [...new Map(open.filter((x) => x.needsException).map((x) => [x.code, x])).values()];
  if (!byCode.length) return { ok: false, error: "Конфликтов по регламенту нет — исключение не нужно, просто согласуйте." };
  const ids = transaction(() => {
    const ids = byCode.map(({ r, code }) => {
      const input = { employeeId: req.employeeId, partId: r.partIds.length ? partId : null, ruleCode: code, decision: "allow" as const, reason: text };
      const id = exceptions.add({ ...input, createdBy: u.id });
      logAudit({ actorId: u.id, action: "exception", entity: "exception", entityId: id, after: { ...input, message: r.message } });
      return id;
    });
    if (part.status !== "approved") {
      parts.setStatus(partId, "approved");
      logAudit({ actorId: u.id, action: "approve", entity: "part", entityId: partId, before: { status: part.status }, after: { status: "approved", by: "hr", exceptions: ids } });
      notify([req.employeeId], `Часть ${partText(part)} согласована как исключение (${whoIs(u.id)})`, "/me", "decision");
    }
    syncRequestStatus(req);
    return ids;
  });
  revalidateScreens();
  return { ok: true, undo: undoOf(part, req, "approved", ids) };
}

/** Вернуть часть сотруднику с комментарием и предложенными окнами (до трёх: из подсказок движка или выбранные вручную). */
export async function hrReturnPart(partId: number, comment: string, windows: Range[] = []): Promise<Decision> {
  const u = await currentUser();
  const text = comment.trim();
  if (text.length < 5) return { ok: false, error: "Напишите сотруднику, что поменять." };
  const { part, req } = partForHr(partId, u.id);
  if (part.status !== "pending" && part.status !== "approved") return { ok: false, error: "Часть уже у сотрудника." };
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const offered = windows.filter((w) => iso.test(w.start) && iso.test(w.end) && w.start <= w.end).slice(0, 3).map((w) => ({ start: w.start, end: w.end }));
  transaction(() => {
    parts.setStatus(partId, "returned");
    logAudit({ actorId: u.id, action: "return", entity: "part", entityId: partId, before: { status: part.status }, after: { status: "returned", by: "hr", comment: text, windows: offered } });
    notify([req.employeeId], `Часть ${partText(part)} возвращена (${whoIs(u.id)}): «${text}»${offered.length ? ". Предложены даты" : ""}`, "/me", "decision");
    syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true, undo: undoOf(part, req, "returned") };
}

/**
 * «Отменить» в уведомлении: вернуть статусы части и заявки, выключить созданные исключения.
 * Журнал не чистится — отмена пишется отдельной записью undo. Если заявку уже поменяли, отмены нет.
 */
export async function hrUndo(t: UndoToken): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await currentUser();
  const { part, req } = partForHr(t.partId, u.id);
  if (part.status !== t.expect || req.id !== t.requestId) return { ok: false, error: "Заявку уже изменили — отменить нельзя." };
  transaction(() => {
    parts.setStatus(part.id, t.partStatus);
    requests.restoreStatus(req.id, t.requestStatus);
    for (const id of t.exceptionIds) exceptions.setActive(id, false);
    logAudit({ actorId: u.id, action: "undo", entity: "part", entityId: part.id, before: { status: part.status }, after: { status: t.partStatus, exceptionsOff: t.exceptionIds } });
  });
  revalidateScreens();
  return { ok: true };
}

/* ---------------- изменение согласованной части: перенос, продление, отзыв ---------------- */

/** Открытая заявка на изменение и её проверка движком; HR не решает по своему отпуску. */
function changeForHr(changeId: number, hrId: string) {
  const c = changes.get(changeId);
  if (!c || c.status !== "open") throw new Error("Заявка на изменение уже не ждёт решения");
  requireDecider(c.employeeId, hrId);
  const names = new Map(employees.list().map((e) => [e.id, e.fullName]));
  const source = new Map(rules.list().map((r) => [r.code, r.source]));
  const view = changeView(c, (id) => shortName(names.get(id) ?? id), (code) => source.get(code) ?? "ТК");
  return { c, view };
}

type Simple = { ok: true } | { ok: false; error: string };

/** HR согласует перенос, сокращение или отказ: даты части меняются. С запретом регламента — только исключением. */
export async function hrApproveChange(changeId: number): Promise<Simple> {
  const u = await currentUser();
  const { c, view } = changeForHr(changeId, u.id);
  if (c.stage === "manager") return { ok: false, error: `Ждёт руководителя: ${dot(managerOf(c.employeeId))} РО1 проверяет после согласования руководителем.` };
  if (view.law) return { ok: false, error: "Новые даты нарушают норму ТК: перенос можно только отклонить." };
  if (view.needsException) return { ok: false, error: "Перенос нарушает регламент: разрешите исключением с причиной или отклоните." };
  transaction(() => {
    const { part } = changes.approve(changeId, u.id);
    logAudit({ actorId: u.id, action: "approve", entity: "change", entityId: changeId, before: { ...part.before }, after: { ...part.after, kind: c.kind } });
    notify([c.employeeId], `Заявка на изменение части ${fmtRange(c.oldStart, c.oldEnd)} согласована (${whoIs(u.id)})`, "/me", "decision");
    const req = requests.list(PLAN_YEAR).find((r) => r.id === part.after.requestId);
    if (req) syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true };
}

/** Разрешить перенос исключением (например, поздний — меньше 14 дней, R14): исключения по правилам регламента и согласование. */
export async function hrApproveChangeWithException(changeId: number, reason: string): Promise<Simple> {
  const u = await currentUser();
  const text = reason.trim();
  if (text.length < 5) return { ok: false, error: "Напишите причину исключения: она попадёт в журнал." };
  const { c, view } = changeForHr(changeId, u.id);
  if (c.stage === "manager") return { ok: false, error: `Ждёт руководителя: ${dot(managerOf(c.employeeId))} РО1 проверяет после согласования руководителем.` };
  if (view.law) return { ok: false, error: "Норма ТК исключением не снимается: перенос можно только отклонить." };
  const codes = [...new Set(view.findings.filter((f) => f.consequence === "exception").map((f) => f.ruleCode))];
  if (!codes.length) return { ok: false, error: "Нарушений регламента нет — исключение не нужно, просто согласуйте." };
  transaction(() => {
    const ids = codes.map((code) => {
      const input = { employeeId: c.employeeId, partId: c.partId, ruleCode: code, decision: "allow" as const, reason: text };
      const id = exceptions.add({ ...input, createdBy: u.id });
      logAudit({ actorId: u.id, action: "exception", entity: "exception", entityId: id, after: { ...input, changeId } });
      return id;
    });
    const { part } = changes.approve(changeId, u.id, text);
    logAudit({ actorId: u.id, action: "approve", entity: "change", entityId: changeId, before: { ...part.before }, after: { ...part.after, kind: c.kind, exceptions: ids } });
    notify([c.employeeId], `Заявка на изменение части ${fmtRange(c.oldStart, c.oldEnd)} согласована как исключение (${whoIs(u.id)})`, "/me", "decision");
    const req = requests.list(PLAN_YEAR).find((r) => r.id === part.after.requestId);
    if (req) syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true };
}

/** Отклонить заявку на изменение: часть остаётся на прежних датах. */
export async function hrRejectChange(changeId: number, reason: string): Promise<Simple> {
  const u = await currentUser();
  const text = reason.trim();
  if (text.length < 5) return { ok: false, error: "Напишите сотруднику, почему перенос невозможен." };
  const { c } = changeForHr(changeId, u.id);
  transaction(() => {
    changes.reject(changeId, u.id, text);
    logAudit({ actorId: u.id, action: "reject", entity: "change", entityId: changeId, before: { status: c.status }, after: { status: "rejected", comment: text } });
    notify([c.employeeId], `Заявка на изменение части ${fmtRange(c.oldStart, c.oldEnd)} отклонена (${whoIs(u.id)}): «${text}»`, "/me", "decision");
  });
  revalidateScreens();
  return { ok: true };
}

/** Предпросмотр продления по больничному: новый конец с пересчётом праздников. */
export async function hrPreviewExtension(partId: number, sickStart: string, sickEnd: string) {
  await requireAccess("hr");
  if (!sickStart || !sickEnd || sickEnd < sickStart) return null;
  return sicknessExtension(partId, sickStart, sickEnd);
}

/** Продлить часть по больничному (ст. 171): даты больничного внутри отпуска переносятся в хвост. */
export async function hrExtend(partId: number, sickStart: string, sickEnd: string, basis: string): Promise<Simple> {
  const u = await requireAccess("hr");
  const text = basis.trim();
  if (text.length < 3) return { ok: false, error: "Укажите основание: номер листка нетрудоспособности." };
  const { part, req } = partForHr(partId, u.id);
  if (part.status !== "approved") return { ok: false, error: "Продлить можно только согласованную часть." };
  const ext = sicknessExtension(partId, sickStart, sickEnd);
  if (!ext || !ext.addedDays) return { ok: false, error: ext?.message ?? "Больничный не пересекается с отпуском." };
  transaction(() => {
    const r = parts.extend(partId, ext.end, { by: u.id, on: new Date().toISOString().slice(0, 10), note: text, reason: "illness" });
    logAudit({ actorId: u.id, action: "extend", entity: "part", entityId: partId, before: { start: part.startDate, end: part.endDate },
      after: { start: r.part.after.startDate, end: r.part.after.endDate, sick: { start: sickStart, end: sickEnd }, addedDays: ext.addedDays, basis: text, changeId: r.change.id } });
    notify([req.employeeId], `Отпуск продлён по больничному до ${fmtDate(ext.end)} (${whoIs(u.id)})`, "/me", "decision");
    syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true };
}

/** Предпросмотр отзыва: сколько дней вернётся в остаток и можно ли отзывать. */
export async function hrPreviewRecall(partId: number, returnOn: string) {
  await requireAccess("hr");
  const p = parts.get(partId);
  const req = p ? requests.list(PLAN_YEAR).find((r) => r.id === p.requestId) : null;
  return req && returnOn ? recall(req.employeeId, partId, returnOn) : null;
}

/** Отозвать из отпуска (ст. 174): только с согласия работника; неиспользованные дни возвращаются в остаток. */
export async function hrRecall(partId: number, returnOn: string, consent: boolean, basis: string): Promise<Simple> {
  const u = await requireAccess("hr");
  if (!consent) return { ok: false, error: "Отзыв возможен только с согласия работника (ст. 174 ТК)." };
  const text = basis.trim();
  if (text.length < 3) return { ok: false, error: "Укажите основание: приказ или служебную записку." };
  const { part, req } = partForHr(partId, u.id);
  if (part.status !== "approved") return { ok: false, error: "Отозвать можно только из согласованной части." };
  const r0 = recall(req.employeeId, partId, returnOn);
  if (!r0 || !r0.allowed) return { ok: false, error: r0?.message ?? "Отзыв невозможен." };
  transaction(() => {
    const r = parts.recall(partId, r0.returnOn, { by: u.id, on: new Date().toISOString().slice(0, 10), note: text });
    logAudit({ actorId: u.id, action: "recall", entity: "part", entityId: partId, before: { start: part.startDate, end: part.endDate },
      after: { start: r.part.after.startDate, end: r.part.after.endDate, returnOn: r0.returnOn, returnedDays: r0.returnedDays, consent: true, basis: text, changeId: r.change.id } });
    notify([req.employeeId], `Отзыв из отпуска: выход на работу ${fmtDate(r0.returnOn)}, в остаток вернётся ${r0.returnedDays} дн. (${whoIs(u.id)})`, "/me", "decision");
    syncRequestStatus(req);
  });
  revalidateScreens();
  return { ok: true };
}
