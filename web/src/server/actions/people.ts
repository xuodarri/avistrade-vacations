"use server";

/**
 * Экран HR «Сотрудники»: список, карточка, приём и увольнение. HR правит черновик карточки,
 * `previewPerson` показывает последствия (куда уйдут заявки, сколько конфликтов станет),
 * `savePerson` пишет одну строку журнала «было → стало». Увольнение без удаления: человек
 * пропадает из списков выбора, история остаётся.
 */
import { revalidatePath } from "next/cache";
import { PLAN_YEAR } from "@/lib/config";
import { employees, parts, requests, roles } from "../db/repo";
import { transaction } from "../db/client";
import {
  BENEFITS, BENEFITS_189, type AccessKind, type Benefit, type Employee, type RequestStatus, type RoleCode,
} from "../db/types";
import { logAudit } from "../audit";
import { requireAccess } from "../session";
import { managerApprovals, routeStage } from "../approvals";
import { checkDiff, type ConflictItem } from "../hrCheck";
import { personChanges, plural, shortName, type FieldChange } from "@/components/hr-admin/meta";

/** Поля карточки, которые правит HR. У нового сотрудника нет id. */
export interface PersonDraft {
  id?: string;
  fullName: string;
  position: string;
  division: string;
  department: string | null;
  managerId: string | null;
  roleCode: RoleCode;
  isHr: boolean;
  benefit: Benefit | null;
  benefit189: string | null;
  under18: boolean;
  hiredOn: string;
  baseDays: number;
  extraDays: number;
}

export interface Person extends PersonDraft {
  id: string;
  email: string;
  dismissedOn: string | null;
  access: AccessKind[];
  /** Прямых подчинённых среди работающих */
  reports: number;
  managerName: string | null;
  groupName: string | null;
  planStatus: RequestStatus | null;
}

export interface Consequence {
  tone: "info" | "ok" | "warn" | "bad";
  text: string;
}

export interface PersonPreview {
  changes: FieldChange[];
  consequences: Consequence[];
  now: number;
  next: number;
  gone: ConflictItem[];
  added: ConflictItem[];
}

/* ---------------- справочники ---------------- */

const all = () => employees.listAll();
/** Работает: не уволен или уволен с будущей даты (как employees.listActive) */
const active = (list: Employee[]) => { const t = new Date().toISOString().slice(0, 10); return list.filter((e) => !e.dismissedOn || e.dismissedOn > t); };

function lookups(list = all()) {
  const roleList = roles.list();
  const groups = roles.groups();
  const groupOf = (code: RoleCode) => groups.find((g) => g.id === roleList.find((r) => r.code === code)?.groupId)?.name ?? null;
  return {
    name: (id: string | null) => (id ? list.find((e) => e.id === id)?.fullName ?? id : null),
    label189: (code: string | null) => (code ? BENEFITS_189.find((b) => b.code === code)?.label ?? code : null),
    roleTitle: (code: RoleCode) => roleList.find((r) => r.code === code)?.title ?? code,
    groupOf,
  };
}

function toPerson(e: Employee, list: Employee[], plans: Map<string, RequestStatus>, l = lookups(list)): Person {
  const reports = active(list).filter((x) => x.managerId === e.id).length;
  const access: AccessKind[] = ["employee"];
  if (reports) access.push("manager");
  if (e.isHr) access.push("hr");
  return {
    id: e.id, fullName: e.fullName, email: e.email, position: e.position, division: e.division, department: e.department,
    managerId: e.managerId, roleCode: e.roleCode, isHr: e.isHr, benefit: e.benefit, benefit189: e.benefit189 ?? null,
    under18: e.under18, hiredOn: e.hiredOn, baseDays: e.baseDays, extraDays: e.extraDays, dismissedOn: e.dismissedOn ?? null,
    access, reports, managerName: l.name(e.managerId), groupName: l.groupOf(e.roleCode), planStatus: plans.get(e.id) ?? null,
  };
}

function screen() {
  const list = all();
  const plans = new Map(requests.list(PLAN_YEAR).map((r) => [r.employeeId, r.status]));
  const l = lookups(list);
  const units = [...new Map(active(list).map((e) => [`${e.division}|${e.department ?? ""}`, { division: e.division, department: e.department }])).values()]
    .sort((a, b) => a.division.localeCompare(b.division, "ru") || (a.department ?? "").localeCompare(b.department ?? "", "ru"));
  return {
    year: PLAN_YEAR,
    people: list.map((e) => toPerson(e, list, plans, l)),
    roles: roles.list().map((r) => ({ code: r.code, title: r.title, groupName: l.groupOf(r.code) })),
    units,
    benefits: [...BENEFITS],
    benefits189: [...BENEFITS_189],
  };
}

