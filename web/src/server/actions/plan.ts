"use server";

/** Серверные функции экрана сотрудника (`/me`) и очереди руководителя (`/team`). */
import { revalidatePath } from "next/cache";
import { audit, changes, employees, holidays, parts, requests, roles, routeSettings, rules, schedules } from "../db/repo";
import { transaction } from "../db/client";
import type { PartChange, PartInput, PartStatus, RequestPart, VacationRequest } from "../db/types";
import { LEAVE_REASONS, VACATION_TYPE_LABEL } from "../db/types";
import { logAudit } from "../audit";
import { notify } from "../notify";
import { log } from "../log";
import { AccessDenied, can, canSeeEmployee, currentUser } from "../session";
import { checkChange, checkPlan, edgeVerdicts, freeWindows, groupAbsences, groupLoad, normFixes, substituteCandidates, type Finding, type PlanCheck } from "../engine";
import type { ChangeCheck, DraftCheck, HistoryItem, MyChange, MoveVerdict, SubstituteView, MyCheck, MyPart, MyPlan, MyRequest, SaveResult, WindowView } from "@/components/me/types";
import { countVacationDays, fmtDate, fmtRange } from "@/lib/dates";
import { getPrivacy } from "./rules";

import { PLAN_YEAR } from "@/lib/config";
import { todayIso } from "@/domain/config";

/** План сотрудника на год: заявка, части, праздники, загрузка группы и итог проверки. */
export async function getPlan(employeeId?: string, year = PLAN_YEAR) {
  const u = await currentUser();
  const id = employeeId ?? u.id;
  if (!canSeeEmployee(u, id)) throw new AccessDenied();
  const employee = employees.get(id)!;
  const request = requests.forEmployee(id, year);
  const list = request ? parts.forRequest(request.id) : [];
  const check = checkPlan(id, list);
  return {
    employee, request, parts: list,
    holidays: holidays.list(year),
    load: groupLoad(id, year),
    // свой план сотрудник видит в своём виде (имена — по настройке HR), руководитель и HR — целиком
    check: id === u.id ? personal(check, (await getPrivacy()).showColleagueNames, groupLimitOf(employee)) : check,
  };
}

/* ---------------- экран сотрудника ---------------- */

