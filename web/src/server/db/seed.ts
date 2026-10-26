/**
 * Демо-данные под одну историю для видео (все люди вымышленные). Сюжет: сотрудник, руководитель, РО1 и директор проходят один отпуск от заявки до утверждения графика.
 *
 *  - Иванова E13 (сотрудник): план — пустой черновик, все 24 дня свободны. Петров и Ковалёв уже в согласованном
 *    отпуске 14–20 июня: выделит эти даты — «в группе уже 2 из 2», рядом свободные окна, подача — через исключение.
 *  - Романович E09 (руководитель): в очереди две заявки — Шумская (чистая) и Лис (запрос исключения:
 *    «путёвка куплена заранее»; 9–15 августа третий продажник, а её замещающий Петров сам в отпуске).
 *  - Кузьмич E19 (HR, РО1): почти всё согласовано; ждут HR заявка Стельмах с исключением («без кого не уходит»:
 *    МС склада уходит, пока её НО Шевчук в отпуске) и поздняя заявка Шевчук на сокращение отпуска (R14).
 *  - Соколов E01 (директор): график 2027 по полугодиям — «сбор», утверждается вживую на видео.
 */
import type { DatabaseSync } from "node:sqlite";
import { holidaysOf, vacationDays } from "@/domain/calendar";
import { R02_TITLE, R03_RULE, R04_RULE, R14_RULE, R15_RULE, TK_RULES, assignSubstitutes, REGULATION_RISK_RULES, riskParams } from "./migrate";
import { changeEvents } from "./seedAudit";

const d = (s: string) => (s ? s.split(".").reverse().join("-") : null); // 02.03.2015 → 2015-03-02

// ID, ФИО, Email, Роль, Должность, Отделение, Отдел, руководитель, приём, норма, доп., льгота, ознакомлен, HR
type EmpRow = [string, string, string, string, string, string, string, string, string, number, number, string, string, boolean?];
const EMP: EmpRow[] = [
  ["E01", "Соколов Андрей Викторович", "e01.sokolov@example.com", "ИД", "Исполнительный директор", "Дирекция", "", "", "02.03.2015", 24, 0, "", "12.01.2026"],
  ["E02", "Левченко Ольга Петровна", "e02.levchenko@example.com", "ЗАВ", "Заместитель директора (ЗАВ)", "Дирекция", "", "E01", "19.06.2017", 24, 0, "", "12.01.2026"],
  ["E03", "Гриневич Павел Сергеевич", "e03.grinevich@example.com", "ЗТВ", "Заместитель директора (ЗТВ)", "Дирекция", "", "E01", "05.02.2018", 24, 0, "", "12.01.2026"],
  ["E06", "Бондарь Игорь Николаевич", "e06.bondar@example.com", "РО", "Руководитель отделения", "Оптовое отделение", "", "E03", "21.11.2016", 24, 0, "", "13.01.2026"],
  ["E08", "Шевчук Алла Викторовна", "e08.shevchuk@example.com", "НО", "Начальник отдела", "Оптовое отделение", "склад", "E06", "17.08.2020", 24, 0, "", "14.01.2026"],
  ["E09", "Романович Глеб Юрьевич", "e09.romanovich@example.com", "НО", "Начальник отдела", "Оптовое отделение", "отдел оптовых продаж", "E06", "06.05.2019", 24, 0, "", "14.01.2026"],
  ["E12", "Стельмах Юлия Андреевна", "e12.stelmakh@example.com", "МС", "Менеджер секции", "Оптовое отделение", "склад", "E08", "11.10.2021", 24, 0, "", "15.01.2026"],
  ["E13", "Иванова Анна Сергеевна", "e13.ivanova@example.com", "МПП", "Менеджер по продажам", "Оптовое отделение", "отдел оптовых продаж", "E09", "16.05.2022", 24, 0, "", "16.01.2026"],
  ["E14", "Петров Сергей Иванович", "e14.petrov@example.com", "МПП", "Менеджер по продажам", "Оптовое отделение", "отдел оптовых продаж", "E09", "11.01.2021", 24, 0, "", "16.01.2026"],
  ["E15", "Ковалёв Денис Олегович", "e15.kovalev@example.com", "МПП", "Менеджер по продажам", "Оптовое отделение", "отдел оптовых продаж", "E09", "04.09.2023", 24, 0, "", "16.01.2026"],
  ["E16", "Шумская Елена Владимировна", "e16.shumskaya@example.com", "МПП", "Менеджер по продажам", "Оптовое отделение", "отдел оптовых продаж", "E09", "01.10.2026", 24, 0, "", "02.10.2026"],
  ["E17", "Лис Наталья Петровна", "e17.lis@example.com", "МПП", "Менеджер по продажам", "Оптовое отделение", "отдел оптовых продаж", "E09", "10.03.2020", 24, 0, "", "16.01.2026"],
  ["E19", "Кузьмич Марина Леонидовна", "e19.kuzmich@example.com", "СП", "Специалист по кадрам (HR)", "Дирекция", "отдел кадров", "E01", "14.03.2019", 24, 0, "", "12.01.2026", true],
];

