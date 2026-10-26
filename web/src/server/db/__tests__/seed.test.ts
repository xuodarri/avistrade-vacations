import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../schema";
import { seed } from "../seed";
import { migrate, R02_TITLE } from "../migrate";

type Row = Record<string, unknown>;

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  seed(db);
  db.prepare("INSERT INTO meta(key,value) VALUES ('schema_version','11')").run();
  return db;
}
const one = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as Row;
const subOf = (db: DatabaseSync, emp: string, no: number) =>
  one(db, `SELECT p.substitute_id s FROM request_parts p JOIN requests r ON r.id=p.request_id
           WHERE r.employee_id=? AND r.year=2027 AND p.part_no=?`, emp, no).s;

describe("сид под видео: люди и сюжет", () => {
  const db = fresh();

  it("13 сотрудников, два отделения, HR — Кузьмич", () => {
    expect(one(db, "SELECT count(*) n FROM employees").n).toBe(13);
    expect((db.prepare("SELECT DISTINCT division d FROM employees ORDER BY 1").all() as Row[]).map((r) => r.d)).toEqual(["Дирекция", "Оптовое отделение"]);
    expect(one(db, "SELECT id FROM employees WHERE is_hr=1").id).toBe("E19");
  });

  it("Иванова: пустой черновик на 2027 год", () => {
    expect(one(db, "SELECT status FROM requests WHERE employee_id='E13' AND year=2027").status).toBe("draft");
    expect(one(db, "SELECT count(*) n FROM request_parts p JOIN requests r ON r.id=p.request_id WHERE r.employee_id='E13'").n).toBe(0);
  });

  it("Петров и Ковалёв согласованы, вдвоём 14–20 июня — для Ивановой мест нет", () => {
    const n = one(db, `SELECT count(DISTINCT r.employee_id) c FROM request_parts p JOIN requests r ON r.id=p.request_id
      WHERE p.status='approved' AND p.start_date <= '2027-06-20' AND p.end_date >= '2027-06-14' AND r.employee_id IN ('E14','E15')`).c;
    expect(n).toBe(2);
  });

  it("у Романовича две заявки: Шумская без обоснования, Лис с запросом исключения; Стельмах — у HR", () => {
    const pend = (db.prepare(`SELECT DISTINCT r.employee_id e, r.exception_note n FROM request_parts p JOIN requests r ON r.id=p.request_id
      WHERE p.status='pending' ORDER BY 1`).all() as Row[]).map((r) => `${r.e}:${r.n ? "исключение" : "чисто"}`);
    expect(pend).toEqual(["E12:исключение", "E16:чисто", "E17:исключение"]);
    expect(String(one(db, "SELECT exception_note n FROM requests WHERE employee_id='E17'").n)).toContain("Путёвка куплена заранее");
    // руководитель Стельмах (Шевчук) уже согласовал обе части — заявка у HR
    expect(one(db, "SELECT count(*) n FROM audit_log WHERE action='manager_approve' AND actor_id='E08'").n).toBe(2);
  });

  it("замещающий в отпуске — только у Лис: её замещает Петров, а он сам в отпуске 9–18 августа", () => {
    expect(subOf(db, "E17", 1)).toBe("E14");
    const clash = db.prepare(`SELECT r.employee_id e, p.part_no n FROM request_parts p JOIN requests r ON r.id=p.request_id
      WHERE r.year=2027 AND p.substitute_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM request_parts q JOIN requests rq ON rq.id=q.request_id
        WHERE rq.employee_id=p.substitute_id AND q.start_date <= p.end_date AND q.end_date >= p.start_date)`).all() as Row[];
    expect(clash.map((c) => `${c.e}#${c.n}`)).toEqual(["E17#1"]);
  });

  it("поздняя заявка Шевчук на сокращение — у HR, подана за 7 дней до начала", () => {
    const rows = db.prepare("SELECT employee_id e, kind, stage, status, requested_on, old_start, manager_by FROM part_changes").all() as Row[];
    expect(rows.map((r) => `${r.e}:${r.kind}:${r.stage}:${r.status}:${r.manager_by}`)).toEqual(["E08:shorten:hr:open:E06"]);
    expect((Date.parse(String(rows[0].old_start)) - Date.parse(String(rows[0].requested_on))) / 86_400_000).toBe(7);
  });

  it("график 2027 по полугодиям — «сбор»; журнал 13 записей, уведомлений 3", () => {
    expect(one(db, "SELECT group_concat(half) h FROM schedules WHERE year=2027 AND status='collecting'").h).toBe("1,2");
    expect(one(db, "SELECT count(*) n FROM audit_log").n).toBe(13);
    expect(one(db, "SELECT count(*) n FROM audit_log WHERE action IN ('change_request','change_manager')").n).toBe(2);
    expect(one(db, "SELECT count(*) n FROM notifications").n).toBe(3);
    expect(one(db, "SELECT count(*) n FROM exceptions").n).toBe(0);
  });

  it("у всех частей отмечено «нужны отпускные» (иначе R18 шумит на каждой части)", () => {
    expect(one(db, "SELECT count(*) n FROM request_parts WHERE needs_pay=0").n).toBe(0);
  });

  it("правила: R02, R14, R15 и нормы ТК на месте", () => {
    const r = Object.fromEntries((db.prepare("SELECT code, title, source, params FROM rules").all() as Row[]).map((x) => [x.code, x]));
    expect(r.R02.title).toBe(R02_TITLE);
    expect(r.R15).toMatchObject({ title: "Замещающий на месте", source: "регламент" });
    expect(JSON.parse(String(r.R15.params)).benefitApplies).toBe(false);
    expect(JSON.parse(String(r.R14.params)).stages).toEqual({ collect: "block", adhoc: "block", inplan: "block" });
    for (const c of ["R00", "R16", "R17", "R18", "R19", "R20"]) expect(r[c]).toBeTruthy();
  });

  it("сверка с регламентом: лето и срок заявки — запрет, лимит МПП по компании, без номеров пунктов", () => {
    const r = Object.fromEntries((db.prepare("SELECT code, severity, params, basis, how_checked FROM rules").all() as Row[]).map((x) => [x.code, x]));
    expect(r.R03.severity).toBe("block");
    expect(JSON.parse(String(r.R03.params)).stages).toEqual({ collect: "block", adhoc: "block", inplan: "block" });
    expect(r.R03.how_checked).toContain("по исключению РО1");
    expect(r.R04.severity).toBe("block");
    expect(JSON.parse(String(r.R04.params)).stages).toEqual({ collect: "block", adhoc: "block", inplan: "off" });
    expect(one(db, "SELECT scope FROM groups WHERE code='sales'").scope).toBe("вся компания");
    const numbered = (t: string) => db.prepare(`SELECT count(*) n FROM ${t} WHERE ${t === "rules" ? "basis" : "reg_clause"} GLOB '*п. [0-9]*'`).get() as Row;
    for (const t of ["rules", "groups", "roles", "role_dependencies"]) expect(numbered(t).n).toBe(0);
  });

  it("одна открытая заявка на часть — уникальный индекс", () => {
    const pid = Number(one(db, "SELECT part_id FROM part_changes").part_id);
    expect(() => db.prepare(`INSERT INTO part_changes(part_id,employee_id,kind,old_start,old_end,status,stage,requested_on,requested_by,created_at)
      VALUES (?,'E08','cancel','2026-11-02','2026-11-12','open','manager','2026-10-26','E08','x')`).run(pid)).toThrow();
  });
});