const MAX_PARTS = 6;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** «Романович Глеб Юрьевич» → «Романович Глеб» */
const shortName = (full: string) => full.split(/\s+/).slice(0, 2).join(" ");
/** «Петров Сергей Иванович» → «Петров С.» */
const initialName = (full: string) => {
  const [last, first] = full.split(/\s+/);
  return first ? `${last} ${first.charAt(0)}.` : last;
};
/** «Иванова Анна Сергеевна» → «Иванова А. С.» */
const fio = (full: string) => {
  const [last, ...rest] = full.split(/\s+/);
  return [last, ...rest.map((x) => `${x.charAt(0)}.`)].join(" ");
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Проверка для экрана сотрудника. Имена — только тех, кто мешает именно ему: коллег по группе
 * лимита (R01) и тех, кого он замещает (R02), и только если HR не выключил «имена коллег».
 * Должность замещающего видна всегда: без неё причину не понять. Чужие даты не отдаём.
 */
/** Внутренний комментарий HR к исключению сотруднику не показываем — только сам факт */
const HR_REASON = /\.?\s*Разрешено исключением HR:[\s\S]*$/;

/**
 * draftNo — номер проверяемого выделения (новые или изменённые даты): исключение HR согласовывали
 * для других дат, к выделению оно не относится — такие находки отбрасываем.
 */
function personal(c: PlanCheck, showNames: boolean, limit: number, draftNo?: number | null): MyCheck {
  // в названиях правил базы стоит «N» — сотруднику показываем само число
  const value = new Map(rules.list().map((r) => [r.code, r.params.value]));
  const titled = (code: string, t?: string) => {
    const v = value.get(code);
    return (t ?? code).replace(/(?<![\p{L}])N(?![\p{L}])/u, typeof v === "number" ? String(v) : "N");
  };
  const people = (code: string, ids?: string[]) => {
    if (!ids?.length || (code !== "R01" && code !== "R02") || (code === "R01" && !showNames)) return undefined;
    return ids.map((id) => employees.get(id)).filter((e) => !!e).map((e) => ({
      name: showNames ? shortName(e.fullName) : null,
      role: lower(e.position),
    }));
  };
  return {
    verdict: c.verdict,
    canSubmit: c.canSubmit ?? c.verdict !== "block",
    needsException: c.needsException ?? false,
    findings: c.findings.filter((f) => !(f.level === "exception" && draftNo && (f.partNo === draftNo || !f.partNo))).map((f) => {
      const who = people(f.ruleCode, f.employeeIds);
      const dates = f.dates?.length && (f.ruleCode === "R01" || f.ruleCode === "R02") ? [f.dates[0], f.dates[f.dates.length - 1]] as [string, string] : undefined;
      return {
        ruleCode: f.ruleCode, level: f.level, title: titled(f.ruleCode, f.title), basis: f.basis ?? "",
        message: humane(f, dates, who, limit),
        global: !f.dateBound,
        ...(f.consequence ? { consequence: f.consequence } : {}),
        ...(f.partNo ? { partNo: f.partNo } : {}),
        ...(dates ? { dates } : {}),
        ...(who ? { people: who } : {}),
      };
    }),
  };
}

/** Сколько человек группы может отдыхать одновременно; 0 — лимита нет (или льготник) */
function groupLimitOf(e: { roleCode: string; benefit: string | null; under18: boolean }) {
  if (e.benefit || e.under18) return 0;
  const role = roles.list().find((r) => r.code === e.roleCode);
  return role?.groupId != null ? roles.groups().find((g) => g.id === role.groupId)?.maxConcurrent ?? 0 : 0;
}

const and = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} и ${list[list.length - 1]}` : list[0] ?? "");
const when = (d: [string, string]) => (d[0] === d[1] ? fmtDate(d[0]) : fmtRange(d[0], d[1]));

/**
 * Лимит группы и замещение — по-человечески: кто именно мешает (или сколько их, если имена
 * скрыты) и почему. Остальные сообщения движка как есть.
 */
function humane(f: Finding, dates: [string, string] | undefined, who: { name: string | null; role: string }[] | undefined, limit: number) {
  const part = f.partNo ? `Часть ${f.partNo}: ` : "";
  const bad = f.level === "block" || f.level === "warn";
  if (f.ruleCode === "R01" && bad && dates) {
    const n = f.employeeIds?.length ?? 0;
    return who?.length
      ? `${part}${when(dates)} уже отдыха${who.length > 1 ? "ют" : "ет"} ${and(who.map((x) => x.name!))}${limit ? ` — в вашей группе не больше ${limit} одновременно` : ""}`
      : `${part}${when(dates)} уже отдыха${n === 1 ? "ет 1 коллега" : `ют ${n} ${n < 5 ? "коллеги" : "коллег"}`} из вашей группы${limit ? ` — одновременно можно не больше ${limit}` : ""}`;
  }
  // замещающего выбрал сам сотрудник — его имя показываем всегда
  if (f.ruleCode === "R15" && bad && f.employeeIds?.length) {
    const sub = employees.get(f.employeeIds[0]);
    if (sub && f.message.includes("замещающий в отпуске")) return f.message.replace("замещающий в отпуске", `${shortName(sub.fullName)} в отпуске`);
  }
  if (f.level === "exception" && HR_REASON.test(f.message)) return f.message.replace(HR_REASON, ". Согласовано РО1 как исключение");
  if (f.ruleCode === "R03" && bad) {
    const m = f.message.match(/летом (\d+)\D+?(\d+)/i);
    if (m) return `${part}Летом (1 июня — 31 августа) можно не больше ${m[2]} дней — у вас ${m[1]}. Больше — только с вашего письменного согласия на деление отпуска (ст. 174 ТК)`;
  }
  if (f.ruleCode === "R02") {
    if (bad && dates && who?.length) {
      const names = and(who.map((x) => (x.name ? `${x.name}, ${x.role}` : `ваш ${x.role}`)));
      return `${part}${when(dates)} в отпуске ${names}. Вам нельзя уходить одновременно — кто-то должен быть на месте`;
    }
    if (f.message.includes("зависимостей нет")) return "Уходить в отпуск можно независимо от других ролей";
    if (f.message.includes("на месте")) return `${part}Те, без кого вам нельзя уходить, на месте`;
  }
  return f.message;
}

function isIso(s: unknown, year: number): s is string {
  if (typeof s !== "string" || !ISO.test(s) || +s.slice(0, 4) !== year) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
}

/** Части с экрана — недоверенный ввод: тип из списка, даты ISO внутри года плана. */
function cleanParts(input: unknown, year: number, strict: boolean): PartInput[] {
  if (!Array.isArray(input) || input.length > MAX_PARTS) throw new Error(`Не больше ${MAX_PARTS} частей`);
  return input.map((p, i) => {
    const x = p as Partial<PartInput>;
    if (!x || typeof x.type !== "string" || !(x.type in VACATION_TYPE_LABEL)) throw new Error(`Часть ${i + 1}: неизвестный тип отпуска`);
    if (!isIso(x.startDate, year) || !isIso(x.endDate, year)) throw new Error(`Часть ${i + 1}: даты должны быть в ${year} году`);
    if (strict && x.endDate < x.startDate) throw new Error(`Часть ${i + 1}: последний день раньше первого`);
    const sub = typeof x.substituteId === "string" && employees.get(x.substituteId) ? x.substituteId : null;
    const reasons = x.type === "main" ? [] : LEAVE_REASONS[x.type];
    const reason = typeof x.reason === "string" && reasons.some((r) => r.code === x.reason) ? x.reason : null;
    const note = reason && typeof x.reasonNote === "string" ? x.reasonNote.trim().slice(0, 500) || null : null;
    // отпускные по заявлению — только у основного отпуска (п. 4 регламента)
    const needsPay = x.type === "main" && x.needsPay === true;
    return { type: x.type, startDate: x.startDate, endDate: x.endDate, substituteId: sub, reason, reasonNote: note, needsPay };
  });
}

const myRequest = (r: VacationRequest | null): MyRequest | null =>
  r ? { status: r.status, submittedAt: r.submittedAt, updatedAt: r.updatedAt } : null;

const myChange = (c: PartChange | null | undefined): MyChange | null => c ? {
  id: c.id, kind: c.kind, newStart: c.newStart, newEnd: c.newEnd, status: c.status, stage: c.stage, note: c.note, decisionNote: c.decisionNote,
} : null;

/** Последняя открытая или возвращённая заявка по каждой части сотрудника */
function openChanges(employeeId: string): Map<number, PartChange> {
  const out = new Map<number, PartChange>();
  for (const c of changes.forEmployee(employeeId)) {
    if ((c.status === "open" || c.status === "returned") && !out.has(c.partId)) out.set(c.partId, c);
  }
  return out;
}

const myParts = (list: RequestPart[], open: Map<number, PartChange> = new Map()): MyPart[] =>
  list.map((p, i) => {
    const sub = p.substituteId ? employees.get(p.substituteId) : null;
    return {
      id: p.id, change: myChange(open.get(p.id)),
      partNo: i + 1, type: p.type, startDate: p.startDate, endDate: p.endDate, days: p.days, status: p.status,
      substitute: sub ? { id: sub.id, name: shortName(sub.fullName) } : null,
      reason: p.reason, reasonNote: p.reasonNote, needsPay: p.needsPay,
    };
  });

/** Согласованную часть сотрудник сам не меняет: это уже перенос по ст. 171. */
const isLocked = (r: VacationRequest | null, list: RequestPart[]) =>
  r?.status === "approved" || list.some((p) => p.status === "approved");

/** Для какой части подбирать окна: запрошенная, иначе первая с запретом, иначе с предупреждением. */
function windowsTarget(check: PlanCheck, count: number, wanted?: number | null): number | null {
  if (!count) return null;
  if (wanted && wanted >= 1 && wanted <= count) return wanted;
  for (const level of ["block", "warn"] as const) {
    const f = check.findings.find((x) => x.level === level && x.partNo);
    if (f?.partNo) return f.partNo;
  }
  return 1;
}

/**
 * Свободные окна для части partNo, которые проходят полную проверку без запретов, как если бы их
 * поставили вместо части. Если запрет не зависит от дат (норма, число частей) — окон нет вовсе.
 */
function windowsFor(employeeId: string, list: PartInput[], partNo: number | null, check: PlanCheck): WindowView[] {
  // окна нужны, только когда с этими датами что-то не так
  if (!partNo || !check.findings.some((f) => f.partNo === partNo && (f.level === "block" || f.level === "warn"))) return [];
  return freeWindows(employeeId, list, partNo, PLAN_YEAR, { strict: true })
    .map((w) => ({ start: w.start, end: w.end, days: w.days, holidays: w.holidays.map((h) => h.date) }));
}

/** Всё для экрана «Мой календарь»: только свой план и обезличенная загрузка своей группы. */
export async function getMyPlan(): Promise<MyPlan> {
  const u = await currentUser();
  const year = PLAN_YEAR;
  const request = requests.forEmployee(u.id, year);
  const list = request ? parts.forRequest(request.id) : [];
  // по порядку дат: «Часть N» в проверке совпадает с N-й карточкой на экране
  const live = list.filter((p) => p.status !== "rejected").sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const check = checkPlan(u.id, live);

  const role = roles.list().find((r) => r.code === u.roleCode);
  const limitGroup = role?.groupId != null ? roles.groups().find((g) => g.id === role.groupId) : undefined;
  const summer = rules.list().find((r) => r.code === "R03");
  const reschedule = rules.list().find((r) => r.code === "R14");
  const { showColleagueNames: showNames } = await getPrivacy();

  return {
    year,
    employee: { fullName: u.fullName, position: u.position, division: u.division, department: u.department, benefit: u.benefit },
    manager: u.managerId ? employees.get(u.managerId)?.fullName ?? null : null,
    norm: u.baseDays + u.extraDays,
    request: myRequest(request),
    parts: myParts(live, openChanges(u.id)),
    locked: isLocked(request, list),
    holidays: holidays.list(year).filter((h) => h.nonWorking).map((h) => ({ date: h.date, name: h.name })),
    group: { label: role?.calendarGroup ?? u.position, limit: u.benefit || u.under18 ? 0 : limitGroup?.maxConcurrent ?? 0 },
    summerDays: summer?.enabled && typeof summer.params.value === "number" ? summer.params.value : null,
    rescheduleDays: reschedule?.enabled && typeof reschedule.params.value === "number" ? reschedule.params.value : null,
    today: todayIso(),
    ro1: fio(employees.get(routeSettings.get().ro1Id)?.fullName ?? "РО1"),
    schedule: ([1, 2] as const).map((half) => {
      const s = schedules.get(year, half);
      return { half, status: s.status, deadline: s.deadline, decidedAt: s.decidedAt };
    }),
    check: personal(check, showNames, groupLimitOf(u)),
    showNames,
    load: groupLoad(u.id, year),
    absent: showNames ? absentNames(u.id, year) : {},
  };
}

/**
 * Кто из своей группы лимита и из тех, кого сотрудник замещает, в отпуске по дням — только имена,
 * без дат чужих отпусков и статусов. Только дни, где кто-то есть.
 */
function absentNames(employeeId: string, year: number): Record<string, string[]> {
  const name = new Map<string, string>();
  const of = (id: string) => {
    if (!name.has(id)) name.set(id, initialName(employees.get(id)?.fullName ?? id));
    return name.get(id)!;
  };
  const out: Record<string, string[]> = {};
  for (const [date, { peers, deputies }] of Object.entries(groupAbsences(employeeId, year))) {
    const ids = [...new Set([...peers, ...deputies])];
    if (ids.length) out[date] = ids.map(of);
  }
  return out;
}

/** История своего плана из журнала: правки, отправки и решения по частям. */
export async function getMyHistory(): Promise<HistoryItem[]> {
  const u = await currentUser();
  const req = requests.forEmployee(u.id, PLAN_YEAR);
  if (!req) return [];
  const partIds = new Set(parts.forRequest(req.id).map((p) => String(p.id)));
  const rows = [
    ...audit.list({ entity: "request", limit: 500 }).filter((a) => a.entityId === String(req.id)),
    ...audit.list({ entity: "part", limit: 500 }).filter((a) => a.entityId && partIds.has(a.entityId)),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const name = (id: string | null) => (id === u.id ? "Вы" : id ? employees.get(id)?.fullName ?? id : "Система");
  const ranges = (v: unknown) => {
    const list = (v as { parts?: { startDate: string; endDate: string }[] } | null)?.parts;
    return list?.length ? list.map((p) => fmtRange(p.startDate, p.endDate)).join(", ") : null;
  };
  const LABEL: Record<string, string> = {
    update: "Изменён план", submit: "Отправлен на согласование", approved: "Часть согласована",
    returned: "Часть возвращена на доработку", rejected: "Часть отклонена", restore: "План восстановлен",
  };
  return rows.map((a) => {
    const after = a.after as { comment?: string; verdict?: string } | null;
    const detail = a.action === "update" ? ranges(a.after)
      : a.action === "submit" ? (after?.verdict === "warn" ? "с пометками для руководителя" : null)
      : after?.comment ?? null;
    return { id: a.id, at: a.at, actor: name(a.actorId), action: a.action, label: LABEL[a.action] ?? a.action, detail };
  });
}

/** Живая проверка несохранённых дат: итог, правила и свободные окна. Ничего не пишет. */
export async function checkMyDraft(input: PartInput[], wanted?: number | null): Promise<DraftCheck> {
  const u = await currentUser();
  const list = cleanParts(input, PLAN_YEAR, false);
  const check = checkPlan(u.id, list);
  const target = windowsTarget(check, list.length, wanted);
  const { showColleagueNames } = await getPrivacy();
  // перебор нормы: что сократить — подбирает движок, каждый вариант с полной проверкой плана
  const over = check.findings.some((f) => f.ruleCode === "R06" && f.level === "block");
  const trims = over && target ? normFixes(u.id, list, target)
    .map((t) => ({ partNo: t.partNo, draft: t.partNo === target, from: t.from, to: t.to, freedDays: t.freed, status: t.status })) : [];
  return {
    check: personal(check, showColleagueNames, groupLimitOf(u), wanted), windowsFor: target, windows: windowsFor(u.id, list, target, check), trims,
    extend: extendToLong(u.id, list, target, check),
  };
}

/**
 * Нет ни одной части от 14 дней (R05, ст. 174): продлить выделение до 14 дней отпуска — с конца или
 * с начала. Каждый вариант — полная проверка движком; берём только те, что не добавляют новых
 * запретов (существующие на других частях не мешают) и снимают R05.
 */
function extendToLong(employeeId: string, list: PartInput[], target: number | null, check: PlanCheck) {
  const r05 = check.findings.find((f) => f.ruleCode === "R05" && f.level === "block");
  const part = target ? list[target - 1] : null;
  const min = rules.list().find((r) => r.code === "R05")?.params.value;
  if (!r05 || !part || part.type !== "main" || typeof min !== "number") return [];
  const year = PLAN_YEAR;
  const hol = new Set(holidays.list(year).filter((h) => h.nonWorking).map((h) => h.date));
  const day = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const grow = (from: string, dir: 1 | -1) => {
    let t = Date.parse(from), n = countVacationDays(part.startDate, part.endDate, hol);
    while (n < min) {
      t += dir * day;
      if (iso(t).slice(0, 4) !== String(year)) return null;
      if (!hol.has(iso(t))) n++;
    }
    return iso(t);
  };
  const blocks = (c: PlanCheck) => new Set(c.findings.filter((f) => f.level === "block").map((f) => f.ruleCode));
  const before = blocks(check);
  const out: { start: string; end: string; days: number }[] = [];
  for (const cand of [
    { start: part.startDate, end: grow(part.endDate, 1) },
    { start: grow(part.startDate, -1), end: part.endDate },
  ]) {
    if (!cand.start || !cand.end) continue;
    const moved = { ...part, startDate: cand.start, endDate: cand.end };
    const next = list.map((x, i) => (i === target! - 1 ? moved : x))
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
    const after = blocks(checkPlan(employeeId, next));
    if (after.has("R05") || [...after].some((c) => !before.has(c))) continue;
    out.push({ start: cand.start, end: cand.end, days: countVacationDays(cand.start, cand.end, hol) });
  }
  return out;
}

/**
 * Вердикты для перетаскивания края выделения: неподвижный край fixed, тащимый — на любом дне года.
 * Для каждого положения — полная проверка плана с этим выделением (новая часть или изменяемая
 * часть index). Один запрос на захват края: дальше экран красит сам.
 */
export async function previewEdge(input: PartInput[], index: number | null, type: string, fixed: string): Promise<Record<string, MoveVerdict>> {
  const u = await currentUser();
  const year = PLAN_YEAR;
  const list = cleanParts(input, year, true);
  if (index !== null && !list[index]) return {};
  const [draft] = cleanParts([{ type, startDate: fixed, endDate: fixed }], year, true);
  const { showColleagueNames } = await getPrivacy();
  const limit = groupLimitOf(u);
  const out: Record<string, MoveVerdict> = {};
  for (const [d, v] of Object.entries(edgeVerdicts(u.id, list, index === null ? null : index + 1, draft.type, fixed, year))) {
    const first = personal({ employeeId: u.id, verdict: v.status, findings: v.results }, showColleagueNames, limit).findings
      .filter((f) => f.level === "block" || f.level === "warn")
      .sort((x, y) => (x.level === y.level ? Number(y.global) - Number(x.global) : x.level === "block" ? -1 : 1))[0];
    out[d] = first
      ? { level: first.level as "block" | "warn", reason: first.message.replace(/^Част[ьи] [\d, и]+: /, "") }
      : { level: "ok" };
  }
  return out;
}

/**
 * Кого можно указать замещающим на эти даты: свой отдел, потом отделение, руководитель и
 * подчинённые (подбирает движок). Чужие даты не отдаём — только «в отпуске N–M» в этих датах.
 */
export async function getSubstitutes(start: string, end: string): Promise<SubstituteView[]> {
  const u = await currentUser();
  if (!isIso(start, PLAN_YEAR) || !isIso(end, PLAN_YEAR) || end < start) return [];
  return substituteCandidates(u.id, { start, end }).map((c) => {
    const e = employees.get(c.employeeId);
    return {
      id: c.employeeId, name: c.name, position: e?.position ?? "",
      group: c.sameDept ? "Ваш отдел" : c.sameUnit ? "Ваше отделение" : "Другие коллеги",
      free: c.free,
      busy: c.busy.map((r) => when([r.start, r.end])).join(", "),
    };
  });
}

/**
 * Проверка заявки на перенос, сокращение или отказ от своей согласованной части: план с частью на
 * новых датах (у отказа — без неё) по всем правилам, плюс срок переноса от прежнего начала (R14).
 * Нарушения других частей сюда не попадают — только этой части и плана в целом.
 */
export async function checkMyChange(partId: number, kind: "move" | "shorten" | "cancel", newStart?: string | null, newEnd?: string | null): Promise<ChangeCheck> {
  const u = await currentUser();
  const part = parts.get(partId);
  const req = part ? requests.get(part.requestId) : null;
  if (!part || !req || req.employeeId !== u.id) throw new AccessDenied();
  const year = req.year;
  if (kind !== "cancel" && (!isIso(newStart, year) || !isIso(newEnd, year) || newEnd! < newStart!)) {
    return { check: { verdict: "ok", findings: [], canSubmit: false, needsException: false }, windows: [] };
  }
  const check = checkChange(u.id, partId, kind === "cancel" ? { kind } : { kind, newStart: newStart!, newEnd: newEnd! });
  // номер этой части в плане после изменения: по датам, как у движка
  const live = parts.forRequest(req.id).filter((p) => p.status !== "rejected")
    .map((p) => (p.id === partId ? { ...p, startDate: newStart ?? p.startDate } : p))
    .filter((p) => kind !== "cancel" || p.id !== partId)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const no = live.findIndex((p) => p.id === partId) + 1;
  const { showColleagueNames } = await getPrivacy();
  const mine = personal({ ...check, findings: check.findings.filter((f) => !f.partNo || f.partNo === no) }, showColleagueNames, groupLimitOf(u), no || null);
  return {
    check: mine,
    windows: check.windows.map((w) => ({ start: w.start, end: w.end, days: w.days, holidays: w.holidays.map((h) => h.date) })),
  };
}

/** Сохранить части как черновик. Отправленный план снова становится черновиком. */
export async function saveMyPlan(input: PartInput[]): Promise<SaveResult> {
  return save(input, false);
}

/**
 * Что будет при отправке: проверка в режиме подачи (там жёстче — например, замещающий обязателен).
 * law — что мешает подать по ТК, exception — что уйдёт как запрос исключения; каждая строка с датами части.
 */
export async function previewSubmit(input: PartInput[]): Promise<{ canSubmit: boolean; needsException: boolean; law: string[]; exception: string[] }> {
  const u = await currentUser();
  const list = cleanParts(input, PLAN_YEAR, true)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const check = checkPlan(u.id, list, PLAN_YEAR, { submitting: true });
  const { showColleagueNames } = await getPrivacy();
  const mine = personal(check, showColleagueNames, groupLimitOf(u));
  const line = (f: MyCheck["findings"][number]) => {
    const part = f.partNo ? list[f.partNo - 1] : null;
    const text = f.message.replace(/^Част[ьи] [\d, и]+: /, "");
    return part ? `${when([part.startDate, part.endDate])} — ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
  };
  const bad = mine.findings.filter((f) => f.level === "block" || f.level === "warn");
  return {
    canSubmit: mine.canSubmit,
    needsException: mine.needsException,
    law: bad.filter((f) => f.consequence === "law").map(line),
    exception: bad.filter((f) => f.consequence === "exception").map(line),
  };
}

