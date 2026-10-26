/**
 * Миграции SQLite по номеру версии в meta.schema_version. Без алиасов `@/`: файл импортирует и
 * `scripts/migrate.mjs`, который применяет миграции к базе, пока dev-сервер держит её открытой.
 *
 * v2 (26.10.2026) — «Кто замещает»: колонка request_parts.substitute_id, замещающие в демо-данных,
 * правило R15 «Замещающий на месте», R02 снова «Кто без кого не уходит».
 * v3 — причина отпуска за свой счёт: request_parts.reason (код из LEAVE_REASONS) и reason_note (свой текст).
 * v4 — изменение согласованного отпуска: таблица part_changes и демо-заявки; requests.exception_note;
 *      правила: R15 льготникам не применяется (ч. 4 ст. 168), R14 — запрет на всех этапах (решает HR
 *      исключением), строки R00, R16, R17 (нормы ТК из движка) для экрана правил.
 * v5 — сотрудники: employees.dismissed_on (увольнение без удаления), employees.benefit_189 (категория по ст. 189).
 * v7 — решение применять пункты регламента об отпускных, полугодовом графике и лечении (противоречат ТК, правила с юридическим риском):
 *      request_parts.needs_pay, вид части «treatment» — плановое лечение, schedules по полугодиям
 *      (ключ год + полугодие, сроки 15.01 и 15.07), правила R18–R20.
 * v10 — тексты R11, R13, R14: исключения и финальную проверку делает РО1; основание R14 — перенос по регламенту.
 * v11 — сверка с регламентом: R03 и R04 — запрет (нужно исключение РО1), лимит МПП — по всей компании,
 *      в основаниях вместо выдуманных номеров пунктов — ссылки по смыслу («Регламент: летний период»).
 * v8 — request_parts.treatment_kind ('hospital' | 'outpatient') у планового лечения; тексты и жёсткость R18–R20 под экран правил.
 * v6 — утверждение графика и оповещения: таблицы schedules и notifications, график 2027 — «сбор», демо-уведомления.
 *      Настройки маршрута (РО1, кто проверяет РО1, кто утверждает график, профсоюз) — ключи meta, см. repo.routeSettings.
 */
import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;
type RuleRow = readonly [string, string, number | null, boolean, string, string, string, boolean, string, string, string];

/**
 * Заявки на изменение согласованной части: перенос, сокращение, отказ (сотрудник, маршрут
 * руководитель → HR) и продление / отзыв (оформляет HR). На одну часть — не больше одной открытой.
 */
/**
 * График отпусков по полугодиям (регламент): сбор → на утверждении → утверждён (или возвращён на доработку).
 * Ключ — год + полугодие. ч. 1–2 ст. 168 ТК (годовой график до 5 января) — юридический риск, см. R19.
 */
export const SCHEDULES_SQL = `
CREATE TABLE IF NOT EXISTS schedules (
  year           INTEGER NOT NULL,
  half           INTEGER NOT NULL DEFAULT 1 CHECK (half IN (1, 2)),
  status         TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting','pending','returned','approved')),
  submitted_by   TEXT REFERENCES employees(id),
  submitted_at   TEXT,
  decided_by     TEXT REFERENCES employees(id),
  decided_at     TEXT,
  comment        TEXT,
  union_date     TEXT,
  union_protocol TEXT,
  PRIMARY KEY (year, half)
);
`;

