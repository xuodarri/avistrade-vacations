// Удаляет файл базы: при следующем запросе приложение создаст схему и заново зальёт демо-данные.
// Dev-сервер держит соединение открытым — остановите его перед сбросом.
import { rmSync } from "node:fs";
import path from "node:path";
const db = process.env.DB_PATH ?? path.join(process.cwd(), "data", "vacations.db");
for (const f of [db, db + "-wal", db + "-shm"]) rmSync(f, { force: true });
console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "db.reset", path: db }));