// год, сотрудник, часть, с, по, статус части
type ReqRow = [number, string, number, string, string, string];
const REQ: ReqRow[] = [
  [2027, "E01", 1, "02.08.2027", "15.08.2027", "approved"], [2027, "E01", 2, "13.12.2027", "22.12.2027", "approved"],
  [2027, "E02", 1, "15.03.2027", "28.03.2027", "approved"], [2027, "E02", 2, "13.09.2027", "22.09.2027", "approved"],
  [2027, "E03", 1, "17.05.2027", "30.05.2027", "approved"], [2027, "E03", 2, "04.10.2027", "13.10.2027", "approved"],
  [2027, "E06", 1, "20.06.2027", "04.07.2027", "approved"], [2027, "E06", 2, "08.11.2027", "17.11.2027", "approved"],
  [2027, "E08", 1, "05.07.2027", "18.07.2027", "approved"], [2027, "E08", 2, "22.11.2027", "01.12.2027", "approved"],
  [2027, "E09", 1, "19.07.2027", "01.08.2027", "approved"], [2027, "E09", 2, "18.10.2027", "27.10.2027", "approved"],
  // Стельмах: 12–25 июля, а её НО Шевчук в отпуске 5–18 июля — «без кого не уходит», руководитель согласен, решает HR
  [2027, "E12", 1, "12.07.2027", "25.07.2027", "pending"], [2027, "E12", 2, "20.09.2027", "29.09.2027", "pending"],
  // Петров и Ковалёв: 14–20 июня вдвоём — для Ивановой мест нет; в августе тоже вдвоём
  [2027, "E14", 1, "07.06.2027", "20.06.2027", "approved"], [2027, "E14", 2, "09.08.2027", "18.08.2027", "approved"],
  [2027, "E15", 1, "14.06.2027", "27.06.2027", "approved"], [2027, "E15", 2, "09.08.2027", "18.08.2027", "approved"],
  // Шумская — чистая заявка у руководителя
  [2027, "E16", 1, "06.09.2027", "19.09.2027", "pending"], [2027, "E16", 2, "15.11.2027", "24.11.2027", "pending"],
  // Лис — запрос исключения у руководителя: 9–15 августа третий продажник, замещающий Петров сам в отпуске
  [2027, "E17", 1, "02.08.2027", "15.08.2027", "pending"], [2027, "E17", 2, "06.12.2027", "15.12.2027", "pending"],
  [2027, "E19", 1, "16.08.2027", "29.08.2027", "approved"], [2027, "E19", 2, "20.12.2027", "29.12.2027", "approved"],
  // отпуск Шевчук в этом году — для поздней заявки на сокращение (7 ноября — праздник)
  [2026, "E08", 1, "06.07.2026", "19.07.2026", "approved"], [2026, "E08", 2, "02.11.2026", "12.11.2026", "approved"],
];

/** Когда подан план; у кого план целиком согласован — 20.10. Иванова плана не подавала. */
const SUBMITTED: Record<string, string> = {
  E12: "2026-10-23T08:20:00.000Z", E16: "2026-10-24T13:45:00.000Z", E17: "2026-10-25T09:10:00.000Z",
};
const EXCEPTION_NOTE: Record<string, string> = {
  E12: "Свадьба сестры 17 июля, билеты куплены заранее. На складе эти дни подстрахует кладовщик",
  E17: "Путёвка куплена заранее, ещё в мае, когда график не собирали. Сдвинуть даты без потери денег нельзя",
};