/** Правила регламента об отпускных, полугодовом графике и лечении — включены, хотя противоречат ТК (params.legalRisk). */
export const REGULATION_RISK_RULES: RuleRow[] = [
  ["R18", "Отпускные — по заявлению, не больше оклада", null, true, "warn", "warn", "warn", true, "регламент",
    "Регламент: отпускные. Противоречит ст. 175–176 ТК: средний заработок выплачивается без заявления, не позднее чем за 2 дня до начала",
    "В заявке отмечено «нужны отпускные»; сумма — не больше оклада"],
  ["R19", "Заявление на полугодие — до 15 января и 15 июля", null, true, "block", "off", "off", true, "регламент",
    "Регламент: график на полугодие. Противоречит ч. 2 ст. 168 ТК: график на календарный год — до 5 января",
    "Часть попадает в полугодие, график которого уже утверждён или срок его сдачи прошёл — нужна договорённость с отделом кадров"],
  ["R20", "Плановое лечение — по правилам отпусков", null, true, "warn", "warn", "warn", true, "регламент",
    "Регламент: плановое лечение. В части лечения противоречит ст. 171 ТК: лечение — временная нетрудоспособность, а не отпуск; данные о здоровье не храним",
    "Лимиты групп и заявка за месяц — как для отпуска; в норму дней не входит. Диагноз не храним"],
];
export const riskParams = (r: RuleRow) => JSON.stringify({ value: r[2], stages: { collect: r[4], adhoc: r[5], inplan: r[6] }, benefitApplies: r[7], legalRisk: true, legalNote: r[9],
  ...(r[0] === "R19" ? { h1Month: 1, h1Day: 15, h2Month: 7, h2Day: 15 } : {}) });

/** Уведомления в приложении (писем не шлём): кому, текст, ссылка, когда, прочитано. */
export const NOTIFICATIONS_SQL = `
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  kind        TEXT NOT NULL DEFAULT 'info',
  text        TEXT NOT NULL,
  href        TEXT,
  created_at  TEXT NOT NULL,
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(employee_id, read_at);
`;

/**
 * Демо-данные v6 (идемпотентно): график 2027 — «сбор»; несколько уведомлений по событиям демо.
 * Время — как у событий в журнале.
 */
export function seedSchedulesAndNotifications(db: DatabaseSync) {
  db.prepare("INSERT INTO schedules(year,half,status) VALUES (2027,1,'collecting'),(2027,2,'collecting') ON CONFLICT(year,half) DO NOTHING").run();
  if ((db.prepare("SELECT count(*) AS n FROM notifications").get() as Row).n) return;
  const exists = (id: string) => !!db.prepare("SELECT 1 FROM employees WHERE id=?").get(id);
  const ins = db.prepare("INSERT INTO notifications(employee_id,kind,text,href,created_at,read_at) VALUES (?,?,?,?,?,?)");
  const rows: [string, string, string, string, string, string | null][] = [
    ["E15", "decision", "Часть 7–20 июня возвращена руководителем (Романович Г. Ю.): «7–20 июня уже уходят Петров и Иванова, третий МПП не проходит по лимиту. Сдвиньте на неделю»", "/me", "2026-10-21T08:20:00.000Z", "2026-10-21T09:02:00.000Z"],
    ["E09", "request", "Заявка на перенос: Петров С. И. — отпуск 7–20 июня на 5–18 июля", "/team", "2026-10-24T07:40:00.000Z", null],
    ["E19", "request", "Заявка Жук Т. М. на сокращение отпуска 2–12 ноября до 2–8 ноября ждёт решения HR (руководитель согласен). Подана за 7 дней до начала", "/hr", "2026-10-26T08:30:00.000Z", null],
    ["E18", "decision", "Руководитель согласовал вашу заявку на сокращение отпуска, решение — за отделом кадров", "/me", "2026-10-26T08:30:00.000Z", null],
    ["E20", "reminder", "Отправьте план отпусков на 2027 год до 15 декабря: ваш руководитель и отдел кадров пока не видят ваших дат", "/me", "2026-10-26T07:00:00.000Z", null],
    ["E17", "reminder", "Ваш план на 2027 год — черновик. Отправьте его руководителю до 15 декабря", "/me", "2026-10-26T07:00:00.000Z", null],
  ];
  for (const r of rows) if (exists(r[0])) ins.run(...r);
}

