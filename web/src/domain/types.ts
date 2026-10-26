/**
 * Типы предметной области: сотрудники, отпуска, правила, результаты проверки.
 * Даты везде — строки ISO «YYYY-MM-DD»: их можно класть в JSON и в базу как есть.
 */

export type IsoDate = string;

/** Коды ролей из регламента: ИД, ЗАВ, ЗТВ, РО, НО, МС, МПП, СП. HR может завести свои. */
export type RoleCode = string;

/**
 * Льготы ч. 4 ст. 168 ТК: желаемое время отпуска нельзя отклонить внутренним лимитом.
 * Список не закрытый — значение уходит в пояснение как есть.
 */
export type Benefit =
  | 'мать двоих и более детей до 14 лет'
  | 'родитель ребёнка-инвалида до 18 лет'
  | 'ветеран'
  | 'почётный донор'
  | 'пострадавший от катастрофы на ЧАЭС'
  | 'супруга в отпуске по беременности и родам'
  | 'совместитель'
  | (string & {});

export interface Employee {
  id: string;
  name: string;
  role: RoleCode;
  title?: string;
  /** Отделение */
  unit: string;
  /** Отдел внутри отделения */
  dept?: string;
  /** Непосредственный руководитель */
  managerId?: string;
  hiredOn: IsoDate;
  /** Основной отпуск, календарных дней (ст. 155: не меньше 24) */
  normDays: number;
  /** Дополнительные дни: ненормированный день, стаж, контракт (ст. 158–162) */
  extraDays?: number;
  /** Льготы ч. 4 ст. 168 ТК */
  benefits?: Benefit[];
  /** До 18 лет: отпуск летом или в удобное время, лимиты регламента не действуют */
  minor?: boolean;
  /** Право на первый отпуск раньше 6 месяцев без соглашения (ч. 2–3 ст. 166) */
  earlyFirstLeave?: boolean;
  /** Уволен (без даты): замещающим быть не может */
  dismissed?: boolean;
  /** Дата увольнения: с неё замещать не может */
  dismissedOn?: IsoDate;
  /** Категория по ст. 189 (право на обязательный отпуск без сохранения), код из базы */
  benefit189?: string;
}

/**
 * main — трудовой основной (с дополнительными днями);
 * unpaid190 — без сохранения по уважительным причинам, на усмотрение нанимателя (ст. 190);
 * unpaid189 — без сохранения, обязательный: отказать нельзя, согласуется только период (ст. 189);
 * social — социальный (по беременности и родам, учебный, по уходу за ребёнком): даты задаёт документ;
 * treatment — плановое лечение (регламент, плановое лечение; юридический риск: по ТК это нетрудоспособность,
 *   а не отпуск, ст. 171). Подчиняется лимитам групп, зависимостям ролей и сроку «за месяц»,
 *   в норму дней не входит, лимиты ст. 189/190 на него не действуют.
 */
export type LeaveType = 'main' | 'unpaid190' | 'unpaid189' | 'social' | 'treatment';

export type PartStatus = 'draft' | 'pending' | 'approved' | 'returned' | 'rejected';

/** Основания переноса по ч. 1 ст. 171 ТК. Срок подачи регламента касается только «agreement». */
export type RescheduleReason = 'illness' | 'maternity' | 'state-duty' | 'study' | 'late-payment' | 'agreement';

export interface Reschedule {
  /** Даты до переноса */
  fromStart: IsoDate;
  fromEnd: IsoDate;
  requestedOn: IsoDate;
  reason: RescheduleReason;
}

export type ChangeKind = 'move' | 'shorten' | 'cancel';

/**
 * Заявка на изменение согласованной части: перенос, сокращение или отказ. До решения
 * действуют старые даты; в загрузке группы учитываются и старые, и новые.
 */
export interface PartChange {
  id: string;
  employeeId: string;
  partId: string;
  kind: ChangeKind;
  /** Новые даты; у cancel нет */
  newStart?: IsoDate;
  newEnd?: IsoDate;
  /** Основание ст. 171; по умолчанию — соглашение сторон */
  reason?: RescheduleReason;
  requestedOn: IsoDate;
  status?: 'open' | 'approved' | 'rejected' | 'returned' | 'withdrawn';
}