const GROUPS = [
  // code, name, role, scope, limit, что в регламенте (пункты там не пронумерованы)
  // менеджеры по продажам — по всей компании: клиентов перераспределяют между всеми МПП компании
  ["sales", "Менеджеры по продажам", "МПП", "вся компания", 2, "лимит менеджеров по продажам"],
  ["ms", "Менеджеры секций отдела", "МС", "отдел", 1, "кто без кого не уходит"],
  ["no", "Начальники отделов отделения", "НО", "отделение", 1, "кто без кого не уходит"],
  ["ro", "Руководители отделений под одним заместителем", "РО", "тот же руководитель", 1, "кто без кого не уходит"],
] as const;

// роль, название, группа, группа в личном календаре, что в регламенте
const ROLES = [
  ["ИД", "Исполнительный директор", null, "Руководство: ИД, ЗАВ и ЗТВ", "кто без кого не уходит"],
  ["ЗАВ", "Заместитель директора (ЗАВ)", null, "Руководство: ИД и заместители", "кто без кого не уходит"],
  ["ЗТВ", "Заместитель директора (ЗТВ)", null, "Руководство: ИД и заместители", "кто без кого не уходит"],
  ["РО", "Руководитель отделения", "ro", "Руководители отделений и заместитель", "кто без кого не уходит"],
  ["НО", "Начальник отдела", "no", "Начальники отделов и руководитель отделения", "кто без кого не уходит"],
  ["МС", "Менеджер секции", "ms", "Менеджеры секций и начальник отдела", "кто без кого не уходит"],
  ["МПП", "Менеджер по продажам", "sales", "Менеджеры по продажам", "лимит менеджеров по продажам"],
  ["СП", "Специалист", null, "Без ограничений по составу", "—"],
] as const;

// роль уходит, только если requires в пределах scope на месте
const DEPS = [
  ["ИД", "ЗАВ", "вся компания"], ["ИД", "ЗТВ", "вся компания"],
  ["ЗАВ", "ИД", "вся компания"], ["ЗТВ", "ИД", "вся компания"],
  ["РО", "ЗАВ", "свой руководитель"], ["РО", "ЗТВ", "свой руководитель"],
  ["НО", "РО", "отделение"],
  ["МС", "НО", "отдел"],
] as const;

type Sev = "block" | "warn" | "info" | "off";
type RuleTuple = [string, string, number | null, boolean, Sev, Sev, Sev, boolean, string, string, string];
// код, правило, N, включено, сбор, вне графика, в графике, льготникам, источник, основание, как проверяется
const RULES: RuleTuple[] = [
  ["R01", "Лимит одновременно в отпуске среди коллег той же роли", null, true, "block", "block", "warn", false, "регламент",
    "Регламент: лимит одновременно в отпуске; ст. 168 ч. 1 ТК", "Лимит и круг коллег — в группах ограничения. На каждый день части считает коллег с заявками, которые занимают место"],
  ["R02", R02_TITLE, null, true, "block", "block", "warn", false, "регламент",
    "Регламент: кто без кого не уходит; ст. 168 ч. 1 ТК", "Связи — в зависимостях ролей: «уходит, только если … на месте» и в каких пределах"],
  [...R03_RULE] as RuleTuple,
  [...R04_RULE] as RuleTuple,
  ["R05", "Одна из частей не меньше N дней", 14, true, "block", "block", "block", true, "ТК",
    "ст. 174 ч. 1 ТК", "Среди основных частей есть хотя бы одна не короче N календарных дней без праздников"],
  ["R06", "Не больше нормы дней в году", null, true, "block", "block", "block", true, "ТК",
    "ст. 155, 158–162 ТК", "Норма плюс доп. дни сотрудника. Меньше нормы — только пометка «не распределено»"],
  ["R07", "Части заполнены и не пересекаются", null, true, "block", "block", "block", true, "ТК",
    "ст. 151, 174 ТК", "У каждой части есть обе даты, конец не раньше начала, части не накладываются"],
  ["R08", "Праздники в отпуск не входят", null, true, "info", "info", "info", true, "ТК",
    "ст. 151 ч. 2, ст. 147 ч. 1 ТК", "Нерабочие праздники вычитаются, отпуск удлиняется"],
  ["R09", "Первый отпуск не раньше чем через N месяцев работы", 6, true, "warn", "warn", "warn", true, "ТК",
    "ст. 166 ТК", "От даты приёма. Раньше — по соглашению или для категорий ч. 2 ст. 166"],
  ["R10", "Частей не больше N", 3, true, "block", "block", "block", true, "регламент",
    "ст. 174 ч. 1 ТК: больше двух — если разрешает ЛПА", "Число заполненных частей плана"],
  ["R11", "Уведомить работника за N дней до начала", 15, true, "info", "info", "info", true, "ТК",
    "ст. 169 ТК", "Напоминание РО1 по согласованным частям"],
  ["R12", "Обязательный отпуск без сохранения: отказать нельзя", null, true, "info", "info", "info", true, "ТК",
    "ст. 189 ТК", "Для типа «ст. 189» лимит и зависимости ролей не применяются, проверяются только даты"],
  ["R13", "График на календарный год утвердить до 5 января", null, true, "info", "info", "info", true, "ТК",
    "ст. 168 ч. 2 ТК", "Для сбора графика, на заявки не влияет"],
  [...R14_RULE] as RuleTuple,
  [...R15_RULE],
  ...TK_RULES.map((r) => [...r] as RuleTuple),
];

