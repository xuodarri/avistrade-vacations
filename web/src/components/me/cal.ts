/** Даты, тексты и подкраска для экрана «Мой отпуск». Даты — ISO `YYYY-MM-DD`, считаем в UTC. */
import { countVacationDays, fmtDate } from "@/lib/dates";
import type { Tone } from "@/components/kit";
import type { PartStatus, VacationType } from "@/server/db/types";
import { LEAVE_REASONS } from "@/server/db/types";
import type { DayLoadView, Level } from "./types";

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_LOW = MONTHS.map((m) => m.toLowerCase());
const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const QUARTERS = ["I квартал", "II квартал", "III квартал", "IV квартал"];

export const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
export const monthOf = (d: string) => +d.slice(5, 7) - 1;
export const quarterLabel = (q: number) => `${QUARTERS[q]}: ${MONTHS_LOW[q * 3]} — ${MONTHS_LOW[q * 3 + 2]}`;

export function plural(n: number, one: string, few: string, many: string) {
  const k = Math.abs(n) % 100, j = k % 10;
  if (k > 10 && k < 20) return many;
  if (j > 1 && j < 5) return few;
  return j === 1 ? one : many;
}
export const daysText = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Пятница, 15 октября» */
export const dayTitle = (d: string) => `${cap(WEEKDAYS[weekday(d)])}, ${fmtDate(d)}`;

export function rangeText(start: string, end: string) {
  if (start === end) return fmtDate(start);
  return monthOf(start) === monthOf(end) ? `${+start.slice(8, 10)}–${fmtDate(end)}` : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function vacationDays(start: string, end: string, holidays: Set<string>) {
  return start && end && end >= start ? countVacationDays(start, end, holidays) : 0;
}

export const PART_STATUS: Record<PartStatus, { label: string; tone: Tone }> = {
  draft: { label: "Черновик", tone: "neutral" },
  pending: { label: "У руководителя", tone: "info" },
  approved: { label: "Согласована", tone: "ok" },
  returned: { label: "Возвращена", tone: "warn" },
  rejected: { label: "Отклонена", tone: "bad" },
};

export const TYPE_SHORT: Record<VacationType, string> = { main: "Основной", unpaid190: "За свой счёт", unpaid189: "За свой счёт по льготе", treatment: "Плановое лечение" };
export const TYPE_HINT: Record<VacationType, string> = {
  main: "Трудовой отпуск, оплачивается, входит в норму дней",
  unpaid190: "Без сохранения зарплаты, до 30 дней в году. Наниматель решает, уважительна ли причина (ст. 190 ТК)",
  unpaid189: "За свой счёт по льготе: без сохранения зарплаты, до 14 дней в году. Наниматель обязан предоставить (ст. 189 ТК)",
  treatment: "Госпитализация или амбулаторное лечение по плану. Не входит в норму отпуска. Диагноз не указывайте",
};
/** Подписи сегментов: в колонку панели три полных названия не влезают */
export const TYPE_SEGMENT: Record<VacationType, string> = { main: "Основной", unpaid190: "За свой счёт", unpaid189: "По льготе", treatment: "Лечение" };

/** Причины отпуска за свой счёт (ст. 190) и категории льготы (ст. 189) — общий справочник базы */
export { LEAVE_REASONS };

export const reasonOf = (type: VacationType, code?: string | null) =>
  type === "main" || !code ? undefined : LEAVE_REASONS[type].find((r) => r.code === code);

/** Загрузка дня: свободно / одно место / мест нет. «Одно место» — только когда кто-то уже в отпуске. */
export type LoadKind = "free" | "one" | "full";
export function loadKind(l: DayLoadView): LoadKind {
  if (l.full) return "full";
  return l.limit > 1 && l.limit - l.busy === 1 ? "one" : "free";
}
export const LOAD_BG: Record<LoadKind, string> = { free: "var(--load-free)", one: "var(--load-one)", full: "var(--load-full)" };
/** Свой отпуск на дне без мест: красный поверх загрузки */
export const OWN_BG = "var(--vacation-bg)";
export const OWN_CONFLICT_BG = "color-mix(in srgb, var(--bad) 30%, white)";

const places = (n: number) => `${n} ${plural(n, "место", "места", "мест")}`;
/** «в группе свободно 1 место из 2» — без имён */
export function loadPhrase(l: DayLoadView, beneficiary: boolean) {
  if (beneficiary) return "лимиты группы на вас не действуют";
  if (l.full && (l.limit === 0 || l.busy < l.limit)) return "замещающий в отпуске — уйти нельзя";
  if (l.limit === 0) return "лимита для группы нет";
  const free = Math.max(0, l.limit - l.busy);
  return free ? `в группе свободно ${places(free)} из ${l.limit}` : `мест нет: в отпуске ${l.busy} из ${l.limit}`;
}

const RANK: Record<Level, number> = { ok: 0, info: 1, exception: 2, warn: 3, block: 4 };
export const worse = (a: Level, b: Level) => (RANK[b] > RANK[a] ? b : a);
export const rank = (l: Level) => RANK[l];
