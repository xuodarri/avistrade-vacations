/**
 * Типы сущностей базы. Единственный источник типов для экранов и движка (`@/domain`).
 * Даты — строки ISO `YYYY-MM-DD`, отметки времени — ISO с временем (UTC).
 */

export type RoleCode = "ИД" | "ЗАВ" | "ЗТВ" | "РО" | "НО" | "МС" | "МПП" | "СП";

/** Границы, в которых считаются коллеги или связанные роли. */
export type Scope = "вся компания" | "отделение" | "отдел" | "тот же руководитель" | "свой руководитель";

/** Льготы по ч. 4 ст. 168 ТК: отпуск в удобное время, вне лимитов регламента. */
export const BENEFITS = [
  "мать двоих и более детей до 14 лет",
  "родитель ребёнка-инвалида до 18 лет",
  "ветеран боевых действий",
  "почётный донор",
  "пострадавший от катастрофы на ЧАЭС",
  "супруг в отпуске жены по беременности и родам",
  "совместитель",
  "студент заочной формы",
] as const;
export type Benefit = (typeof BENEFITS)[number];

export interface Employee {
  id: string; // E01
  fullName: string;
  email: string;
  position: string;
  roleCode: RoleCode;
  division: string; // отделение
  department: string | null; // отдел
  managerId: string | null;
  hiredOn: string;
  baseDays: number; // норма 24/30
  extraDays: number; // доп. дни по ст. 158–162
  benefit: Benefit | null; // ч. 4 ст. 168
  under18: boolean;
  ackOn: string | null; // ознакомлен с регламентом
  isHr: boolean;
  dismissedOn: string | null; // дата увольнения; null — работает
  benefit189: string | null; // код категории из BENEFITS_189: право на обязательный отпуск без сохранения (ст. 189)
}

export interface Role {
  code: RoleCode;
  title: string;
  groupId: number | null; // группа ограничения по коллегам той же роли
  calendarGroup: string; // подпись группы в личном календаре
  regClause: string;
}

/** «Роль уходит, только если requiresRole в пределах scope не в отпуске». */
export interface RoleDependency {
  id: number;
  roleCode: RoleCode;
  requiresRole: RoleCode;
  scope: Scope;
  regClause: string;
}

/** Группа ограничения: не больше maxConcurrent человек одновременно (включая себя). */
export interface LimitGroup {
  id: number;
  code: string;
  name: string;
  roleCode: RoleCode;
  scope: Scope;
  maxConcurrent: number;
  regClause: string;
}

export type Severity = "block" | "warn" | "info" | "off";
export type Stage = "collect" | "adhoc" | "inplan"; // сбор графика / вне графика / уже в графике

export interface RuleParams {
  value?: number | null; // N из названия правила
  stages?: Partial<Record<Stage, Severity>>; // жёсткость по этапам
  benefitApplies?: boolean; // применяется ли к льготникам ч. 4 ст. 168
  [k: string]: unknown;
}

export interface Rule {
  code: string; // R01
  title: string;
  params: RuleParams;
  enabled: boolean;
  severity: Severity; // жёсткость на текущем этапе по умолчанию (сбор графика)
  source: "ТК" | "регламент"; // правило ТК исключением HR не снимается
  basis: string;
  howChecked: string;
}

/** treatment — плановое лечение / госпитализация по регламенту (плановое лечение) (юридический риск: по ТК это нетрудоспособность, ст. 171). */
export type VacationType = "main" | "unpaid190" | "unpaid189" | "treatment";
export type TreatmentKind = "hospital" | "outpatient";
export const TREATMENT_KIND_LABEL: Record<TreatmentKind, string> = { hospital: "Госпитализация", outpatient: "Амбулаторное лечение" };
export const VACATION_TYPE_LABEL: Record<VacationType, string> = {
  main: "Основной",
  unpaid190: "За свой счёт",
  unpaid189: "За свой счёт по льготе",
  treatment: "Плановое лечение",
};

/** Статья ТК к виду отпуска — для подсказок и документов. */
export const VACATION_TYPE_BASIS: Record<VacationType, string> = {
  main: "ст. 155 ТК",
  unpaid190: "ст. 190 ТК",
  unpaid189: "ст. 189 ТК",
  treatment: "регламент: плановое лечение",
};

export interface LeaveReason {
  code: string;
  label: string;
  /** Подсказка: по такой причине наниматель часто сохраняет зарплату (колдоговор). */
  paidHint?: boolean;
  /** Нужно пояснение своими словами (reasonNote). */
  needsNote?: boolean;
}

