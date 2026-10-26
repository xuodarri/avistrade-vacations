/**
 * Настройки по умолчанию: правила, политики ролей, параметры компании.
 * HR меняет их на своём экране (параметры, включено, жёсткость); движок берёт их из контекста.
 */
import type { CheckContext, Employee, IsoDate, PartStatus, Plan, RoleCode, RolePolicy, RuleCode, RuleConfig, Settings } from './types';

export const DEFAULT_RULES: RuleConfig[] = [
  {
    code: 'pastDates', title: 'Даты не в прошлом', enabled: true, params: { daysAhead: 1 },
    severity: 'block', basis: 'Отпуск задним числом не оформляется', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'groupLimit', title: 'Лимит группы одновременно в отпуске', enabled: true, params: {},
    severity: 'block', severityByStage: { approved: 'warn' },
    basis: 'Регламент: лимит одновременно в отпуске; ч. 1 ст. 168 ТК', source: 'regulation', appliesToBeneficiaries: false,
  },
  {
    code: 'roleDependencies', title: 'Кто без кого не уходит', enabled: true, params: {},
    severity: 'block', severityByStage: { approved: 'warn' },
    basis: 'Регламент: кто без кого не уходит; ч. 1 ст. 168 ТК', source: 'regulation', appliesToBeneficiaries: false,
  },
  {
    code: 'summerLength', title: 'Летом до 14 дней подряд', enabled: true, params: { days: 14 },
    severity: 'block',
    basis: 'Регламент: летний период', source: 'regulation', appliesToBeneficiaries: false,
    legalRisk: 'ч. 1 ст. 174 ТК: делить отпуск можно только по соглашению; ч. 4 ст. 168: льготникам — летом по их желанию',
  },
  {
    code: 'noticeMonth', title: 'Заявка за месяц до начала', enabled: true, params: { days: 30 },
    severity: 'block', severityByStage: { approved: 'off' },
    basis: 'Регламент: заявление за месяц; ст. 169 ТК', source: 'regulation', appliesToBeneficiaries: true,
  },
  {
    code: 'rescheduleNotice', title: 'Перенос за 14 дней', enabled: true, params: { days: 14 },
    severity: 'block',
    basis: 'Регламент: перенос; ч. 1 ст. 171 ТК', source: 'regulation', appliesToBeneficiaries: true,
  },
  {
    code: 'longPart', title: 'Одна часть не меньше 14 дней', enabled: true, params: { days: 14 },
    severity: 'block', basis: 'ч. 1 ст. 174 ТК', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'yearNorm', title: 'Не больше нормы дней в году', enabled: true, params: {},
    severity: 'block', basis: 'ст. 155, 158–162 ТК', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'firstVacation', title: 'Первый отпуск после 6 месяцев работы', enabled: true, params: { months: 6 },
    severity: 'warn', basis: 'ч. 1 ст. 166 ТК — раньше только по соглашению', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'noOverlap', title: 'Части не пересекаются', enabled: true, params: {},
    severity: 'block', basis: 'ст. 151, 174 ТК', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'maxParts', title: 'Частей не больше 3', enabled: true, params: { parts: 3 },
    severity: 'block', basis: 'ч. 1 ст. 174 ТК: больше двух частей — если разрешает ЛПА', source: 'regulation', appliesToBeneficiaries: true,
  },
  {
    code: 'unpaid190Limit', title: 'За свой счёт (ст. 190) — до 30 дней в году', enabled: true, params: { days: 30, maxDays: 90 },
    severity: 'block',
    basis: 'ст. 190 ТК: до 30 календарных дней в году, больше — по коллективному договору, ЛПА или решению нанимателя, всего не больше 3 месяцев',
    source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'unpaid189Limit', title: 'Обязательный за свой счёт (ст. 189) — до 14 дней в году', enabled: true, params: { days: 14 },
    severity: 'warn', basis: 'ст. 189 ТК: наниматель обязан дать до 14 календарных дней в году, сверх — по договорённости (ст. 190)',
    source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'substitute', title: 'Замещающий на месте', enabled: true, params: {},
    severity: 'block', severityByStage: { approved: 'warn' },
    basis: 'Регламент: в заявлении указывается коллега, который будет замещать', source: 'regulation', appliesToBeneficiaries: true,
  },
  {
    code: 'changeLocked', title: 'Начавшийся отпуск сотрудник не меняет', enabled: true, params: {},
    severity: 'block', basis: 'ст. 171, 174 ТК: продление по болезни и отзыв оформляет отдел кадров', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'halfYearDeadline', title: 'Заявление на полугодие — до 15 января и 15 июля', enabled: true,
    params: { h1Month: 1, h1Day: 15, h2Month: 7, h2Day: 15 },
    severity: 'block', severityByStage: { adhoc: 'off', approved: 'off' },
    basis: 'Регламент: график на полугодие', source: 'regulation', appliesToBeneficiaries: true,
    legalRisk: 'ТК (ч. 2 ст. 168): график утверждается на календарный год до 5 января; иной срок — только по коллективному договору или с профсоюзом',
  },
  {
    code: 'payRequest', title: 'Отпускные — по заявлению, не больше оклада', enabled: true, params: {},
    severity: 'info', basis: 'Регламент: отпускные', source: 'regulation', appliesToBeneficiaries: true,
    legalRisk: 'ст. 175–176 ТК: отпускные выплачиваются без заявления, не позднее чем за 2 дня, в размере среднего заработка',
  },
  {
    code: 'treatmentLeave', title: 'Плановое лечение — по правилам отпусков', enabled: true,
    params: {}, severity: 'info', basis: 'Регламент: плановое лечение', source: 'regulation', appliesToBeneficiaries: true,
    legalRisk: 'В части лечения противоречит ст. 171 ТК: лечение — временная нетрудоспособность, а не отпуск',
  },
  {
    code: 'holidays', title: 'Праздники в отпуск не входят', enabled: true, params: {},
    severity: 'info', basis: 'ч. 2 ст. 151, ч. 1 ст. 147 ТК', source: 'law', appliesToBeneficiaries: true,
  },
  {
    code: 'scheduleDeadline', title: 'График на год утвердить до 5 января', enabled: true, params: { month: 1, day: 5 },
    severity: 'info', basis: 'ч. 2 ст. 168 ТК', source: 'law', appliesToBeneficiaries: true,
  },
];

