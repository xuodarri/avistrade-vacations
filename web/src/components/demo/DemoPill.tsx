/**
 * Демо-пилюля в шапке, справа с краю: смена режима (сотрудник, руководитель, HR…), вход под любым сотрудником
 * и сброс демо-данных.
 * Персонажи подбираются по данным базы; подписи — что увидит каждый. Только в демо-сборке (lib/demo.ts).
 */
import { DEMO } from "@/lib/demo";
import { PLAN_YEAR } from "@/lib/config";
import { fmtRange } from "@/lib/dates";
import { changes, employees, parts, requests } from "@/server/db/repo";
import { currentUser, homeFor, accessOf, loginDirectory } from "@/server/session";
import { checkPlan } from "@/server/engine";
import { managerApprovals, shortName } from "@/server/approvals";
import { DemoPillClient, type DemoPerson, type Persona } from "./DemoPillClient";

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}

function personas(): Persona[] {
  const all = employees.listActive();
  const byId = new Map(all.map((e) => [e.id, e]));
  const yearParts = parts.forYear(PLAN_YEAR);
  const partsOf = (id: string) => yearParts.filter((p) => p.employeeId === id);
  const out: Persona[] = [];
  const add = (key: Persona["key"], id: string | undefined, title: string, desc: (id: string) => string) => {
    const e = id ? byId.get(id) : undefined;
    if (!e) return;
    out.push({ key, id: e.id, title, name: e.fullName, short: shortName(e.fullName), position: e.position, desc: desc(e.id), home: homeFor({ access: accessOf(e) }) });
  };

  // сотрудник с запретом по лимиту группы — Иванова
  const conflicted = all.find((e) => e.id === "E13") ?? all.find((e) => checkPlan(e.id, partsOf(e.id)).findings.some((f) => f.ruleCode === "R01" && f.level === "block"));
  add("employee", conflicted?.id, "Сотрудник", (id) => {
    if (!partsOf(id).length) return "план не начат: все дни свободны, 14–20 июня в группе мест нет";
    const limit = checkPlan(id, partsOf(id)).findings.find((f) => f.ruleCode === "R01" && f.level === "block");
    return limit ? "есть запрет по лимиту группы" : "план без запретов";
  });

  // руководитель с самой длинной очередью
  const approvals = managerApprovals();
  const openCh = changes.open("manager");
  const queueOf = (id: string) => {
    const team = new Set(employees.reports(id).map((e) => e.id));
    // заявки, а не части: по человеку с частями у руководителя плюс открытые заявки на изменение
    return new Set(yearParts.filter((p) => team.has(p.employeeId) && p.status === "pending" && !approvals.has(p.id)).map((p) => p.employeeId)).size
      + openCh.filter((c) => team.has(c.employeeId)).length;
  };
  const managers = all.filter((e) => employees.reports(e.id).length && !e.isHr && !["ИД", "ЗАВ", "ЗТВ"].includes(e.roleCode));
  const boss = managers.find((e) => e.id === "E09") ?? managers.sort((a, b) => queueOf(b.id) - queueOf(a.id))[0];
  add("manager", boss?.id, "Руководитель", (id) => { const n = queueOf(id); return n ? `в очереди ${n} ${plural(n, "заявка", "заявки", "заявок")}` : "очередь пуста"; });

  add("hr", all.find((e) => e.isHr)?.id, "HR", () => "график, конфликты, правила, журнал");

  add("director", all.find((e) => e.roleCode === "ИД")?.id, "Директор",
    (id) => `согласует заместителей (${employees.reports(id).length}), свой отпуск — на «Мой отпуск»`);

  add("benefit", all.find((e) => e.benefit)?.id, "Льготник", (id) => `${byId.get(id)!.benefit}: лимиты группы не действуют`);

  // замещающий сам в отпуске (R15): часть, где замещающий занят в эти даты
  const clash = yearParts.find((p) => p.substituteId && p.status !== "rejected" && yearParts.some((q) =>
    q.employeeId === p.substituteId && q.status !== "rejected" && q.startDate <= p.endDate && q.endDate >= p.startDate)
    && p.employeeId !== conflicted?.id);
  add("substitute", clash?.employeeId, "Замещающий в отпуске", () => {
    const sub = byId.get(clash!.substituteId!);
    return `${fmtRange(clash!.startDate, clash!.endDate)} замещает ${sub ? shortName(sub.fullName) : clash!.substituteId}, а он сам в отпуске`;
  });
  void requests;
  return out;
}

export async function DemoPill() {
  if (!DEMO) return null;
  const u = await currentUser();
  const list = personas();
  const fixedToday = process.env.DEMO_TODAY ?? null;
  const dir = loginDirectory();
  const people: DemoPerson[] = [
    ...dir.hr.map((e) => ({ id: e.id, name: e.fullName, position: e.position, group: "HR" })),
    ...dir.manager.map((e) => ({ id: e.id, name: e.fullName, position: e.position, group: "Руководители" })),
    ...dir.employee.map((e) => ({ id: e.id, name: e.fullName, position: e.position, group: "Сотрудники" })),
  ];
  return <DemoPillClient personas={list} people={people} currentId={u.id} currentName={shortName(u.fullName)} fixedToday={fixedToday} />;
}