/**
 * Сохранить и отправить на согласование. Нарушения ТК не пускают; расхождения с регламентом —
 * отправка как запрос исключения, только с обоснованием note («почему нужны именно эти даты»).
 */
export async function submitMyPlan(input: PartInput[], note?: string): Promise<SaveResult> {
  return save(input, true, typeof note === "string" ? note.trim().slice(0, 1000) : "");
}

async function save(input: PartInput[], submit: boolean, note = ""): Promise<SaveResult> {
  const u = await currentUser();
  const year = PLAN_YEAR;
  const list = cleanParts(input, year, true);
  const current = requests.forEmployee(u.id, year);
  const before = current ? parts.forRequest(current.id) : [];
  const { showColleagueNames } = await getPrivacy();
  const reply = (ok: boolean, check: PlanCheck, error?: string): SaveResult => {
    const req = requests.forEmployee(u.id, year);
    return { ok, error, request: myRequest(req), parts: myParts(req ? parts.forRequest(req.id) : []), check: personal(check, showColleagueNames, groupLimitOf(u)) };
  };
  if (isLocked(current, before)) return reply(false, checkPlan(u.id, before), "План уже согласован. Перенос — через РО1: откройте часть и нажмите «Запросить перенос».");

  const check = checkPlan(u.id, list, year, { submitting: submit });
  if (submit && !list.length) return reply(false, check, "Добавьте хотя бы одну часть");
  if (submit && !(check.canSubmit ?? check.verdict !== "block")) {
    return reply(false, check, `Так подать нельзя: ${check.reasons?.law[0]?.replace(/^Част[ьи] [\d, и]+: /, "") ?? "сначала уберите запрет"}`);
  }
  if (submit && check.needsException && !note) return reply(false, check, "Напишите, почему нужны именно эти даты, — без этого исключение не согласуют");

  // замещающий и причина — тоже правка: без них сравнение пропустило бы смену замещающего
  const same = before.length === list.length && before.every((p, i) =>
    p.type === list[i].type && p.startDate === list[i].startDate && p.endDate === list[i].endDate
    && (p.substituteId ?? null) === (list[i].substituteId ?? null)
    && (p.reason ?? null) === (list[i].reason ?? null) && (p.reasonNote ?? null) === (list[i].reasonNote ?? null)
    && !!p.needsPay === !!list[i].needsPay);
  transaction(() => {
    const req = requests.ensure(u.id, year);
    if (!same) {
      const after = parts.replace(req.id, list);
      logAudit({
        actorId: u.id, action: "update", entity: "request", entityId: req.id,
        before: { status: req.status, parts: myParts(before) }, after: { status: "draft", parts: myParts(after) },
      });
    }
    if (submit) {
      requests.setStatus(req.id, "submitted");
      // обоснование исключения хранится в заявке: его видят руководитель и HR
      requests.setExceptionNote(req.id, check.needsException ? note : null);
      notify([u.managerId], `План на ${year} год ждёт вашего решения: ${fio(u.fullName)}${check.needsException ? " — с запросом исключения" : ""}`, "/team", "request");
      parts.setStatusForRequest(req.id, "pending");
      logAudit({
        actorId: u.id, action: "submit", entity: "request", entityId: req.id,
        before: { status: same ? req.status : "draft" },
        after: { status: "submitted", verdict: check.verdict, ...(check.needsException ? { exception: check.reasons?.exception ?? [], exceptionNote: note } : {}) },
      });
    }
  });
  log.info(submit ? "plan.submitted" : "plan.saved", { employee: u.id, parts: list.length, verdict: check.verdict });
  revalidatePath("/me");
  if (submit) { revalidatePath("/team"); revalidatePath("/hr"); }
  return reply(true, check);
}