/** Иерархия регламента: лимит одновременно в отпуске и «кто без кого не уходит». */
export const DEFAULT_ROLES: RolePolicy[] = [
  { role: 'ИД', name: 'исполнительный директор', groupLabel: 'Руководство: ИД и заместители', dependsOn: [{ role: 'ЗАВ', scope: 'company' }, { role: 'ЗТВ', scope: 'company' }] },
  { role: 'ЗАВ', name: 'заместитель директора (ЗАВ)', groupLabel: 'Руководство: ИД и заместители', dependsOn: [{ role: 'ИД', scope: 'company' }] },
  { role: 'ЗТВ', name: 'заместитель директора (ЗТВ)', groupLabel: 'Руководство: ИД и заместители', dependsOn: [{ role: 'ИД', scope: 'company' }] },
  { role: 'РО', name: 'руководитель отделения', groupLabel: 'Руководители отделений и заместитель', peerScope: 'same-manager', limit: 1, dependsOn: [{ role: 'ЗАВ', scope: 'own-manager' }, { role: 'ЗТВ', scope: 'own-manager' }] },
  { role: 'НО', name: 'начальник отдела', groupLabel: 'Начальники отделов и руководитель отделения', peerScope: 'unit', limit: 1, dependsOn: [{ role: 'РО', scope: 'unit' }] },
  { role: 'МС', name: 'менеджер секции', groupLabel: 'Менеджеры секций и начальник отдела', peerScope: 'dept', limit: 1, dependsOn: [{ role: 'НО', scope: 'dept' }] },
  { role: 'МПП', name: 'менеджер по продажам', groupLabel: 'Менеджеры по продажам', peerScope: 'company', limit: 2 },
  { role: 'СП', name: 'специалист', groupLabel: 'Без ограничений по составу' },
];

/**
 * Правила, результат которых зависит от дат частей: сдвиг дат может их исправить.
 * Остальные (норма, число частей, часть от 14 дней, перенос, срок графика) от дат не зависят.
 */
export const DATE_BOUND_RULES: readonly RuleCode[] = [
  'pastDates', 'groupLimit', 'roleDependencies', 'summerLength', 'noticeMonth', 'firstVacation', 'noOverlap', 'holidays', 'substitute',
  'halfYearDeadline',
];

export const DEFAULT_SETTINGS: Settings = {
  year: 2027,
  regulationDeadlines: ['2027-01-15', '2027-07-15'],
  collectiveAgreement: false,
};

export const DEFAULT_OCCUPYING: PartStatus[] = ['pending', 'approved'];

export function ruleOf(rules: RuleConfig[], code: RuleCode): RuleConfig {
  const r = rules.find((x) => x.code === code);
  if (r) return r;
  const d = DEFAULT_RULES.find((x) => x.code === code);
  if (!d) throw new Error(`Нет правила ${code}`);
  // правила нет в конфигурации — значит, выключено
  return { ...d, enabled: false };
}

export function param(rule: RuleConfig, key: string): number {
  const v = rule.params[key];
  if (typeof v === 'number' && !isNaN(v)) return v;
  const d = DEFAULT_RULES.find((x) => x.code === rule.code)?.params[key];
  if (d === undefined) throw new Error(`У правила ${rule.code} нет параметра ${key}`);
  return d;
}

export function policyOf(roles: RolePolicy[], role: RoleCode): RolePolicy {
  return roles.find((r) => r.role === role) ?? { role, name: role };
}

/**
 * «Сегодня» для проверок — единственный источник. Для демо его можно зафиксировать переменной
 * окружения DEMO_TODAY=2026-10-26 (на сервере); иначе — текущая дата по Минску.
 */
export function todayIso(): IsoDate {
  const fixed = typeof process !== 'undefined' ? process.env?.DEMO_TODAY : undefined;
  if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
  return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
}

/** Контекст с умолчаниями: достаточно сотрудников и планов */
export function createContext(input: Partial<CheckContext> & { employees: Employee[]; plans: Plan[] }): CheckContext {
  return {
    today: input.today ?? todayIso(),
    stage: input.stage ?? 'collect',
    employees: input.employees,
    plans: input.plans,
    roles: input.roles ?? DEFAULT_ROLES,
    rules: input.rules ?? DEFAULT_RULES,
    exceptions: input.exceptions ?? [],
    occupying: input.occupying ?? DEFAULT_OCCUPYING,
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    submitting: input.submitting ?? false,
  };
}