export async function getPeople() {
  const u = await requireAccess("hr");
  return { ...screen(), me: u.id };
}

/* ---------------- проверка черновика ---------------- */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validate(d: PersonDraft, actorId: string, list: Employee[]) {
  if (!d.fullName.trim()) throw new Error("Укажите ФИО");
  if (!d.position.trim()) throw new Error("Укажите должность");
  if (!d.division.trim()) throw new Error("Укажите отделение");
  if (!ISO.test(d.hiredOn)) throw new Error("Укажите дату приёма");
  if (!roles.list().some((r) => r.code === d.roleCode)) throw new Error("Неизвестная роль");
  if (!Number.isInteger(d.baseDays) || d.baseDays < 24 || d.baseDays > 60) throw new Error("Основной отпуск — от 24 до 60 дней");
  if (!Number.isInteger(d.extraDays) || d.extraDays < 0 || d.extraDays > 30) throw new Error("Дополнительных дней — от 0 до 30");
  if (d.benefit && !(BENEFITS as readonly string[]).includes(d.benefit)) throw new Error("Неизвестная льгота");
  if (d.benefit189 && !BENEFITS_189.some((b) => b.code === d.benefit189)) throw new Error("Неизвестная категория по ст. 189");
  if (d.managerId) {
    const m = list.find((e) => e.id === d.managerId);
    if (!m || m.dismissedOn) throw new Error("Руководитель не найден среди работающих");
    if (d.id && d.managerId === d.id) throw new Error("Сотрудник не может быть руководителем сам себе");
    if (d.id && employees.subtree(d.id).some((e) => e.id === d.managerId)) throw new Error("Руководитель — подчинённый этого сотрудника: получится круг");
  }
  const before = d.id ? list.find((e) => e.id === d.id) : null;
  if (before?.isHr && !d.isHr) {
    if (d.id === actorId) throw new Error("Себе доступ HR снять нельзя — попросите другого специалиста HR");
    if (!active(list).some((e) => e.isHr && e.id !== d.id)) throw new Error("Это последний сотрудник с доступом HR");
  }
}

const draftEmployee = (d: PersonDraft, base?: Employee): Employee => ({
  ...(base ?? { id: "NEW", email: "", ackOn: null, dismissedOn: null }),
  ...d, id: d.id ?? "NEW", fullName: d.fullName.trim(), position: d.position.trim(), department: d.department || null,
} as Employee);

/* ---------------- последствия ---------------- */

export async function previewPerson(d: PersonDraft): Promise<PersonPreview> {
  const u = await requireAccess("hr");
  const list = all();
  validate(d, u.id, list);
  const base = d.id ? list.find((e) => e.id === d.id) : undefined;
  const next = draftEmployee(d, base);
  const people = active(list);
  const diff = checkDiff({ employees: base ? people.map((e) => (e.id === base.id ? next : e)) : [...people, next] });
  const l = lookups(list);
  const out: Consequence[] = [];

  if (base && base.managerId !== next.managerId) {
    const req = requests.list(PLAN_YEAR).find((r) => r.employeeId === base.id) ?? null;
    const approvals = managerApprovals();
    const waiting = req ? parts.forRequest(req.id).filter((p) => routeStage(p, req, base.managerId, approvals) === "manager").length : 0;
    const to = next.managerId ? shortName(l.name(next.managerId) ?? "") : null;
    out.push(waiting
      ? { tone: "warn", text: `Сменится руководитель — ${waiting} ${waiting === 1 ? "часть уйдёт" : "части уйдут"} в очередь ${to ?? "РО1: руководителя нет"}` }
      : { tone: "info", text: to ? `Новые заявки пойдут к ${to}` : "Без руководителя заявки пойдут сразу к РО1" });
  }
  if (base && base.roleCode !== next.roleCode) {
    const was = l.groupOf(base.roleCode), will = l.groupOf(next.roleCode);
    if (was !== will) out.push({ tone: "info", text: `Группа лимита: ${was ?? "без группы"} → ${will ?? "без группы"}` });
    const reps = people.filter((e) => e.managerId === base.id).length;
    if (reps) out.push({ tone: "info", text: `Подчинённые (${reps}) остаются за ним — поменять можно в их карточках` });
  }
  if (base && base.isHr !== next.isHr)
    out.push(next.isHr ? { tone: "info", text: "Получит доступ к разделам HR: графику, правилам, журналу" } : { tone: "warn", text: "Потеряет доступ к разделам HR" });
  if (base && base.baseDays + base.extraDays !== next.baseDays + next.extraDays)
    out.push({ tone: "info", text: `Норма отпуска: ${base.baseDays + base.extraDays} → ${next.baseDays + next.extraDays} дней в году` });
  if ((base?.benefit ?? null) !== next.benefit)
    out.push({ tone: "info", text: next.benefit ? "Льгота ч. 4 ст. 168: отпуск в удобное время, лимиты регламента к нему не применяются" : "Лимиты регламента снова будут применяться" });

  const open = (s: typeof diff.now) => s.block + s.warn;
  const delta = open(diff.next) - open(diff.now);
  if (delta > 0) out.push({ tone: "bad", text: `Появится ${delta} ${plural(delta, ["конфликт", "конфликта", "конфликтов"])}` });
  else if (delta < 0) out.push({ tone: "ok", text: `Снимется ${-delta} ${plural(-delta, ["конфликт", "конфликта", "конфликтов"])}` });
  else if (diff.added.length) out.push({ tone: "warn", text: `Конфликтов столько же, но ${diff.added.length} новых` });

  return {
    changes: personChanges(base ? fromEmployee(base) : null, d, l),
    consequences: out, now: open(diff.now), next: open(diff.next), gone: diff.gone, added: diff.added,
  };
}


