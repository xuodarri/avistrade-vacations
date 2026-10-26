/** Даты как строки ISO `YYYY-MM-DD`, без часовых поясов: считаем в UTC. */

const DAY = 86_400_000;
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY);

/** Календарные дни части без нерабочих праздников (ст. 151 ч. 2 ТК). Временная версия до движка. */
export function countVacationDays(start: string, end: string, holidays: Set<string>): number {
  let n = 0;
  for (let t = toUtc(start); t <= toUtc(end); t += DAY) if (!holidays.has(fromUtc(t))) n++;
  return n;
}

/** 7 июня 2027 → «7 июня»; с годом — «7 июня 2027». */
export function fmtDate(iso: string, withYear = false) {
  const s = `${+iso.slice(8, 10)} ${MON_GEN[+iso.slice(5, 7) - 1]}`;
  return withYear ? `${s} ${iso.slice(0, 4)}` : s;
}

export function fmtRange(start: string, end: string) {
  return start.slice(5, 7) === end.slice(5, 7)
    ? `${+start.slice(8, 10)}–${fmtDate(end)}`
    : `${fmtDate(start)} — ${fmtDate(end)}`;
}

export function fmtStamp(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", dateStyle: "short", timeStyle: "short" });
}
