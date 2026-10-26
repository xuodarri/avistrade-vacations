/**
 * Структурный серверный лог: одна JSON-строка на событие в stdout/stderr.
 * {"ts":"…","level":"info","msg":"…", …поля}
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < MIN) return;
  const rec: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, ...fields };
  if (rec.err instanceof Error) rec.err = { name: rec.err.name, message: rec.err.message, stack: rec.err.stack };
  const line = JSON.stringify(rec);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};
