/**
 * Даты без часовых поясов: внутри — номер дня от 1970-01-01 (как в прототипе на Таблицах),
 * снаружи — строка ISO. Тексты дат — по-русски: «14–20 июня», «28 июня – 12 июля».
 */
import type { DateRange, IsoDate } from './types';

const MS_DAY = 864e5;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dayNum(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m, d) / MS_DAY);
}

export function toDay(iso: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Дата не в формате YYYY-MM-DD: «${iso}»`);
  return dayNum(+m[1], +m[2] - 1, +m[3]);
}

export function isValidIso(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const p = parts(dayNum(+m[1], +m[2] - 1, +m[3]));
  return p.y === +m[1] && p.m === +m[2] - 1 && p.d === +m[3];
}

export function toIso(n: number): IsoDate {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

/** y, месяц с 0, день, день недели с понедельника = 0 */
export function parts(n: number): { y: number; m: number; d: number; wd: number } {
  const t = new Date(n * MS_DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), wd: (t.getUTCDay() + 6) % 7 };
}

export function addDays(iso: IsoDate, k: number): IsoDate {
  return toIso(toDay(iso) + k);
}

export function addMonths(iso: IsoDate, k: number): IsoDate {
  const p = parts(toDay(iso));
  // 31 августа + 6 месяцев = 28 февраля, а не 3 марта
  const last = new Date(Date.UTC(p.y, p.m + k + 1, 0)).getUTCDate();
  return toIso(dayNum(p.y, p.m + k, Math.min(p.d, last)));
}

/** Сколько дней от a до b (b − a) */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toDay(b) - toDay(a);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const k = Math.abs(n) % 100, j = k % 10;
  if (k > 10 && k < 20) return many;
  if (j > 1 && j < 5) return few;
  if (j === 1) return one;
  return many;
}

export function daysText(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/** «5 июля 2027» */
export function dateText(iso: IsoDate, withYear = false): string {
  const p = parts(toDay(iso));
  return `${p.d} ${MONTHS_GEN[p.m]}${withYear ? ' ' + p.y : ''}`;
}

/** «14–20 июня», «28 июня – 12 июля», «3 июля» */
export function rangeText(start: IsoDate, end: IsoDate): string {
  const a = parts(toDay(start)), b = parts(toDay(end));
  if (start === end) return `${a.d} ${MONTHS_GEN[a.m]}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_GEN[b.m]}`;
  return `${a.d} ${MONTHS_GEN[a.m]} – ${b.d} ${MONTHS_GEN[b.m]}`;
}

/** «14–20 июня и 2–5 июля»: каждый отрезок отдельно */
export function rangesText(list: DateRange[]): string {
  const t = list.map((r) => rangeText(r.start, r.end));
  return t.length > 1 ? t.slice(0, -1).join(', ') + ' и ' + t[t.length - 1] : t[0] || '';
}

/** Сплошные отрезки из отсортированного списка номеров дней */
export function runs(days: number[]): DateRange[] {
  const out: DateRange[] = [];
  let s = -1, prev = -1;
  for (const n of days) {
    if (s < 0) s = n;
    else if (n !== prev + 1) { out.push({ start: toIso(s), end: toIso(prev) }); s = n; }
    prev = n;
  }
  if (s >= 0) out.push({ start: toIso(s), end: toIso(prev) });
  return out;
}

export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}