/* ---------------- руководитель ---------------- */

/** Очередь руководителя: планы подчинённых по дереву. */
export async function getTeamQueue(year = PLAN_YEAR) {
  const u = await currentUser();
  if (!can(u, "manager") && !can(u, "hr")) throw new AccessDenied();
  const team = employees.subtree(u.id);
  return team.map((e) => {
    const req = requests.forEmployee(e.id, year);
    const list = req ? parts.forRequest(req.id) : [];
    return { employee: e, request: req, parts: list, check: checkPlan(e.id, list) };
  });
}

/** Решение руководителя или HR по части: согласовать / вернуть / отклонить. */
export async function decidePart(partId: number, status: Extract<PartStatus, "approved" | "returned" | "rejected">, comment?: string) {
  const u = await currentUser();
  const p = parts.get(partId);
  if (!p) throw new Error(`Нет части ${partId}`);
  const owner = requests.list(PLAN_YEAR).find((r) => r.id === p.requestId)?.employeeId;
  if (!owner || owner === u.id || !canSeeEmployee(u, owner)) throw new AccessDenied();
  transaction(() => {
    parts.setStatus(partId, status);
    logAudit({ actorId: u.id, action: status, entity: "part", entityId: partId, before: { status: p.status }, after: { status, comment } });
  });
  revalidatePath("/team");
  revalidatePath("/hr");
}
