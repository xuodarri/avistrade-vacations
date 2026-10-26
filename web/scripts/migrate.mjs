// Применяет миграции (src/server/db/migrate.ts) к базе, не останавливая dev-сервер.
// Новая база мигрирует сама при открытии; скрипт нужен, когда сервер уже держит соединение.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { migrate } from "../src/server/db/migrate.ts";

const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "vacations.db");
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
db.exec("BEGIN IMMEDIATE");
let done;
try { done = migrate(db); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "db.migrate", path: file, done }));
