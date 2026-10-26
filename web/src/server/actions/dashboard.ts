"use server";

/**
 * Дашборд сбора графика: кто подал план, где он застрял, конфликты, доля согласованного,
 * неиспользованные дни и ближайшие отпуска для бухгалтерии (отпускные за 2 дня, ст. 176 ТК).
 */
import { revalidatePath } from "next/cache";
import { isWorkingDay } from "@/domain";
import { dbRuleCode } from "@/domain/fromDb";
import { PLAN_YEAR } from "@/lib/config";
import { addDays } from "@/lib/dates";
import { audit, changes, employees, parts, requests, routeSettings, rules, schedules } from "../db/repo";
import { transaction } from "../db/client";
import { CHANGE_KIND_LABEL, scheduleDeadline, type Employee, type PartChange, type RequestPart, type VacationRequest } from "../db/types";
import { todayIso } from "@/domain/config";
import { notify } from "../notify";
import { logAudit } from "../audit";
import { requireAccess } from "../session";
import { teamConflicts } from "../engine";
import { isExceptionRequest } from "../approvals";

/**
 * Сроки по регламенту: график на полугодие — I до 15 января, II до 15 июля. По ТК (ч. 2 ст. 168)
 * график годовой и до 5 января — это расхождение показываем пометкой риска, а не основным текстом.
 */
const H1_DEADLINE = scheduleDeadline(PLAN_YEAR, 1);
const H2_DEADLINE = scheduleDeadline(PLAN_YEAR, 2);

export type Lane = "none" | "manager" | "hr" | "approved";

export interface DashboardRow {
  employee: Pick<Employee, "id" | "fullName" | "position" | "division" | "department" | "managerId">;
  managerName: string | null;
  request: Pick<VacationRequest, "status" | "submittedAt" | "updatedAt"> | null;
  lane: Lane;
  verdict: "ok" | "warn" | "block" | null;
  /** Открытые нарушения: «лимит группы», «без кого не уходит». consequence — что будет: закон, исключение, пометка */
  issues: { ruleCode: string; title: string; level: "block" | "warn"; consequence: "law" | "exception" | "warning" }[];
  /** Частей на согласовании с запросом исключения: нарушен регламент, ТК — нет (как в очереди Ганта) */
  exceptionRequests: number;
  planned: number; // основных дней в плане
  approvedDays: number;
  norm: number;
  pendingParts: number;
  /** Когда последний раз напоминали (сотруднику или его руководителю) */
  remindedAt: string | null;
}

/** Открытый запрос на перенос, сокращение или отказ от согласованной части. */
export interface ChangeItem {
  id: number;
  employee: DashboardRow["employee"];
  managerName: string | null;
  kind: PartChange["kind"];
  kindLabel: string;
  oldStart: string; oldEnd: string;
  newStart: string | null; newEnd: string | null;
  note: string | null;
  requestedOn: string;
  /** Дней от подачи до прежнего начала; меньше параметра R14 — поздний перенос, нужно исключение РО1 */
  daysBefore: number;
  late: boolean;
}

export interface Departure {
  employeeId: string;
  fullName: string;
  position: string;
  partNo: number;
  start: string;
  end: string;
  days: number;
  approved: boolean;
  type: RequestPart["type"];
  /** Только у планового лечения: госпитализация или амбулаторное (диагноз не храним) */
  treatmentKind: RequestPart["treatmentKind"];
  /** Сотрудник попросил отпускные (регламент: по заявлению, не больше оклада — юридический риск, ст. 175–176) */
  needsPay: boolean;
  /** Не позднее этого дня выплатить отпускные (за 2 календарных дня) */
  payBy: string;
  /** Последний рабочий день не позже payBy — если payBy выпадает на выходной */
  payWorkday: string;
}

/** Загрузка месяца: сколько человеко-дней отпуска, сколько людей и пик одновременно отсутствующих. */
export interface MonthLoad {
  month: number; // 0–11
  personDays: number;
  people: number;
  peak: number;
  peakDate: string | null;
}