/** Нерабочие праздники 2026–2027 из движка: Указ № 157, Радуница по православной Пасхе. */
export const SAMPLE_HOLIDAYS: [string, string][] = [...holidaysOf(2026), ...holidaysOf(2027)].map((h) => [h.date, h.name]);

const APPROVED_AT = "2026-10-20T07:00:00.000Z";

/** Части по сотруднику и номеру — для журнала и замещающих. */
const partId = (db: DatabaseSync, emp: string, year: number, no: number) =>
  Number((db.prepare(`SELECT p.id FROM request_parts p JOIN requests r ON r.id=p.request_id
    WHERE r.employee_id=? AND r.year=? AND p.part_no=?`).get(emp, year, no) as { id: number }).id);
const requestId = (db: DatabaseSync, emp: string, year: number) =>
  Number((db.prepare("SELECT id FROM requests WHERE employee_id=? AND year=?").get(emp, year) as { id: number }).id);

export function seed(db: DatabaseSync) {
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);

  for (const [date, name] of SAMPLE_HOLIDAYS)
    run("INSERT INTO holidays(date,name,non_working,basis) VALUES (?,?,1,?)", date, name,
      "Указ № 157, ст. 147 ТК; сверено с pravo.by 26.10.2026");

  const groupId = new Map<string, number>();
  for (const [code, name, role, scope, limit, clause] of GROUPS) {
    const r = run("INSERT INTO groups(code,name,role_code,scope,max_concurrent,reg_clause) VALUES (?,?,?,?,?,?)",
      code, name, role, scope, limit, clause);
    groupId.set(code, Number(r.lastInsertRowid));
  }
  for (const [code, title, g, cal, clause] of ROLES)
    run("INSERT INTO roles(code,title,group_id,calendar_group,reg_clause) VALUES (?,?,?,?,?)",
      code, title, g ? groupId.get(g)! : null, cal, clause);
  for (const [role, req, scope] of DEPS)
    run("INSERT INTO role_dependencies(role_code,requires_role,scope,reg_clause) VALUES (?,?,?,?)", role, req, scope, "кто без кого не уходит");

  for (const e of EMP)
    run(`INSERT INTO employees(id,full_name,email,position,role_code,division,department,manager_id,hired_on,
         base_days,extra_days,benefit,under_18,ack_on,is_hr) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      e[0], e[1], e[2], e[4], e[3], e[5], e[6] || null, e[7] || null, d(e[8]), e[9], e[10], e[11] || null, d(e[12]), e[13] ? 1 : 0);

  for (const [code, title, n, en, sCollect, sAdhoc, sIn, benefit, source, basis, how] of RULES)
    run("INSERT INTO rules(code,title,params,enabled,severity,source,basis,how_checked) VALUES (?,?,?,?,?,?,?,?)",
      code, title, JSON.stringify({ value: n, stages: { collect: sCollect, adhoc: sAdhoc, inplan: sIn }, benefitApplies: benefit }),
      en ? 1 : 0, sCollect, source, basis, how);
  for (const r of REGULATION_RISK_RULES)
    run("INSERT INTO rules(code,title,params,enabled,severity,source,basis,how_checked) VALUES (?,?,?,?,?,?,?,?)",
      r[0], r[1], riskParams(r), r[3] ? 1 : 0, r[4], r[8], r[9], r[10]);

  // заявки и части; у Ивановой — пустой черновик на 2027 год
  const byKey = new Map<string, ReqRow[]>();
  for (const r of REQ) byKey.set(`${r[0]}|${r[1]}`, [...(byKey.get(`${r[0]}|${r[1]}`) ?? []), r]);
  for (const [key, list] of byKey) {
    const [yearS, emp] = key.split("|");
    const approved = list.every((p) => p[5] === "approved");
    const sub = SUBMITTED[emp] ?? (Number(yearS) === 2026 ? "2025-12-10T09:00:00.000Z" : "2026-10-19T12:00:00.000Z");
    const r = run("INSERT INTO requests(employee_id,year,status,submitted_at,updated_at,exception_note) VALUES (?,?,?,?,?,?)",
      emp, Number(yearS), approved ? "approved" : "submitted", sub, approved ? APPROVED_AT : sub, EXCEPTION_NOTE[emp] ?? null);
    for (const [, , no, from, to, st] of list) {
      const s = d(from)!, e = d(to)!;
      run(`INSERT INTO request_parts(request_id,part_no,type,start_date,end_date,days,status,in_schedule,needs_pay)
           VALUES (?,?,'main',?,?,?,?,1,1)`, Number(r.lastInsertRowid), no, s, e, vacationDays(s, e), st);
    }
  }
  run("INSERT INTO requests(employee_id,year,status,updated_at) VALUES ('E13',2027,'draft',?)", "2026-10-19T12:00:00.000Z");

  // замещающие: Лис (часть 1) замещает Петров, а он сам в отпуске 9–18 августа; остальным — свободный коллега
  assignSubstitutes(db, { "E17#1": "E14" });

  // поздняя заявка Шевчук: сократить отпуск 2–12 ноября до 2–6 ноября, подана за 7 дней (R14), руководитель согласен
  const p08 = db.prepare("SELECT * FROM request_parts WHERE id=?").get(partId(db, "E08", 2026, 2)) as Record<string, string | number>;
  run(`INSERT INTO part_changes(part_id,employee_id,kind,old_start,old_end,new_start,new_end,reason,note,status,stage,
       requested_on,requested_by,created_at,manager_by,manager_at) VALUES (?,?,?,?,?,?,?,?,?,'open','hr',?,?,?,?,?)`,
    Number(p08.id), "E08", "shorten", String(p08.start_date), String(p08.end_date), "2026-11-02", "2026-11-06", "agreement",
    "Годовая инвентаризация склада сдвинулась на 9 ноября — нужна на месте. Остаток дней возьму в 2027 году",
    "2026-10-26", "E08", "2026-10-26T06:10:00.000Z", "E06", "2026-10-26T08:30:00.000Z");

  // график 2027 по полугодиям — «сбор»; утверждается вживую
  run("INSERT INTO schedules(year,half,status) VALUES (2027,1,'collecting'),(2027,2,'collecting')");

  seedStoryAudit(db);
  seedStoryNotifications(db);
}

/** Журнал: 13 записей за 20–26 октября — та же форма, что пишут серверные функции. */
function seedStoryAudit(db: DatabaseSync) {
  type Ev = { at: string; actor: string; action: string; entity: string; id: string | number; before?: unknown; after?: unknown };
  const pending = { status: "pending", stage: "manager" }, toHr = { status: "pending", stage: "hr" };
  const ev: Ev[] = [
    { at: "2026-10-20T06:40:00.000Z", actor: "E14", action: "submit", entity: "request", id: requestId(db, "E14", 2027), before: { status: "draft" }, after: { status: "submitted", verdict: "ok" } },
    { at: "2026-10-20T07:15:00.000Z", actor: "E15", action: "submit", entity: "request", id: requestId(db, "E15", 2027), before: { status: "draft" }, after: { status: "submitted", verdict: "ok" } },
    { at: "2026-10-21T06:05:00.000Z", actor: "E09", action: "manager_approve", entity: "part", id: partId(db, "E14", 2027, 1), before: pending, after: toHr },
    { at: "2026-10-21T06:06:00.000Z", actor: "E09", action: "manager_approve", entity: "part", id: partId(db, "E15", 2027, 1), before: pending, after: toHr },
    { at: "2026-10-21T11:02:00.000Z", actor: "E19", action: "approve", entity: "part", id: partId(db, "E14", 2027, 1), before: { status: "pending" }, after: { status: "approved", by: "hr" } },
    { at: "2026-10-21T11:03:00.000Z", actor: "E19", action: "approve", entity: "part", id: partId(db, "E15", 2027, 1), before: { status: "pending" }, after: { status: "approved", by: "hr" } },
    { at: SUBMITTED.E12, actor: "E12", action: "submit", entity: "request", id: requestId(db, "E12", 2027), before: { status: "draft" },
      after: { status: "submitted", verdict: "block", exceptionNote: EXCEPTION_NOTE.E12 } },
    { at: SUBMITTED.E16, actor: "E16", action: "submit", entity: "request", id: requestId(db, "E16", 2027), before: { status: "draft" }, after: { status: "submitted", verdict: "ok" } },
    { at: SUBMITTED.E17, actor: "E17", action: "submit", entity: "request", id: requestId(db, "E17", 2027), before: { status: "draft" },
      after: { status: "submitted", verdict: "block", exceptionNote: EXCEPTION_NOTE.E17 } },
    { at: "2026-10-26T06:10:00.000Z", actor: "E08", action: "change_request", entity: "change", id: 0 },
    { at: "2026-10-26T08:30:00.000Z", actor: "E06", action: "change_manager", entity: "change", id: 0 },
    { at: "2026-10-26T09:10:00.000Z", actor: "E08", action: "manager_approve", entity: "part", id: partId(db, "E12", 2027, 1), before: pending, after: toHr },
    { at: "2026-10-26T09:11:00.000Z", actor: "E08", action: "manager_approve", entity: "part", id: partId(db, "E12", 2027, 2), before: pending, after: toHr },
  ];
  // события заявки на изменение — с полной PartChange, как в actions/changes.ts
  const ch = changeEvents(db);
  const ins = db.prepare("INSERT INTO audit_log(at,actor_id,action,entity,entity_id,before,after) VALUES (?,?,?,?,?,?,?)");
  for (const e of ev.sort((a, b) => a.at.localeCompare(b.at))) {
    const c = e.entity === "change" ? ch.find((x) => x.action === e.action) : null;
    const before = c ? c.before : e.before, after = c ? c.after : e.after;
    ins.run(e.at, e.actor, e.action, e.entity, String(c ? c.id : e.id), before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after));
  }
}

/** Уведомления: три непрочитанных — руководителю и HR. */
function seedStoryNotifications(db: DatabaseSync) {
  const ins = db.prepare("INSERT INTO notifications(employee_id,kind,text,href,created_at) VALUES (?,?,?,?,?)");
  ins.run("E09", "request", "Ждут вашего решения 2 заявки: Шумская Е. В. и Лис Н. П. (запрос исключения)", "/team", SUBMITTED.E17);
  ins.run("E19", "request", "Поздняя заявка на сокращение отпуска: Шевчук А. В., 2–12 ноября → 2–6 ноября. Руководитель согласен, подана за 7 дней до начала", "/hr", "2026-10-26T08:30:00.000Z");
  ins.run("E19", "request", "Заявка Стельмах Ю. А. с запросом исключения ждёт решения HR (руководитель согласен)", "/hr", "2026-10-26T09:10:00.000Z");
}