export interface VacationPart {
  id: string;
  type: LeaveType;
  start: IsoDate;
  /** Последний день отпуска включительно */
  end: IsoDate;
  status: PartStatus;
  /** Когда подана заявка; по умолчанию считается от «сегодня» контекста */
  submittedOn?: IsoDate;
  /** Работник согласен уйти в первый отпуск раньше 6 месяцев (ч. 1 ст. 166) */
  earlyConsent?: boolean;
  reschedule?: Reschedule;
  /** Кто замещает на время части (id сотрудника); пусто — не указан */
  substituteId?: string | null;
  /** Нужны отпускные, не больше оклада (регламент, отпускные; юридический риск — ст. 175–176). Только данные */
  needsPay?: boolean;
}

export interface Plan {
  employeeId: string;
  year: number;
  parts: VacationPart[];
}

/* ---------------- правила ---------------- */

export type RuleCode =
  | 'pastDates'
  | 'groupLimit'
  | 'roleDependencies'
  | 'summerLength'
  | 'noticeMonth'
  | 'rescheduleNotice'
  | 'longPart'
  | 'yearNorm'
  | 'firstVacation'
  | 'noOverlap'
  | 'maxParts'
  | 'unpaid190Limit'
  | 'unpaid189Limit'
  | 'substitute'
  | 'changeLocked'
  | 'halfYearDeadline'
  | 'payRequest'
  | 'treatmentLeave'
  | 'holidays'
  | 'scheduleDeadline';

export type Severity = 'block' | 'warn' | 'info';

/**
 * Этап, от которого зависит жёсткость:
 * collect — сбор графика (лимиты регламента жёсткие, ч. 1 ст. 168);
 * adhoc — заявка вне графика;
 * approved — отпуск уже стоит в утверждённом графике: регламент только предупреждает.
 */
export type Stage = 'collect' | 'adhoc' | 'approved';

export interface RuleConfig {
  code: RuleCode;
  title: string;
  enabled: boolean;
  /** Числовые параметры правила, например { days: 14 } */
  params: Record<string, number>;
  /** Жёсткость по умолчанию */
  severity: Severity;
  /** Жёсткость на отдельных этапах; 'off' — на этом этапе правило не проверяется */
  severityByStage?: Partial<Record<Stage, Severity | 'off'>>;
  /** Статья ТК или пункт регламента */
  basis: string;
  /** Нормы закона исключением HR не снимаются, правила регламента — снимаются */
  source: 'law' | 'regulation';
  /** false — правило не действует на льготников ч. 4 ст. 168 и работников до 18 лет */
  appliesToBeneficiaries: boolean;
  /** Пункт регламента расходится с ТК: что именно — показывается у результата */
  legalRisk?: string;
}

/** Круг коллег, внутри которого действует лимит или зависимость роли */
export type Scope = 'company' | 'unit' | 'dept' | 'same-manager' | 'own-manager';

/**
 * Политика роли (лист «Роли» прототипа на Таблицах). Пример: у МС лимит 1 среди МС отдела
 * и зависимость от НО того же отдела — «МС уходит, если другие МС отдела и НО на месте».
 */
export interface RolePolicy {
  role: RoleCode;
  name: string;
  /** Подпись группы на экране сотрудника */
  groupLabel?: string;
  /** Коллеги той же роли, с которыми делится лимит */
  peerScope?: Scope;
  /** Сколько человек группы может отдыхать одновременно, включая себя */
  limit?: number;
  /** Роли, которые должны быть на месте, каждая — в своём круге */
  dependsOn?: { role: RoleCode; scope: Scope }[];
}

/** Исключение HR: одобренное отступление от правила регламента */
export interface HrException {
  id: string;
  employeeId: string;
  ruleCode: RuleCode;
  /**
   * Часть, к которой относится исключение. Пусто — исключение на план: снимает только нарушения
   * плана в целом (не частей), а если заданы dates — ещё и нарушения частей, пересекающих эти даты.
   */
  partId?: string;
  /**
   * Даты, на которые HR разрешил отступление: у исключения на часть — её даты на момент решения.
   * Если часть сдвинута, исключение к ней больше не относится.
   */
  dates?: DateRange;
  reason: string;
  approvedBy?: string;
  approvedOn?: IsoDate;
}