const fromEmployee = (e: Employee): PersonDraft => ({
  id: e.id, fullName: e.fullName, position: e.position, division: e.division, department: e.department, managerId: e.managerId,
  roleCode: e.roleCode, isHr: e.isHr, benefit: e.benefit, benefit189: e.benefit189 ?? null, under18: e.under18,
  hiredOn: e.hiredOn, baseDays: e.baseDays, extraDays: e.extraDays,
});

/* ---------------- запись ---------------- */

const FIELDS = ["fullName", "position", "division", "department", "managerId", "roleCode", "isHr", "benefit", "benefit189",
  "under18", "hiredOn", "baseDays", "extraDays"] as const;

/** Сохранить карточку: новая — приём, иначе только изменённые поля. Одна строка журнала. */
export async function savePerson(d: PersonDraft) {
  const u = await requireAccess("hr");
  const list = all();
  validate(d, u.id, list);
  const clean = { ...d, fullName: d.fullName.trim(), position: d.position.trim(), department: d.department || null };
  const id = transaction(() => {
    if (!d.id) {
      const { id: _id, ...input } = clean;
      void _id;
      const created = employees.create(input);
      logAudit({ actorId: u.id, action: "create", entity: "employee", entityId: created.id, after: created });
      return created.id;
    }
    const cur = list.find((e) => e.id === d.id);
    if (!cur) throw new Error("Сотрудник не найден");
    const patch = Object.fromEntries(FIELDS.filter((k) => (cur as unknown as Record<string, unknown>)[k] !== clean[k]).map((k) => [k, clean[k]]));
    if (!Object.keys(patch).length) return cur.id;
    const { before, after } = employees.update(cur.id, patch);
    logAudit({ actorId: u.id, action: "update", entity: "employee", entityId: cur.id, before, after });
    return cur.id;
  });
  revalidatePath("/", "layout");
  return { id, ...screen() };
}

/** Уволить: без удаления, с датой. Подчинённых сначала нужно передать другому руководителю. */
export async function dismissPerson(id: string, on: string) {
  const u = await requireAccess("hr");
  const list = all();
  const e = list.find((x) => x.id === id);
  if (!e || e.dismissedOn) throw new Error("Сотрудник не найден среди работающих");
  if (id === u.id) throw new Error("Уволить себя с этого экрана нельзя");
  if (!ISO.test(on)) throw new Error("Укажите дату увольнения");
  const reps = active(list).filter((x) => x.managerId === id);
  if (reps.length) throw new Error(`Сначала назначьте другого руководителя: ${reps.map((x) => shortName(x.fullName)).join(", ")}`);
  if (e.isHr && !active(list).some((x) => x.isHr && x.id !== id)) throw new Error("Это последний сотрудник с доступом HR");
  transaction(() => {
    const { before, after } = employees.dismiss(id, on);
    logAudit({ actorId: u.id, action: "dismiss", entity: "employee", entityId: id, before, after });
  });
  revalidatePath("/", "layout");
  return screen();
}

/** Вернуть уволенного (ошибка ввода или повторный приём). */
export async function restorePerson(id: string) {
  const u = await requireAccess("hr");
  const e = all().find((x) => x.id === id);
  if (!e?.dismissedOn) throw new Error("Сотрудник и так работает");
  transaction(() => {
    const { before, after } = employees.restore(id);
    logAudit({ actorId: u.id, action: "restore", entity: "employee", entityId: id, before, after });
  });
  revalidatePath("/", "layout");
  return screen();
}