function monthLoad(list: { employeeId: string; startDate: string; endDate: string }[], year: number): MonthLoad[] {
  const byDay = new Map<string, Set<string>>();
  for (const p of list)
    for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1))
      if (d.startsWith(String(year))) (byDay.get(d) ?? byDay.set(d, new Set()).get(d)!).add(p.employeeId);
  return Array.from({ length: 12 }, (_, m) => {
    const prefix = `${year}-${String(m + 1).padStart(2, "0")}`;
    let personDays = 0, peak = 0, peakDate: string | null = null;
    const people = new Set<string>();
    for (const [d, who] of byDay) {
      if (!d.startsWith(prefix)) continue;
      personDays += who.size;
      who.forEach((id) => people.add(id));
      if (who.size > peak || (who.size === peak && peakDate && d < peakDate)) { peak = who.size; peakDate = d; }
    }
    return { month: m, personDays, people: people.size, peak, peakDate };
  });
}

function lastWorkday(iso: string) {
  let d = iso;
  while (!isWorkingDay(d)) d = addDays(d, -1);
  return d;
}

export async function getDashboard() {
  await requireAccess("hr");
  const list = employees.listActive();
  const names = new Map(list.map((e) => [e.id, e.fullName]));
  const reqs = new Map(requests.list(PLAN_YEAR).map((r) => [r.employeeId, r]));
  const report = teamConflicts();
  const source = new Map(rules.list().map((r) => [r.code, r.source]));
  const today = todayIso();
  const reminded = new Map<string, string>();
  for (const a of audit.list({ entity: "employee", limit: 1000 }))
    if (a.action === "remind" && a.entityId && !reminded.has(a.entityId)) reminded.set(a.entityId, a.at);

  const departures: Departure[] = [];
  const rows: DashboardRow[] = list.map((e) => {
    const req = reqs.get(e.id) ?? null;
    const ps: RequestPart[] = req ? parts.forRequest(req.id).filter((p) => p.status !== "rejected") : [];
    const main = ps.filter((p) => p.type === "main");
    const open = report.conflicts.filter((c) => c.employeeId === e.id && !c.resolved && (c.status === "block" || c.status === "warn"));
    const issues = open.map((c) => ({
      ruleCode: dbRuleCode(c.code), title: c.title, level: c.status as "block" | "warn",
      consequence: c.consequence ?? (c.status === "warn" ? "warning" as const : "law" as const),
    }));
    const results = report.conflicts.filter((c) => c.employeeId === e.id)
      .map((c) => ({ status: c.status, partIds: c.partIds, regulation: source.get(dbRuleCode(c.code)) === "регламент", consequence: c.consequence }));
    const exceptionRequests = ps.filter((p) => isExceptionRequest(p, results)).length;
    const pendingParts = ps.filter((p) => p.status === "pending").length;
    const lane: Lane =
      !req || req.status === "draft" || req.status === "returned" ? "none"
      : req.status === "approved" || (ps.length > 0 && ps.every((p) => p.status === "approved")) ? "approved"
      : issues.length ? "hr" : "manager";
    return {
      employee: { id: e.id, fullName: e.fullName, position: e.position, division: e.division, department: e.department, managerId: e.managerId },
      managerName: e.managerId ? names.get(e.managerId) ?? null : null,
      request: req ? { status: req.status, submittedAt: req.submittedAt, updatedAt: req.updatedAt } : null,
      lane,
      verdict: report.statusByEmployee[e.id] ?? null,
      issues,
      planned: main.reduce((s, p) => s + p.days, 0),
      approvedDays: main.filter((p) => p.status === "approved").reduce((s, p) => s + p.days, 0),
      norm: e.baseDays + e.extraDays,
      pendingParts,
      exceptionRequests,
      remindedAt: reminded.get(e.id) ?? null,
    };
  });
  // уходы для бухгалтерии — за любой год: в октябре ближайший месяц ещё в текущем году, а не в году графика
  const byEmp = new Map(list.map((e) => [e.id, e]));
  const thisYear = +today.slice(0, 4);
  for (const y of [...new Set([thisYear, PLAN_YEAR])]) {
    const sent = new Set(requests.list(y).filter((r) => r.status !== "draft").map((r) => r.id));
    for (const p of parts.forYear(y)) {
      const e = byEmp.get(p.employeeId);
      if (!e || !sent.has(p.requestId) || (p.status !== "approved" && p.status !== "pending") || p.endDate < today) continue;
      const payBy = addDays(p.startDate, -2);
      departures.push({
        employeeId: e.id, fullName: e.fullName, position: e.position, partNo: p.partNo,
        start: p.startDate, end: p.endDate, days: p.days, approved: p.status === "approved", type: p.type,
        treatmentKind: p.treatmentKind ?? null, needsPay: !!p.needsPay, payBy, payWorkday: lastWorkday(payBy),
      });
    }
  }
  departures.sort((a, b) => a.start.localeCompare(b.start));

  const byId = new Map(list.map((e) => [e.id, e]));
  const r14 = rules.list().find((r) => r.code === "R14");
  const minDays = r14?.enabled && typeof r14.params.value === "number" ? r14.params.value : null;
  const change = (c: PartChange): ChangeItem => {
    const e = byId.get(c.employeeId)!;
    const daysBefore = Math.round((Date.parse(c.oldStart) - Date.parse(c.requestedOn)) / 86_400_000);
    return {
      id: c.id, kind: c.kind, kindLabel: CHANGE_KIND_LABEL[c.kind],
      employee: { id: e.id, fullName: e.fullName, position: e.position, division: e.division, department: e.department, managerId: e.managerId },
      managerName: e.managerId ? names.get(e.managerId) ?? null : null,
      oldStart: c.oldStart, oldEnd: c.oldEnd, newStart: c.newStart, newEnd: c.newEnd, note: c.note, requestedOn: c.requestedOn,
      daysBefore, late: minDays != null && daysBefore < minDays,
    };
  };

  const open = report.conflicts.filter((c) => !c.resolved && (c.status === "block" || c.status === "warn"));
  const allParts = parts.forYear(PLAN_YEAR).filter((p) => p.status !== "rejected");
  const started = [...reqs.values()].map((r) => (r.submittedAt ?? r.updatedAt).slice(0, 10)).sort()[0] ?? today;
  return {
    year: PLAN_YEAR, today,
    // утверждение графика (ч. 1–2 ст. 168 ТК): статус, кто утверждает, сколько работников получат уведомление
    schedules: schedules.list(PLAN_YEAR),
    route: (() => { const r = routeSettings.get(); return { approver: names.get(r.scheduleApproverId) ?? r.scheduleApproverId, unionRequired: r.unionRequired }; })(),
    names: Object.fromEntries(list.map((e) => [e.id, e.fullName])),
    working: list.length,
    deadline: H1_DEADLINE, scheduleDeadline: H2_DEADLINE,
    collectStart: started,
    rows, departures,
    changes: { hr: changes.open("hr").filter((c) => byId.has(c.employeeId)).map(change), manager: changes.open("manager").filter((c) => byId.has(c.employeeId)).map(change) },
    load: monthLoad(allParts.filter((p) => p.status === "approved" || p.status === "pending"), PLAN_YEAR),
    exceptionRequests: rows.reduce((s, r) => s + r.exceptionRequests, 0),
    conflicts: {
      block: open.filter((c) => c.status === "block").length,
      warn: open.filter((c) => c.status === "warn").length,
      exceptions: report.conflicts.filter((c) => c.resolved).length,
      people: new Set(open.map((c) => c.employeeId)).size,
    },
    parts: {
      total: allParts.length,
      approved: allParts.filter((p) => p.status === "approved").length,
      pending: allParts.filter((p) => p.status === "pending").length,
      draft: allParts.filter((p) => p.status === "draft" || p.status === "returned").length,
    },
  };
}