export const PART_CHANGES_SQL = `
CREATE TABLE IF NOT EXISTS part_changes (
  id            INTEGER PRIMARY KEY,
  part_id       INTEGER NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('move','shorten','cancel','extend','recall')),
  old_start     TEXT NOT NULL,
  old_end       TEXT NOT NULL,
  new_start     TEXT,
  new_end       TEXT,
  reason        TEXT NOT NULL DEFAULT 'agreement',
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','returned','withdrawn')),
  stage         TEXT NOT NULL DEFAULT 'manager' CHECK (stage IN ('manager','hr')),
  requested_on  TEXT NOT NULL,
  requested_by  TEXT NOT NULL REFERENCES employees(id),
  created_at    TEXT NOT NULL,
  manager_by    TEXT REFERENCES employees(id),
  manager_at    TEXT,
  decided_by    TEXT REFERENCES employees(id),
  decided_at    TEXT,
  decision_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS part_changes_one_open ON part_changes(part_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS part_changes_employee ON part_changes(employee_id);
`;


export const R02_TITLE = "Кто без кого не уходит";

/** Правило R15 в формате сида: код, название, N, включено, сбор, вне графика, в графике, льготникам, источник, основание, как проверяется. */
export const R15_RULE = [
  "R15", "Замещающий на месте", null, true, "block", "block", "warn", false, "регламент",
  "Регламент: в заявлении на отпуск указывается замещающий",
  "У каждой части указан замещающий, и в эти даты он сам не в отпуске. Не указан — предупреждение",
] as const;


/**
 * R03, R04 — как в регламенте: летом не больше 14 дней, заявление не менее чем за месяц. Запрет регламента —
 * «нужно исключение РО1». Юридический риск (ч. 1 ст. 174, ч. 4 ст. 168, ст. 169 ТК) HR видит на экране правил.
 */
export const R03_RULE: RuleRow = ["R03", "Летом (1 июня — 31 августа) не больше N дней", 14, true, "block", "block", "block", false, "регламент",
  "Регламент: летний период", "Дни части в летних месяцах без праздников. Летом — не больше 14 дней. Больше — по исключению РО1"];
export const R04_RULE: RuleRow = ["R04", "Заявка не позднее чем за N дней до начала", 30, true, "block", "block", "off", true, "регламент",
  "Регламент: заявление за месяц; ст. 169 ТК", "От сегодняшнего дня до первого дня части. К ст. 186 и 189 по смыслу не применяется"];

/** R14 — запрет на всех этапах: перенос позже чем за 14 дней возможен только исключением РО1. */
export const R14_RULE: RuleRow = ["R14", "Перенос части — не позднее чем за N дней до начала", 14, true, "block", "block", "block", true, "регламент",
  "Регламент: перенос; ч. 1 ст. 171 ТК", "От даты заявки на перенос до первого дня части, которую переносят. Позже — только исключением РО1"];

/** Нормы ТК, которые проверяет движок; строки нужны, чтобы HR видел их на экране правил. */
export const TK_RULES: RuleRow[] = [
  ["R00", "Даты не в прошлом", 1, true, "block", "block", "block", true, "ТК",
    "ст. 168, 174 ТК", "Первый день части — не раньше чем через N дней от сегодняшнего: отпуск задним числом не оформляется"],
  ["R16", "За свой счёт по ст. 190 — не больше N дней в году", 30, true, "block", "block", "block", true, "ТК",
    "ст. 190 ТК", "Сумма дней отпуска без сохранения зарплаты по ст. 190 за год; больше — только по коллективному договору, не свыше 3 месяцев"],
  ["R17", "Обязательный за свой счёт по ст. 189 — не больше N дней в году", 14, true, "warn", "warn", "warn", true, "ТК",
    "ст. 189 ТК", "Дни отпуска по ст. 189 за год; больше — по соглашению сторон"],
];

const ruleParams = (r: RuleRow) => JSON.stringify({ value: r[2], stages: { collect: r[4], adhoc: r[5], inplan: r[6] }, benefitApplies: r[7] });

/**
 * Демо-заявки на перенос (идемпотентно):
 * 1) у Петрова E14 часть 1 (7–20 июня, согласована) — перенос на 5–18 июля, ждёт руководителя Романовича E09:
 *    если согласуют, уйдёт и июньский конфликт трёх МПП у Ивановой;
 * 2) у Жук E18 в 2026 году отпуск 6–19 июля (14 дней) и 2–12 ноября (10, 7 ноября — праздник); 26.10 она просит
 *    сократить ноябрьскую часть до 2–8 ноября — меньше чем за 14 дней до начала (R14), руководитель E01
 *    согласовал, решение за HR — только исключением. Июльская часть нужна, чтобы оставалась часть от 14 дней.
 */
