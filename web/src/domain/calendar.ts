/**
 * Производственный календарь РБ: нерабочие праздники, переносы рабочих дней, подсчёт дней отпуска.
 *
 * Нерабочие праздники — перечень, объявленный нерабочим Указом Президента РБ от 26.03.1998 № 157
 * «О государственных праздниках, праздничных днях и памятных датах в Республике Беларусь»
 * (сверено с pravo.by/gosudarstvo-i-pravo/gosudarstvennye-prazdniki/ 26.10.2026).
 * Праздник, выпавший на выходной, в Беларуси на другой день не переносится.
 *
 * Переносы рабочих дней 2027 — постановление Совета Министров РБ от 03.10.2026 № 499
 * «О переносе рабочего дня в 2027 году»: понедельник 10 мая — выходной, суббота 8 мая — рабочая.
 * Выходной от переноса праздником не становится и в число дней отпуска входит (ст. 151 ТК).
 */
import { dayNum, parts, toDay, toIso } from './dates';
import type { IsoDate } from './types';

export interface Holiday {
  date: IsoDate;
  name: string;
}

const FIXED: [number, number, string][] = [
  [0, 1, 'Новый год'],
  [0, 2, 'Новый год'],
  [0, 7, 'Рождество Христово (православное)'],
  [2, 8, 'День женщин'],
  [4, 1, 'Праздник труда'],
  [4, 9, 'День Победы'],
  [6, 3, 'День Независимости'],
  [10, 7, 'День Октябрьской революции'],
  [11, 25, 'Рождество Христово (католическое)'],
];

/** Переносы рабочих дней: true — день стал рабочим, false — выходным */
export const WORKDAY_TRANSFERS: Record<IsoDate, boolean> = {
  '2027-05-08': true,
  '2027-05-10': false,
};

/** Православная Пасха (алгоритм Меёса для юлианского календаря + разница стилей 13 дней, 1900–2099) */
export function orthodoxEaster(year: number): IsoDate {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return toIso(dayNum(year, month - 1, day) + 13);
}

/** Радуница — вторник второй недели после Пасхи, Пасха + 9 дней. В 2027 году — 11 мая. */
export function radunitsa(year: number): IsoDate {
  return toIso(toDay(orthodoxEaster(year)) + 9);
}

const cache = new Map<number, Map<number, string>>();

function yearHolidays(year: number): Map<number, string> {
  let map = cache.get(year);
  if (!map) {
    map = new Map();
    for (const [m, d, name] of FIXED) map.set(dayNum(year, m, d), name);
    map.set(toDay(radunitsa(year)), 'Радуница');
    cache.set(year, map);
  }
  return map;
}

export function holidaysOf(year: number): Holiday[] {
  return [...yearHolidays(year).entries()].sort((a, b) => a[0] - b[0]).map(([n, name]) => ({ date: toIso(n), name }));
}

/** Название праздника по номеру дня или undefined */
export function holidayAt(n: number): string | undefined {
  return yearHolidays(parts(n).y).get(n);
}

export function isHoliday(date: IsoDate): boolean {
  return holidayAt(toDay(date)) !== undefined;
}

export function isWorkingDay(date: IsoDate): boolean {
  if (date in WORKDAY_TRANSFERS) return WORKDAY_TRANSFERS[date];
  return parts(toDay(date)).wd < 5 && !isHoliday(date);
}

/** Праздники внутри отрезка */
export function holidaysBetween(start: IsoDate, end: IsoDate): Holiday[] {
  const out: Holiday[] = [];
  for (let n = toDay(start); n <= toDay(end); n++) {
    const name = holidayAt(n);
    if (name) out.push({ date: toIso(n), name });
  }
  return out;
}

/** Дней отпуска в отрезке: календарные дни минус нерабочие праздники (ст. 151 ч. 2 ТК) */
export function vacationDays(start: IsoDate, end: IsoDate): number {
  const a = toDay(start), b = toDay(end);
  if (b < a) return 0;
  return b - a + 1 - holidaysBetween(start, end).length;
}

/** Последний день отпуска длиной days с даты start: праздник внутри отпуска сдвигает конец */
export function vacationEnd(start: IsoDate, days: number): IsoDate {
  let n = toDay(start), k = 0;
  for (;;) {
    if (!holidayAt(n)) k++;
    if (k >= days) return toIso(n);
    n++;
  }
}

/** Лето по регламенту — 1 июня — 31 августа */
export function isSummer(date: IsoDate): boolean {
  const m = parts(toDay(date)).m;
  return m >= 5 && m <= 7;
}

/** Летних дней отпуска в отрезке (без праздников) */
export function summerDays(start: IsoDate, end: IsoDate): number {
  let k = 0;
  for (let n = toDay(start); n <= toDay(end); n++) if (!holidayAt(n) && isSummer(toIso(n))) k++;
  return k;
}

/**
 * Рабочий год, в который попадает дата (ст. 163 ТК): 12 месяцев от даты приёма.
 * shiftDays — накопленный сдвиг границ: дни без сохранения зарплаты сверх 14 и отпуск по уходу
 * за ребёнком до 3 лет (ст. 164–165). Их подсчёт — забота вызывающего.
 */
export function workingYear(hiredOn: IsoDate, date: IsoDate, shiftDays = 0): { start: IsoDate; end: IsoDate; number: number } {
  const h = parts(toDay(hiredOn));
  const at = (k: number) => {
    const last = new Date(Date.UTC(h.y + k, h.m + 1, 0)).getUTCDate();
    return dayNum(h.y + k, h.m, Math.min(h.d, last)) + (k > 0 ? shiftDays : 0);
  };
  const n = toDay(date);
  let k = Math.max(0, parts(n).y - h.y - 1);
  while (at(k + 1) <= n) k++;
  while (k > 0 && at(k) > n) k--;
  return { start: toIso(at(k)), end: toIso(at(k + 1) - 1), number: k + 1 };
}
