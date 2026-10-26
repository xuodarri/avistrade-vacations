/**
 * Данные Ганта HR и очереди руководителя: сервер считает всё заранее (`getGanttBoard`,
 * `getManagerQueue`), клиент только фильтрует и рисует. Даты — `YYYY-MM-DD`.
 */
import type { PartStatus, RequestStatus, RoleCode, VacationType } from "@/server/db/types";
import type { Consequence } from "@/domain";

/** Цвет полосы: статус части с учётом проверки. */
export type BarTone = "approved" | "pending" | "warn" | "block" | "exception" | "draft" | "returned";

/** Где заявка на маршруте «сотрудник → руководитель → HR». */
export type RouteStage = "draft" | "manager" | "hr" | "approved" | "returned" | "rejected";

export interface Range { start: string; end: string }

export interface BoardFinding {
  ruleCode: string; // R01
  title: string;
  level: "block" | "warn" | "exception" | "info" | "ok";
  message: string;
  basis: string;
  source: "ТК" | "регламент";
  partIds: number[];
  dates: Range[];
  /** Коллеги, из-за которых конфликт: короткие имена */
  people: string[];
  exceptionReason?: string;
  /** Последствие нарушения по движку: law — только вернуть, exception — нужно исключение, warning — предупреждение */
  consequence?: Consequence;
  /** Касается части на согласовании или в графике: черновики и возвращённые ждут сотрудника */
  actionable: boolean;
}

/** Вид отпуска для экранов: подпись, статья и причина (у отпуска за свой счёт). */
export interface LeaveKind { label: string; basis: string; main: boolean; reason: string | null }

/** Замещающий на время части: регламент требует указывать его в заявлении. */
export interface SubstituteInfo {
  id: string;
  name: string; // Петров С. И.
  fullName: string;
  position: string;
  /** Его отпуска, которые пересекаются с частью (обрезаны по её датам) */
  away: Range[];
  /** Все его части года — для мини-ленты */
  parts: (Range & { tone: BarTone })[];
}

export interface BoardPart {
  id: number;
  employeeId: string;
  partNo: number;
  type: VacationType;
  start: string;
  end: string;
  days: number;
  status: PartStatus;
  tone: BarTone;
  stage: RouteStage;
  /** Праздники внутри части: в отпуск не входят */
  holidays: string[];
  /** Дни открытого конфликта внутри части */
  hot: Range[];
  /** Кто из руководителей уже согласовал и когда */
  managerApproval?: { by: string; at: string };
  /** Замещающий; null — не указан */
  substitute: SubstituteInfo | null;
  /** Вид отпуска и причина для «за свой счёт»: «За свой счёт», «Рождение ребёнка» */
  kind: LeaveKind;
  /** Запрос исключения: часть подана с открытым нарушением регламента (без нарушений ТК) */
  exceptionRequest: boolean;
  /** Открытая заявка на перенос, сокращение или отказ */
  change: BoardChange | null;
}

export interface BoardEmployee {
  id: string;
  name: string; // Иванова А. С.
  fullName: string;
  position: string;
  role: RoleCode;
  division: string;
  department: string | null;
  managerName: string | null;
  benefit: string | null;
  requestStatus: RequestStatus | null;
  submittedAt: string | null;
  verdict: "ok" | "warn" | "block" | null;
  /** Обоснование сотрудника «Почему нужны именно эти даты» (запрос исключения) */
  exceptionNote: string | null;
  /** Кто решает на шаге HR: РО1 или, по отпуску самого РО1, проверяющий за РО1 */
  hrDecider: { id: string; name: string; asReviewer: boolean };
  /** Открытые конфликты: запреты и предупреждения без исключения */
  open: number;
  totalDays: number;
  normDays: number;
  findings: BoardFinding[];
}

export type LoadLevel = 0 | 1 | 2 | 3 | 4 | 5; // нет / есть места / на лимите / связь / сверх лимита / разрешено исключением

export interface LoadRow {
  key: string;
  title: string;
  hint: string;
  limit: number | null;
  memberIds: string[];
  /** По дням года с 1 января: сколько отсутствует и уровень */
  absent: number[];
  level: LoadLevel[];
  /** Имена отсутствующих по дням — для подсказки */
  who: string[][];
}

export interface BoardSubgroup {
  key: string;
  load: LoadRow | null;
  employeeIds: string[];
  /** Кто должен быть на месте, пока группа в отпуске (зависимости ролей) */
  dependencyIds: string[];
}

/** Заявка на изменение согласованной части: перенос, сокращение, отказ (продление и отзыв оформляет HR). */
export interface BoardChange {
  id: number;
  partId: number;
  employeeId: string;
  kind: "move" | "shorten" | "cancel" | "extend" | "recall";
  kindLabel: string; // Перенос
  oldStart: string;
  oldEnd: string;
  newStart: string | null;
  newEnd: string | null;
  reason: string; // по соглашению сторон
  note: string | null; // причина сотрудника
  stage: "manager" | "hr";
  requestedOn: string;
  /** Руководитель пропустил к HR */
  managerBy: string | null;
  /** Проверка новых дат движком */
  findings: BoardFinding[];
  /** Есть нарушение закона: только отклонить */
  law: boolean;
  /** Есть запрет регламента (в том числе поздний перенос R14): только исключением */
  needsException: boolean;
  /** Свободные окна той же длины, если новым датам мешает лимит */
  windows: FreeWindow[];
}

/** Что вернуть при «Отменить» в уведомлении после решения. */
export interface UndoToken {
  partId: number;
  /** Статус, который поставило решение: отмена сработает, только если он не поменялся */
  expect: PartStatus;
  partStatus: PartStatus;
  requestId: number;
  requestStatus: RequestStatus;
  exceptionIds: number[];
  /** Согласие руководителя: отменяется записью manager_undo */
  managerApprove?: boolean;
}

export type Decision = { ok: true; undo: UndoToken } | { ok: false; error: string };

export interface BoardTier {
  key: string;
  title: string;
  subgroups: BoardSubgroup[];
}

export interface FreeWindow { start: string; end: string; days: number; shift: number }

export interface BoardSummary {
  open: number;
  blocks: number;
  warns: number;
  resolved: number;
  waitingHr: number;
  /** Частей с запросом исключения, ждущих решения */
  exceptionRequests: number;
  /** Заявок на перенос, которые ждут HR */
  changesHr: number;
  atManager: number;
  approved: number;
  parts: number;
}

export interface GanttBoardData {
  year: number;
  /** Кто смотрит: решения на шаге HR доступны только тому, кто решает по этой заявке */
  viewerId: string;
  /** РО1 из настроек маршрута, кратко: «Кузьмич М. Л.» — для подписей «ждёт РО1» */
  ro1: string;
  /** Утверждение графика по полугодиям (регламент; ч. 1–2 ст. 168 ТК) */
  schedule: {
    approver: string;
    halves: { half: 1 | 2; label: string; status: "collecting" | "pending" | "returned" | "approved"; statusLabel: string; decidedAt: string | null; decidedBy: string | null; comment: string | null }[];
  };
  employees: Record<string, BoardEmployee>;
  parts: BoardPart[];
  tiers: BoardTier[];
  holidays: { date: string; name: string }[];
  windows: Record<number, FreeWindow[]>;
  summary: BoardSummary;
  notices: string[];
}
