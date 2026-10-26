/** Шкала Ганта: периоды, номер дня в году, недели. Даты — `YYYY-MM-DD`, считаем в UTC. */
import { toUtc, fromUtc } from "@/lib/dates";

export const DAY = 86_400_000;
export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export interface Period { key: string; label: string; from: string; to: string }

export function periodsOf(year: number): Period[] {
  return [
    { key: "may-oct", label: `Май — октябрь ${year}`, from: `${year}-05-01`, to: `${year}-10-31` },
    { key: "h1", label: `I полугодие ${year}`, from: `${year}-01-01`, to: `${year}-06-30` },
    { key: "h2", label: `II полугодие ${year}`, from: `${year}-07-01`, to: `${year}-12-31` },
    { key: "summer", label: `Лето ${year}`, from: `${year}-06-01`, to: `${year}-08-31` },
    { key: "year", label: `Весь ${year} год`, from: `${year}-01-01`, to: `${year}-12-31` },
  ];
}

/** Номер дня от начала отсчёта (с 0). */
export const dayNo = (iso: string, base: string) => Math.round((toUtc(iso) - toUtc(base)) / DAY);
export const isoAt = (base: string, n: number) => fromUtc(toUtc(base) + n * DAY);
/** 0 — воскресенье, 6 — суббота. */
export const weekday = (iso: string) => new Date(toUtc(iso)).getUTCDay();

/** Номер недели по ISO 8601. */
export function isoWeek(iso: string) {
  const d = new Date(toUtc(iso));
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3); // четверг той же недели
  return 1 + Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY / 7);
}

/** Число дней со склонением: 1 день, 3 дня, 14 дней. */
export function daysWord(n: number) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? "день" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? "дня" : "дней";
}