export function seedPartChanges(db: DatabaseSync) {
  const partOf = (emp: string, year: number, no: number) => db.prepare(`SELECT p.* FROM request_parts p JOIN requests r ON r.id=p.request_id
    WHERE r.employee_id=? AND r.year=? AND p.part_no=?`).get(emp, year, no) as Row | undefined;
  ensureE18Year2026(db);
  if ((db.prepare("SELECT count(*) AS n FROM part_changes").get() as Row).n) return;
  const ins = db.prepare(`INSERT INTO part_changes(part_id,employee_id,kind,old_start,old_end,new_start,new_end,reason,note,status,stage,
    requested_on,requested_by,created_at,manager_by,manager_at) VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?)`);

  // старые базы (до сида под видео): в новом сиде этих сюжетов нет
  if (!db.prepare("SELECT 1 FROM employees WHERE id='E18'").get()) return;
  const p14 = partOf("E14", 2027, 1);
  if (p14 && p14.status === "approved")
    ins.run(Number(p14.id), "E14", "move", String(p14.start_date), String(p14.end_date), "2027-07-05", "2027-07-18", "agreement",
      "Семейные обстоятельства: в июне не получается. С Романовичем обсудили, июль для отдела свободнее",
      "manager", "2026-10-24", "E14", "2026-10-24T07:40:00.000Z", null, null);

  const p18 = partOf("E18", 2026, 2);
  if (p18)
    ins.run(Number(p18.id), "E18", "shorten", String(p18.start_date), String(p18.end_date), "2026-11-02", "2026-11-08", "agreement",
      "Квартальная отчётность: со второй недели нужна на месте. Оставшиеся дни возьму в 2027 году",
      "hr", "2026-10-26", "E18", "2026-10-26T06:10:00.000Z", "E01", "2026-10-26T08:30:00.000Z");
}

/** План Жук E18 на 2026 год (согласован): 6–19 июля и 2–12 ноября; старые базы догоняются (было 2–15 ноября одной частью). */
export function ensureE18Year2026(db: DatabaseSync) {
  if (!db.prepare("SELECT 1 FROM employees WHERE id='E18'").get()) return; // в новом сиде Жук нет
  let req = db.prepare("SELECT id FROM requests WHERE employee_id='E18' AND year=2026").get() as Row | undefined;
  if (!req) {
    const r = db.prepare(`INSERT INTO requests(employee_id,year,status,submitted_at,updated_at) VALUES ('E18',2026,'approved',?,?)`)
      .run("2025-12-10T09:00:00.000Z", "2025-12-20T09:00:00.000Z");
    req = { id: Number(r.lastInsertRowid) };
  }
  const id = Number(req.id);
  const nov = db.prepare("SELECT * FROM request_parts WHERE request_id=? AND start_date='2026-11-02'").get(id) as Row | undefined;
  if (nov) db.prepare("UPDATE request_parts SET part_no=2, end_date='2026-11-12', days=10 WHERE id=?").run(Number(nov.id));
  else db.prepare(`INSERT INTO request_parts(request_id,part_no,type,start_date,end_date,days,status,in_schedule,substitute_id)
    VALUES (?,2,'main','2026-11-02','2026-11-12',10,'approved',1,'E19')`).run(id);
  if (!db.prepare("SELECT 1 FROM request_parts WHERE request_id=? AND start_date='2026-07-06'").get(id))
    db.prepare(`INSERT INTO request_parts(request_id,part_no,type,start_date,end_date,days,status,in_schedule,substitute_id)
      VALUES (?,1,'main','2026-07-06','2026-07-19',14,'approved',1,'E19')`).run(id);
  // заявка на сокращение ноябрьской части: «было» — 2–12 ноября
  db.prepare("UPDATE part_changes SET old_end='2026-11-12' WHERE employee_id='E18' AND old_start='2026-11-02' AND status='open'").run();
}

