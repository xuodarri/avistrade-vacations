/**
 * Схема SQLite. Пишется так, чтобы переносилась на Postgres почти без правок:
 * TEXT для дат ISO, INTEGER 0/1 для флагов, JSON — в TEXT.
 */
import { NOTIFICATIONS_SQL, PART_CHANGES_SQL, SCHEDULES_SQL } from "./migrate";

export const SCHEMA_VERSION = 11; // миграции — migrate.ts


export const SCHEMA_SQL_BASE = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- группа ограничения: «не больше N одновременно» среди коллег той же роли в пределах scope
CREATE TABLE IF NOT EXISTS groups (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role_code      TEXT NOT NULL,
  scope          TEXT NOT NULL,
  max_concurrent INTEGER NOT NULL,
  reg_clause     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roles (
  code           TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  group_id       INTEGER REFERENCES groups(id),
  calendar_group TEXT NOT NULL DEFAULT '',
  reg_clause     TEXT NOT NULL DEFAULT ''
);

-- «role_code уходит, только если requires_role в пределах scope на месте»
CREATE TABLE IF NOT EXISTS role_dependencies (
  id            INTEGER PRIMARY KEY,
  role_code     TEXT NOT NULL REFERENCES roles(code),
  requires_role TEXT NOT NULL REFERENCES roles(code),
  scope         TEXT NOT NULL,
  reg_clause    TEXT NOT NULL DEFAULT '',
  UNIQUE (role_code, requires_role)
);

CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  position    TEXT NOT NULL,
  role_code   TEXT NOT NULL REFERENCES roles(code),
  division    TEXT NOT NULL,
  department  TEXT,
  manager_id  TEXT REFERENCES employees(id),
  hired_on    TEXT NOT NULL,
  base_days   INTEGER NOT NULL DEFAULT 24,
  extra_days  INTEGER NOT NULL DEFAULT 0,
  benefit     TEXT,
  under_18    INTEGER NOT NULL DEFAULT 0,
  ack_on      TEXT,
  is_hr       INTEGER NOT NULL DEFAULT 0,
  dismissed_on TEXT, -- дата увольнения; строку не удаляем, история и журнал остаются
  benefit_189 TEXT   -- категория для обязательного отпуска без сохранения по ст. 189 (код из BENEFITS_189)
);
CREATE INDEX IF NOT EXISTS employees_manager ON employees(manager_id);

CREATE TABLE IF NOT EXISTS rules (
  code        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  params      TEXT NOT NULL DEFAULT '{}',
  enabled     INTEGER NOT NULL DEFAULT 1,
  severity    TEXT NOT NULL CHECK (severity IN ('block','warn','info','off')),
  source      TEXT NOT NULL,
  basis       TEXT NOT NULL DEFAULT '',
  how_checked TEXT NOT NULL DEFAULT ''
);

-- заявка-план сотрудника на год
CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees(id),
  year         INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  submitted_at TEXT,
  updated_at   TEXT NOT NULL,
  exception_note TEXT, -- обоснование сотрудника при отступлении от регламента
  UNIQUE (employee_id, year)
);

-- request_parts: substitute_id — кто замещает (NULL — не указан); needs_pay — нужны отпускные (регламент: отпускные);
-- treatment_kind — hospital | outpatient у планового лечения; reason / reason_note — причина отпуска за свой счёт (код из LEAVE_REASONS) и пояснение. Комментарии вне колонок:
-- SQLite ломается на DROP COLUMN, если внутри определения есть «--».
CREATE TABLE IF NOT EXISTS request_parts (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  part_no     INTEGER NOT NULL,
  type        TEXT NOT NULL DEFAULT 'main',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  days        INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  in_schedule INTEGER NOT NULL DEFAULT 1,
  result      TEXT,
  notes       TEXT,
  substitute_id TEXT REFERENCES employees(id),
  needs_pay   INTEGER NOT NULL DEFAULT 0,
  treatment_kind TEXT,
  reason      TEXT,
  reason_note TEXT
);
CREATE INDEX IF NOT EXISTS parts_request ON request_parts(request_id);
CREATE INDEX IF NOT EXISTS parts_dates ON request_parts(start_date, end_date);

-- журнал исключений HR
CREATE TABLE IF NOT EXISTS exceptions (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES employees(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  part_id     INTEGER REFERENCES request_parts(id) ON DELETE SET NULL,
  rule_code   TEXT NOT NULL REFERENCES rules(code),
  decision    TEXT NOT NULL CHECK (decision IN ('allow','return')),
  reason      TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  actor_id  TEXT,
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  before    TEXT,
  after     TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS holidays (
  date        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  non_working INTEGER NOT NULL DEFAULT 1,
  basis       TEXT NOT NULL DEFAULT ''
);
`;

export const SCHEMA_SQL = SCHEMA_SQL_BASE + PART_CHANGES_SQL + SCHEDULES_SQL + NOTIFICATIONS_SQL;