/**
 * Демо-напоминание: в бою — письмо или сообщение в мессенджер. Здесь только строка журнала
 * на каждого адресата. kind: plan — сотруднику «подайте план», decision — руководителю «решите».
 */
export async function sendReminders(kind: "plan" | "decision", employeeIds: string[]) {
  const u = await requireAccess("hr");
  const known = new Map(employees.listActive().map((e) => [e.id, e]));
  const targets = [...new Set(employeeIds)].filter((id) => known.has(id));
  if (!targets.length) return { sent: 0 };
  transaction(() => {
    for (const id of targets) {
      const e = known.get(id)!;
      const to = kind === "decision" ? e.managerId : e.id;
      // уведомление в приложении (колокольчик); писем система не шлёт
      notify([to], kind === "decision"
        ? `Напоминание от отдела кадров: план ${e.fullName} ждёт вашего решения`
        : `Напоминание от отдела кадров: подайте план отпуска на ${PLAN_YEAR} год — заявления на I полугодие до 15 января`,
      kind === "decision" ? "/team" : "/me", "reminder");
      logAudit({
        actorId: u.id, action: "remind", entity: "employee", entityId: id,
        after: { kind, to, channel: "app", deadline: H1_DEADLINE },
      });
    }
  });
  revalidatePath("/hr/log");
  revalidatePath("/hr/dashboard");
  return { sent: targets.length, at: new Date().toISOString() };
}