/**
 * Демо-случаи: у E15 часть 2 замещающий не указан; замещающий сам в отпуске (запрет R15) —
 * у E12 часть 2 (29.11–07.12, замещает E10, он в отпуске 6–15.12) для HR и у Ивановой E13 часть 2
 * (13–22.09, замещает Петров E14, он в отпуске 15–24.09) для руководителя E09 на /team.
 * Остальным замещающий подбирается автоматически.
 */
const LEGACY_OVERRIDES: Record<string, string | null> = { "E15#2": null, "E12#2": "E10", "E13#2": "E14" };

/** Уровень роли: замещает тот, кто ближе по уровню. */
const RANK: Record<string, number> = { "ИД": 0, "ЗАВ": 1, "ЗТВ": 1, "РО": 2, "НО": 3, "МС": 4, "МПП": 5, "СП": 5 };

/** Проставить замещающих частям, у которых его нет: коллега из того же отдела, свободный в эти даты. */
export function assignSubstitutes(db: DatabaseSync, overrides: Record<string, string | null> = LEGACY_OVERRIDES) {
  const emps = db.prepare("SELECT id, role_code, division, department, manager_id FROM employees ORDER BY id").all() as Row[];
  const OVERRIDES = Object.fromEntries(Object.entries(overrides).filter(([k, v]) =>
    emps.some((e) => e.id === k.split("#")[0]) && (v === null || emps.some((e) => e.id === v))));
  const partsAll = db.prepare(`SELECT p.id, p.part_no, p.start_date, p.end_date, p.status, p.substitute_id, r.employee_id
                               FROM request_parts p JOIN requests r ON r.id = p.request_id`).all() as Row[];
  const busy = (empId: string, from: string, to: string) =>
    partsAll.some((p) => p.employee_id === empId && p.status !== "rejected" && String(p.start_date) <= to && String(p.end_date) >= from);
  const upd = db.prepare("UPDATE request_parts SET substitute_id = ? WHERE id = ?");

  for (const p of partsAll) {
    if (p.substitute_id) continue;
    const key = `${p.employee_id}#${p.part_no}`;
    if (key in OVERRIDES) {
      if (OVERRIDES[key]) upd.run(OVERRIDES[key], Number(p.id));
      continue;
    }
    const me = emps.find((e) => e.id === p.employee_id);
    if (!me) continue;
    // кандидаты: своё отделение, свои подчинённые и свой руководитель; ближе по уровню и из своего отдела — раньше
    const score = (e: Row) => Math.abs(RANK[String(e.role_code)] - RANK[String(me.role_code)])
      + (e.department != null && e.department === me.department ? 0 : 0.5) + (e.role_code === me.role_code ? -0.5 : 0);
    const cands = emps
      .filter((e) => e.id !== me.id && (e.division === me.division || e.manager_id === me.id || e.id === me.manager_id))
      .sort((x, y) => score(x) - score(y) || String(x.id).localeCompare(String(y.id)));
    const from = String(p.start_date), to = String(p.end_date);
    const pick = cands.find((e) => !busy(String(e.id), from, to));
    if (pick) upd.run(String(pick.id), Number(p.id));
  }
}

const version = (db: DatabaseSync) =>
  Number((db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as Row | undefined)?.value ?? 0);

