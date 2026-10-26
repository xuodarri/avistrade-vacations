/**
 * Что экран сотрудника получает с сервера. Только своё: в проверке нет `employeeIds` и чужих
 * дат, имена — только тех, кто мешает именно ему (по настройке HR), загрузка группы — числа.
 */
import type { PartStatus, RequestStatus, VacationType } from "@/server/db/types";

export type Level = "ok" | "info" | "warn" | "block" | "exception";

export interface MyFinding {
  ruleCode: string;
  level: Level;
  title: string;
  message: string;
  basis: string;
  partNo?: number;
  /** Чем грозит: law — нормы ТК (подать нельзя), exception — регламент (подать можно как исключение), warning — пометка */
  consequence?: "law" | "exception" | "warning";
  /** Не зависит от дат: перенос не поможет (норма дней, длинная часть, число частей) — `!dateBound` движка */
  global: boolean;
  /** Первый и последний конфликтный день (R01, R02) */
  dates?: [string, string];
  /** Кто мешает: коллеги по группе (R01) или те, кого сотрудник замещает (R02); name null — имена скрыты */
  people?: { name: string | null; role: string }[];
}

export interface MyCheck {
  verdict: "ok" | "warn" | "block";
  findings: MyFinding[];
  /** Нарушений ТК нет — план можно отправить */
  canSubmit: boolean;
  /** Есть расхождения с регламентом — отправка как запрос исключения, с обоснованием */
  needsException: boolean;
}

/** Загрузка группы на день: сколько коллег в отпуске, лимит (0 — без лимита), уйти нельзя. */
export interface DayLoadView {
  busy: number;
  limit: number;
  full: boolean;
}

export interface WindowView {
  start: string;
  end: string;
  days: number;
  holidays: string[];
}

/** Как часть выглядит на новых датах при переносе: итог проверки и одна короткая причина. */
export interface MoveVerdict { level: "ok" | "warn" | "block"; reason?: string }

/** Совет при переборе нормы: какую часть и до каких дат сократить (полная проверка пройдена) */
export interface TrimView {
  /** Номер части в отправленном списке (с 1) */
  partNo: number;
  /** Это само выделение */
  draft: boolean;
  from: { start: string; end: string };
  to: { start: string; end: string };
  freedDays: number;
  status: "ok" | "warn";
}

export interface DraftCheck {
  check: MyCheck;
  /** Номер части в отправленном списке (с 1), для которой подобраны окна */
  windowsFor: number | null;
  windows: WindowView[];
  /** Что сократить, чтобы уложиться в норму; пусто — превышения нет или выполнимого варианта нет */
  trims: TrimView[];
  /** Нет части от 14 дней (ст. 174): как продлить выделение — варианты без новых запретов */
  extend: { start: string; end: string; days: number }[];
}

/** Заявка на изменение согласованной части: открытая или возвращённая на доработку */
export interface MyChange {
  id: number;
  kind: "move" | "shorten" | "cancel" | "extend" | "recall";
  newStart: string | null;
  newEnd: string | null;
  status: "open" | "approved" | "rejected" | "returned" | "withdrawn";
  /** У кого сейчас: руководитель или отдел кадров */
  stage: "manager" | "hr";
  note: string | null;
  /** Комментарий решающего (при возврате) */
  decisionNote: string | null;
}

export interface MyPart {
  /** id части в базе — для заявок на перенос */
  id: number;
  partNo: number;
  type: VacationType;
  startDate: string;
  endDate: string;
  days: number;
  status: PartStatus;
  /** Кто замещает на время части */
  substitute: { id: string; name: string } | null;
  /** За свой счёт: код причины (LEAVE_REASONS) и пояснение */
  reason: string | null;
  reasonNote: string | null;
  /** Нужны отпускные (п. 4 регламента: по заявлению, не больше оклада) */
  needsPay: boolean;
  /** Открытая (или возвращённая) заявка на перенос, сокращение или отказ */
  change: MyChange | null;
}

/** Проверка заявки на изменение согласованной части */
export interface ChangeCheck { check: MyCheck; windows: WindowView[] }

/** Коллега в списке «Кто замещает»: свободен ли он в выбранные даты */
export interface SubstituteView {
  id: string;
  name: string;
  position: string;
  group: string;
  free: boolean;
  /** «14–16 июля» — когда он в отпуске в эти даты */
  busy: string;
}

export interface MyRequest {
  status: RequestStatus;
  submittedAt: string | null;
  updatedAt: string;
}

export interface MyPlan {
  year: number;
  employee: { fullName: string; position: string; division: string; department: string | null; benefit: string | null };
  manager: string | null;
  norm: number;
  request: MyRequest | null;
  parts: MyPart[];
  /** План согласован хотя бы частично: менять даты здесь нельзя, только переносом */
  locked: boolean;
  holidays: { date: string; name: string }[];
  group: { label: string; limit: number };
  /** Летом не больше N дней в одной части (R03), null — правило выключено */
  summerDays: number | null;
  /** Перенос части — не позднее чем за N дней до начала (R14), null — правило выключено */
  rescheduleDays: number | null;
  /** «Сегодня» сервера (для демо может быть зафиксировано): начавшуюся часть сотрудник не меняет */
  today: string;
  /** Кто решает исключения и переносы (РО1 по регламенту, из настроек маршрута): «Кузьмич М. Л.» */
  ro1: string;
  /** График отпусков по полугодиям: статус, срок утверждения и когда утверждён (доводится до всех, ч. 2 ст. 168 ТК) */
  schedule: { half: 1 | 2; status: "collecting" | "pending" | "returned" | "approved"; deadline: string; decidedAt: string | null }[];
  check: MyCheck;
  /** Настройка HR «Сотрудники видят имена коллег» */
  showNames: boolean;
  /** Загрузка группы на каждый день года, без имён */
  load: Record<string, DayLoadView>;
  /** Кто из группы и из замещающих в отпуске по дням («Петров С.»); пусто, если HR скрыл имена */
  absent: Record<string, string[]>;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  request: MyRequest | null;
  parts: MyPart[];
  check: MyCheck;
}

export interface HistoryItem {
  id: number;
  at: string;
  /** «Вы», руководитель или HR */
  actor: string;
  action: string;
  label: string;
  detail: string | null;
}
