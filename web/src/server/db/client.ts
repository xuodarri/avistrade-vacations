/**
 * Подключение к SQLite через встроенный `node:sqlite` (Node 24, без нативной сборки).
 * Наружу из `src/server/db` выходят только функции репозиториев (`repo.ts`) — чтобы потом
 * заменить SQLite на Postgres, переписывается только эта папка.
 */
import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { seed } from "./seed";
import { migrate } from "./migrate";
import { log } from "../log";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "vacations.db");

declare global {
  // переживает горячую перезагрузку в dev
  var __vacationsDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA_SQL);
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
  if (!row) {
    tx(db, () => {
      seed(db);
      db.prepare("INSERT INTO meta(key,value) VALUES ('schema_version',?), ('seeded_at',?)")
        .run(String(SCHEMA_VERSION), new Date().toISOString());
    });
    log.info("db.seeded", { path: DB_PATH });
  } else {
    const done = tx(db, () => migrate(db));
    if (done.length) log.info("db.migrated", { path: DB_PATH, done });
  }
  log.info("db.open", { path: DB_PATH, schema: SCHEMA_VERSION });
  return db;
}

/** Заново создать схему и залить демо-данные в открытой базе. */
function reseed(conn: DatabaseSync) {
  conn.exec("PRAGMA foreign_keys = OFF");
  try {
    tx(conn, () => {
      const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      for (const t of tables) conn.exec(`DROP TABLE IF EXISTS "${t.name}"`);
      conn.exec(SCHEMA_SQL);
      seed(conn);
      conn.prepare("INSERT INTO meta(key,value) VALUES ('schema_version',?), ('seeded_at',?)")
        .run(String(SCHEMA_VERSION), new Date().toISOString());
    });
  } finally {
    conn.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Сбросить базу к чистым демо-данным, не останавливая сервер: те же соединение и файл, все таблицы
 * удаляются и создаются заново в одной транзакции (на Windows открытый файл не удалить). Журнал — только история сида.
 */
export function resetDatabase() {
  const conn = db();
  reseed(conn);
  try { conn.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* нестрашно: чекпойнт догонит позже */ }
  log.warn("db.reset", { path: DB_PATH });
}

export function db(): DatabaseSync {
  return (globalThis.__vacationsDb ??= open());
}

/** Транзакция: всё или ничего. */
export function tx<T>(conn: DatabaseSync, fn: () => T): T {
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export const transaction = <T>(fn: () => T) => tx(db(), fn);