/** Причины отпуска за свой счёт: по ст. 190 — уважительные причины, по ст. 189 — категории, которым отказать нельзя. */
export const LEAVE_REASONS: Record<Exclude<VacationType, "main">, LeaveReason[]> = {
  unpaid190: [
    { code: "family", label: "Семейно-бытовые обстоятельства" },
    { code: "birth", label: "Рождение ребёнка", paidHint: true },
    { code: "marriage", label: "Регистрация брака", paidHint: true },
    { code: "death", label: "Смерть близкого родственника", paidHint: true },
    { code: "thesis", label: "Работа над диссертацией" },
    { code: "textbook", label: "Написание учебника" },
    { code: "other", label: "Другая уважительная причина", needsNote: true },
  ],
  unpaid189: [
    { code: "children", label: "Женщина с двумя и более детьми до 14 лет или ребёнком-инвалидом до 18 лет" },
    { code: "care", label: "Уход за больным членом семьи (по медицинской справке)" },
    { code: "veteran", label: "Ветеран Великой Отечественной войны или боевых действий" },
    { code: "hero", label: "Герой Беларуси и приравненные" },
    { code: "disabled", label: "Инвалид на специализированном рабочем месте" },
    { code: "other", label: "Иное по закону или коллективному договору", needsNote: true },
  ],
  /** Плановое лечение (регламент: плановое лечение): причину и диагноз не храним — данные о здоровье. */
  treatment: [],
};

/** Категории работников с правом на обязательный отпуск без сохранения по ст. 189 — те же коды, что причины unpaid189. */
export const BENEFITS_189 = LEAVE_REASONS.unpaid189.map(({ code, label }) => ({ code, label }));

/** Подпись причины по виду отпуска и коду (с пояснением для «другая»). */
export function leaveReasonLabel(type: VacationType, reason: string | null, note?: string | null): string | null {
  if (type === "main" || !reason) return null;
  const r = LEAVE_REASONS[type].find((x) => x.code === reason);
  if (!r) return reason;
  return r.needsNote && note ? `${r.label}: ${note}` : r.label;
}

export type PartStatus = "draft" | "pending" | "approved" | "returned" | "rejected";
export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  draft: "Черновик",
  pending: "На согласовании",
  approved: "Согласована",
  returned: "Возвращена",
  rejected: "Отклонена",
};
/** Статусы, которые занимают место в загрузке группы. */
export const OCCUPYING: PartStatus[] = ["pending", "approved"];

export type RequestStatus = "draft" | "submitted" | "approved" | "returned";
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Черновик",
  submitted: "Отправлен",
  approved: "Согласован",
  returned: "Возвращён",
};

/** Заявка-план сотрудника на год. */
export interface VacationRequest {
  id: number;
  employeeId: string;
  year: number;
  status: RequestStatus;
  submittedAt: string | null;
  updatedAt: string;
  /** Обоснование сотрудника, если план отправлен с отступлением от регламента: «почему нужны именно эти даты». */
  exceptionNote: string | null;
}

/* ---------------- изменение согласованной части (Решения.md, «Изменение согласованного отпуска») ---------------- */

/**
 * move / shorten / cancel — заявка сотрудника (маршрут руководитель → HR, до решения действуют старые даты);
 * extend — продление по болезни и др. (ст. 171), recall — отзыв из отпуска с согласия (ст. 174): оформляет HR сразу.
 */
export type ChangeKind = "move" | "shorten" | "cancel" | "extend" | "recall";
export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  move: "Перенос", shorten: "Сокращение", cancel: "Отказ от части", extend: "Продление", recall: "Отзыв из отпуска",
};

/** Основание по ст. 171 ТК; для заявки сотрудника обычно «по соглашению». */
export type ChangeReason = "agreement" | "illness" | "maternity" | "state-duty" | "study" | "late-payment";
export const CHANGE_REASON_LABEL: Record<ChangeReason, string> = {
  agreement: "по соглашению сторон",
  illness: "временная нетрудоспособность",
  maternity: "отпуск по беременности и родам",
  "state-duty": "выполнение государственных обязанностей",
  study: "учебный отпуск",
  "late-payment": "отпускные не выплачены вовремя",
};

/** open — ждёт решения (stage: у кого), returned — возвращена сотруднику на доработку. */
export type ChangeStatus = "open" | "approved" | "rejected" | "returned" | "withdrawn";
export const CHANGE_STATUS_LABEL: Record<ChangeStatus, string> = {
  open: "На согласовании", approved: "Согласована", rejected: "Отклонена", returned: "Возвращена", withdrawn: "Отозвана",
};
export type ChangeStage = "manager" | "hr";