describe("миграция v1 → v11", () => {
  it("на базе без новых колонок и таблиц догоняет схему, данные частей не теряет; повторный запуск ничего не делает", () => {
    const db = fresh();
    // имитируем базу v1: без колонок, таблиц и правил, добавленных позже
    for (const c of ["substitute_id", "reason", "reason_note", "needs_pay", "treatment_kind"]) db.exec(`ALTER TABLE request_parts DROP COLUMN ${c}`);
    db.exec("DROP TABLE part_changes");
    db.exec("ALTER TABLE requests DROP COLUMN exception_note");
    db.exec("ALTER TABLE employees DROP COLUMN dismissed_on");
    db.exec("ALTER TABLE employees DROP COLUMN benefit_189");
    db.exec("DROP TABLE schedules");
    db.exec("DROP TABLE notifications");
    db.exec("DELETE FROM rules WHERE code IN ('R00','R15','R16','R17','R18','R19','R20')");
    db.exec("UPDATE rules SET title='Кто кого замещает: замещающий на месте' WHERE code='R02'");
    db.exec("UPDATE rules SET severity='warn', basis='Регламент, п. 7' WHERE code='R03'");
    db.exec("UPDATE groups SET scope='отдел', reg_clause='п. 1' WHERE code='sales'");
    db.exec("UPDATE meta SET value='1' WHERE key='schema_version'");
    const parts = one(db, "SELECT count(*) c FROM request_parts").c;

    expect(migrate(db)).toHaveLength(10);
    expect(one(db, "SELECT count(*) c FROM request_parts").c).toBe(parts);
    expect((db.prepare("PRAGMA table_info(request_parts)").all() as Row[]).map((c) => c.name))
      .toEqual(expect.arrayContaining(["substitute_id", "reason", "reason_note", "needs_pay", "treatment_kind"]));
    expect(one(db, "SELECT group_concat(half) h FROM schedules WHERE year=2027 AND status='collecting'").h).toBe("1,2");
    expect(one(db, "SELECT count(*) n FROM rules WHERE code IN ('R18','R19','R20') AND json_extract(params,'$.legalRisk')=1").n).toBe(3);
    expect(one(db, "SELECT title FROM rules WHERE code='R02'").title).toBe(R02_TITLE);
    expect(one(db, "SELECT count(*) n FROM rules WHERE code IN ('R00','R15','R16','R17')").n).toBe(4);
    expect(one(db, "SELECT count(*) n FROM request_parts WHERE substitute_id IS NOT NULL").n).toBeGreaterThan(0);
    expect(one(db, "SELECT severity FROM rules WHERE code='R03'").severity).toBe("block");
    expect(one(db, "SELECT scope FROM groups WHERE code='sales'").scope).toBe("вся компания");
    expect(migrate(db)).toEqual([]);
  });
});