/* ---------------- результаты ---------------- */

/**
 * ok — правило выполнено; info — к сведению; warn — предупреждение; block — запрет;
 * exception — нарушение разрешено исключением HR; off — правило выключено или не применяется.
 */
export type ResultStatus = 'ok' | 'info' | 'warn' | 'block' | 'exception' | 'off';

/**
 * Что нарушение значит для подачи плана:
 * law — норма ТК или ошибка данных: подать нельзя, исключением не снимается;
 * exception — правило регламента в режиме «запрет»: подать можно, план уходит как запрос
 *   исключения — решают руководитель и HR;
 * warning — предупреждение: подаче не мешает.
 */
export type Consequence = 'law' | 'exception' | 'warning';

export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

export interface RuleResult {
  code: RuleCode;
  title: string;
  status: ResultStatus;
  /** Пояснение для человека, без имён коллег: экран сам решает, показывать ли их */
  message: string;
  basis: string;
  /** Части плана, к которым относится результат */
  partIds: string[];
  /** Затронутые даты */
  dates: DateRange[];
  /** Затронутые коллеги: кто занимает места, кого нет на месте */
  employeeIds: string[];
  /** Какое исключение HR сняло нарушение */
  exception?: HrException;
  /** Жёсткость, которая была бы без исключения */
  severity?: Severity;
  /** Последствие для подачи — только у нарушений (block, warn); у разрешённых исключением нет */
  consequence?: Consequence;
  /** Правило регламента расходится с ТК — пометка «юридический риск» */
  legalRisk?: string;
  /**
   * Зависит ли результат от дат части: сдвиг дат может его исправить (лимит, зависимости, лето…).
   * false — дело в составе плана (норма, число частей, нет части от 14 дней): свободное окно не поможет.
   */
  dateBound: boolean;
}

export interface PartSummary {
  partId: string;
  /** Номер части в плане с 1 — для текстов «Часть 1» */
  index: number;
  /** Дней отпуска: календарные минус нерабочие праздники (ст. 151) */
  days: number;
  holidays: IsoDate[];
  summerDays: number;
  stage: Stage;
  status: 'ok' | 'warn' | 'block';
}

export interface PlanSummary {
  /** Подать можно: нет нарушений закона и ошибок данных */
  canSubmit: boolean;
  /** План уйдёт как запрос исключения: есть запреты регламента */
  needsException: boolean;
  /** Почему подать нельзя */
  law: RuleResult[];
  /** Что придётся согласовать исключением */
  exceptions: RuleResult[];
  warnings: RuleResult[];
}

export interface CheckResult {
  employeeId: string;
  status: 'ok' | 'warn' | 'block';
  /** Последствия для подачи: можно ли подать и нужен ли запрос исключения */
  summary: PlanSummary;
  results: RuleResult[];
  parts: PartSummary[];
  /** Основных дней в плане и норма */
  totalDays: number;
  normDays: number;
}

export interface Settings {
  /** Год графика */
  year: number;
  /**
   * Сроки утверждения графика по регламенту. Регламент «Авистрейда» — полугодовой:
   * 15 января и 15 июля. ТК (ч. 2 ст. 168) — годовой до 5 января.
   */
  regulationDeadlines: IsoDate[];
  /** Есть коллективный договор или согласование с профсоюзом: тогда иной срок графика законен */
  collectiveAgreement: boolean;
  /** Полугодовые графики (регламент, график на полугодие): срок сдачи и утверждён ли уже */
  halfYears?: { year: number; half: 1 | 2; deadline: IsoDate; approved: boolean }[];
}

export interface CheckContext {
  /** Сегодня — от него считаются сроки подачи */
  today: IsoDate;
  /** Этап компании: сбор графика или заявки вне графика */
  stage: 'collect' | 'adhoc';
  employees: Employee[];
  /** Планы всех сотрудников: из них считается, кто когда отсутствует */
  plans: Plan[];
  roles: RolePolicy[];
  rules: RuleConfig[];
  exceptions: HrException[];
  /** Статусы частей, которые занимают место в группе */
  occupying: PartStatus[];
  settings: Settings;
  /** Проверка при отправке плана: незаполненный замещающий — уже не предупреждение, а по жёсткости правила */
  submitting?: boolean;
}