/** Применить недостающие миграции. Вызывать в транзакции. Возвращает список применённых. */
export function migrate(db: DatabaseSync): string[] {
  const done: string[] = [];
  if (version(db) < 2) {
    const cols = db.prepare("PRAGMA table_info(request_parts)").all() as Row[];
    if (!cols.some((c) => c.name === "substitute_id"))
      db.exec("ALTER TABLE request_parts ADD COLUMN substitute_id TEXT REFERENCES employees(id)");
    assignSubstitutes(db);
    const [code, title, n, en, sCollect, sAdhoc, sIn, benefit, source, basis, how] = R15_RULE;
    db.prepare(`INSERT INTO rules(code,title,params,enabled,severity,source,basis,how_checked) VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(code) DO NOTHING`)
      .run(code, title, JSON.stringify({ value: n, stages: { collect: sCollect, adhoc: sAdhoc, inplan: sIn }, benefitApplies: benefit }),
        en ? 1 : 0, sCollect, source, basis, how);
    db.prepare("UPDATE rules SET title = ? WHERE code = 'R02'").run(R02_TITLE);
    db.prepare("INSERT INTO meta(key,value) VALUES ('schema_version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    done.push("v2: substitute_id, R15, R02");
  }
  if (version(db) < 3) {
    const cols = (db.prepare("PRAGMA table_info(request_parts)").all() as Row[]).map((c) => c.name);
    if (!cols.includes("reason")) db.exec("ALTER TABLE request_parts ADD COLUMN reason TEXT");
    if (!cols.includes("reason_note")) db.exec("ALTER TABLE request_parts ADD COLUMN reason_note TEXT");
    db.prepare("UPDATE meta SET value='3' WHERE key='schema_version'").run();
    done.push("v3: reason, reason_note");
  }
  if (version(db) < 4) {
    db.exec(PART_CHANGES_SQL);
    const rcols = (db.prepare("PRAGMA table_info(requests)").all() as Row[]).map((c) => c.name);
    if (!rcols.includes("exception_note")) db.exec("ALTER TABLE requests ADD COLUMN exception_note TEXT");
    const upd = db.prepare("UPDATE rules SET params=?, severity=?, how_checked=? WHERE code=?");
    upd.run(ruleParams(R15_RULE as unknown as RuleRow), R15_RULE[4], R15_RULE[10], "R15");
    upd.run(ruleParams(R14_RULE), R14_RULE[4], R14_RULE[10], "R14");
    const insRule = db.prepare(`INSERT INTO rules(code,title,params,enabled,severity,source,basis,how_checked) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(code) DO NOTHING`);
    for (const r of TK_RULES) insRule.run(r[0], r[1], ruleParams(r), r[3] ? 1 : 0, r[4], r[8], r[9], r[10]);
    seedPartChanges(db);
    db.prepare("UPDATE meta SET value='4' WHERE key='schema_version'").run();
    done.push("v4: part_changes, exception_note, R14/R15, R00/R16/R17");
  }
  if (version(db) < 5) {
    const ecols = (db.prepare("PRAGMA table_info(employees)").all() as Row[]).map((c) => c.name);
    if (!ecols.includes("dismissed_on")) db.exec("ALTER TABLE employees ADD COLUMN dismissed_on TEXT");
    if (!ecols.includes("benefit_189")) db.exec("ALTER TABLE employees ADD COLUMN benefit_189 TEXT");
    db.prepare("UPDATE meta SET value='5' WHERE key='schema_version'").run();
    done.push("v5: dismissed_on, benefit_189");
  }
  if (version(db) < 6) {
    db.exec(SCHEDULES_SQL);
    db.exec(NOTIFICATIONS_SQL);
    seedSchedulesAndNotifications(db);
    db.prepare("UPDATE meta SET value='6' WHERE key='schema_version'").run();
    done.push("v6: schedules, notifications");
  }
  if (version(db) < 7) {
    const pcols = (db.prepare("PRAGMA table_info(request_parts)").all() as Row[]).map((c) => c.name);
    if (!pcols.includes("needs_pay")) db.exec("ALTER TABLE request_parts ADD COLUMN needs_pay INTEGER NOT NULL DEFAULT 0");
    const scols = (db.prepare("PRAGMA table_info(schedules)").all() as Row[]).map((c) => c.name);
    if (!scols.includes("half")) {
      // ключ меняется на (год, полугодие): пересоздаём таблицу, годовую строку копируем в оба полугодия
      db.exec("ALTER TABLE schedules RENAME TO schedules_v6");
      db.exec(SCHEDULES_SQL);
      db.exec(`INSERT INTO schedules(year,half,status,submitted_by,submitted_at,decided_by,decided_at,comment,union_date,union_protocol)
        SELECT year,h.half,status,submitted_by,submitted_at,decided_by,decided_at,comment,union_date,union_protocol
        FROM schedules_v6, (SELECT 1 AS half UNION ALL SELECT 2) h`);
      db.exec("DROP TABLE schedules_v6");
    }
    db.prepare("INSERT INTO schedules(year,half,status) VALUES (2027,1,'collecting'),(2027,2,'collecting') ON CONFLICT(year,half) DO NOTHING").run();
    const insRule = db.prepare(`INSERT INTO rules(code,title,params,enabled,severity,source,basis,how_checked) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(code) DO NOTHING`);
    for (const r of REGULATION_RISK_RULES) insRule.run(r[0], r[1], riskParams(r), r[3] ? 1 : 0, r[4], r[8], r[9], r[10]);
    db.prepare("UPDATE meta SET value='7' WHERE key='schema_version'").run();
    done.push("v7: needs_pay, treatment, schedules by half, R18–R20");
  }
  if (version(db) < 8) {
    const pcols = (db.prepare("PRAGMA table_info(request_parts)").all() as Row[]).map((c) => c.name);
    if (!pcols.includes("treatment_kind")) db.exec("ALTER TABLE request_parts ADD COLUMN treatment_kind TEXT");
    const upd = db.prepare("UPDATE rules SET title=?, params=?, severity=?, basis=?, how_checked=? WHERE code=?");
    for (const r of REGULATION_RISK_RULES) upd.run(r[1], riskParams(r), r[4], r[9], r[10], r[0]);
    db.prepare("UPDATE meta SET value='8' WHERE key='schema_version'").run();
    done.push("v8: treatment_kind, R18–R20 по договорённости с экраном правил");
  }
  if (version(db) < 9) {
    // R19 под движок (halfYearDeadline): сбор графика — запрет, вне графика и в графике — не применяется
    const r = REGULATION_RISK_RULES.find((x) => x[0] === "R19")!;
    db.prepare("UPDATE rules SET title=?, params=?, severity=? WHERE code='R19'").run(r[1], riskParams(r), r[4]);
    db.prepare("UPDATE meta SET value='9' WHERE key='schema_version'").run();
    done.push("v9: R19 под движок");
  }
  if (version(db) < 10) {
    // тексты: исключения и финальную проверку делает РО1; R14 — перенос по регламенту
    const upd = db.prepare("UPDATE rules SET how_checked=? WHERE code=?");
    db.prepare("UPDATE rules SET basis=?, how_checked=? WHERE code='R14'").run(R14_RULE[9], R14_RULE[10]);
    upd.run("Напоминание РО1 по согласованным частям", "R11");
    upd.run("Для сбора графика, на заявки не влияет", "R13");
    db.prepare("UPDATE meta SET value='10' WHERE key='schema_version'").run();
    done.push("v10: тексты R11, R13, R14");
  }
  if (version(db) < 11) {
    const upd = db.prepare("UPDATE rules SET params=?, severity=?, basis=?, how_checked=? WHERE code=?");
    for (const r of [R03_RULE, R04_RULE, R14_RULE]) upd.run(ruleParams(r), r[4], r[9], r[10], r[0]);
    for (const r of REGULATION_RISK_RULES) upd.run(riskParams(r), r[4], r[9], r[10], r[0]);
    const basis = db.prepare("UPDATE rules SET basis=? WHERE code=?");
    basis.run("Регламент: лимит одновременно в отпуске; ст. 168 ч. 1 ТК", "R01");
    basis.run("Регламент: кто без кого не уходит; ст. 168 ч. 1 ТК", "R02");
    db.prepare("UPDATE groups SET scope='вся компания', reg_clause='лимит менеджеров по продажам' WHERE code='sales'").run();
    db.prepare("UPDATE groups SET reg_clause='кто без кого не уходит' WHERE reg_clause='п. 2'").run();
    db.prepare("UPDATE roles SET reg_clause='кто без кого не уходит' WHERE reg_clause='п. 2'").run();
    db.prepare("UPDATE roles SET reg_clause='лимит менеджеров по продажам' WHERE reg_clause='п. 1'").run();
    db.prepare("UPDATE role_dependencies SET reg_clause='кто без кого не уходит' WHERE reg_clause='п. 2'").run();
    db.prepare("UPDATE meta SET value='11' WHERE key='schema_version'").run();
    done.push("v11: R03/R04 — запрет, лимит МПП по компании, основания без номеров пунктов");
  }
  return done;
}
