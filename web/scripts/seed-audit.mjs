// Доливает историю журнала 20–26.10.2026 (src/server/db/seedAudit.ts) в уже созданную базу.
// Новой базе не нужен: сид делает это сам. Повторный запуск ничего не дублирует.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { seedAuditHistory } from "../src/server/db/seedAudit.ts";

const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "vacations.db");
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 5000");
const has = db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='submit' AND at < '2026-10-26'").get();
let added = 0;
if (!has.n) {
  db.exec("BEGIN IMMEDIATE");
  try { added = seedAuditHistory(db); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
}
console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "db.seed-audit", path: file, added, skipped: !!has.n }));