export interface PartChange {
  id: number;
  partId: number;
  employeeId: string;
  kind: ChangeKind;
  /** Даты части на момент заявки — «было». */
  oldStart: string;
  oldEnd: string;
  /** Новые даты — «стало»; null у отказа от части. */
  newStart: string | null;
  newEnd: string | null;
  reason: ChangeReason;
  /** Причина своими словами (обязательна для заявки сотрудника). */
  note: string | null;
  status: ChangeStatus;
  stage: ChangeStage;
  requestedOn: string; // дата подачи — от неё считается «не позднее чем за 14 дней» (R14)
  requestedBy: string;
  createdAt: string;
  managerBy: string | null; // руководитель, пропустивший заявку к HR
  managerAt: string | null;
  decidedBy: string | null; // окончательное решение (HR) или возврат / отклонение
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface RequestPart {
  id: number;
  requestId: number;
  partNo: number;
  type: VacationType;
  startDate: string;
  endDate: string;
  days: number; // календарных дней без праздников
  status: PartStatus;
  inSchedule: boolean; // часть графика (а не вне графика)
  result: string | null; // итог движка
  notes: string | null; // замечания движка
  substituteId: string | null; // кто замещает на время части (id сотрудника); null — не указан
  /** У планового лечения: госпитализация или амбулаторно; диагноз не храним. */
  treatmentKind: TreatmentKind | null;
  needsPay: boolean; // нужны отпускные (регламент: «по заявлению»; юридический риск — по ТК платят всегда, ст. 175–176)
  reason: string | null; // причина отпуска за свой счёт: код из LEAVE_REASONS; у основного — null
  reasonNote: string | null; // пояснение своими словами
}

/** Часть для сохранения из экрана: id нет у новых частей. */
export interface PartInput {
  id?: number;
  type: VacationType;
  startDate: string;
  endDate: string;
  /** Замещающий. undefined — оставить прежнего (для части с id), null — убрать. */
  substituteId?: string | null;
  treatmentKind?: TreatmentKind | null;
  /** Нужны отпускные (регламент: отпускные). undefined — оставить прежнее у части с id. */
  needsPay?: boolean;
  /** Причина отпуска за свой счёт (код из LEAVE_REASONS) и пояснение. */
  reason?: string | null;
  reasonNote?: string | null;
}

export type ExceptionDecision = "allow" | "return";
export interface RuleException {
  id: number;
  createdAt: string;
  createdBy: string; // id сотрудника HR
  employeeId: string;
  partId: number | null; // null — на все части сотрудника
  ruleCode: string;
  decision: ExceptionDecision;
  reason: string;
  active: boolean;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string | null;
  action: string; // create / update / delete / submit / login / ...
  entity: string; // employee / request / part / rule / exception / ...
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface Holiday {
  date: string;
  name: string;
  nonWorking: boolean;
  basis: string;
}

/** Что человек может видеть в демо-входе. */
export type AccessKind = "employee" | "manager" | "hr";

/* ---------------- маршрут согласования, утверждение графика, уведомления ---------------- */

/**
 * Маршрут: заявление — «на имя РО1 через непосредственного руководителя» (регламент); после руководителя
 * РО1 проверяет даты и ведёт график. Отпуск самого РО1 на шаге HR проверяет ro1ReviewerId.
 * График утверждает scheduleApproverId (ч. 1 ст. 168 ТК), с профсоюзом — если это есть в колдоговоре.
 */
export interface RouteSettings {
  ro1Id: string;
  ro1ReviewerId: string;
  scheduleApproverId: string;
  unionRequired: boolean;
  /** Приватность: сотрудники видят имена коллег в загрузке группы. */
  showColleagueNames: boolean;
}
export const ROUTE_DEFAULTS: RouteSettings = {
  ro1Id: "E19", ro1ReviewerId: "E02", scheduleApproverId: "E01", unionRequired: false, showColleagueNames: true,
};

export type ScheduleStatus = "collecting" | "pending" | "returned" | "approved";
export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  collecting: "Сбор пожеланий", pending: "На утверждении", returned: "Возвращён на доработку", approved: "Утверждён",
};
/** Полугодие графика (регламент: график на полугодие): I — сдать до 15 января, II — до 15 июля. */
export type ScheduleHalf = 1 | 2;
export const SCHEDULE_HALF_LABEL: Record<ScheduleHalf, string> = { 1: "I полугодие", 2: "II полугодие" };
/** Крайний срок утверждения полугодового графика по регламенту (ст. 168 ч. 2 ТК — годовой до 5 января: юридический риск). */
export const scheduleDeadline = (year: number, half: ScheduleHalf) => (half === 1 ? `${year}-01-15` : `${year}-07-15`);

export interface Schedule {
  year: number;
  half: ScheduleHalf;
  /** Срок утверждения по регламенту: 15.01 или 15.07. */
  deadline: string;
  status: ScheduleStatus;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  /** Согласование с профсоюзом (если routeSettings.unionRequired): дата и номер протокола. */
  unionDate: string | null;
  unionProtocol: string | null;
}

export type NotificationKind = "info" | "request" | "decision" | "reminder" | "schedule";
export interface AppNotification {
  id: number;
  employeeId: string;
  kind: NotificationKind;
  text: string;
  href: string | null;
  createdAt: string;
  readAt: string | null;
}
