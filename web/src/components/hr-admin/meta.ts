/**
 * Подписи и юридические пометки экранов HR: правила, журнал. Чистый TS — годится и для
 * серверных функций, и для клиентских компонентов. Сверка регламента с ТК —
 * `avistrade-test/reports/ТК РБ об отпусках для прототипа.md`.
 */
import type { RoleCode, Rule, Scope, Severity, Stage } from "@/server/db/types";
import { fmtDate } from "@/lib/dates";

/**
 * Режим правила регламента по смыслу: «запрет» регламента не останавливает план — сотрудник
 * отправляет его с запросом исключения, решает HR (consequence: exception).
 */
export const SEVERITY_LABEL: Record<Severity, string> = {
  block: "Нужно исключение", warn: "Предупреждение", info: "Справка", off: "Не проверять",
};
/** Режим нормы ТК: «запрет» закона не снимается ничем (consequence: law). */
export const LAW_LABEL: Record<Severity, string> = {
  block: "Нельзя нарушить", warn: "Предупреждение", info: "Справка", off: "Не проверяется",
};

/** Подпись режима у нормы ТК с двумя порогами. */
export const LAW_MODE: Record<string, string> = {
  R16: "Сверх N — предупреждение, сверх 90 — нельзя",
};
export const SEVERITIES: Severity[] = ["block", "warn", "info", "off"];

export const STAGE_LABEL: Record<Stage, string> = {
  collect: "Сбор графика", adhoc: "Заявка вне графика", inplan: "Отпуск уже в графике",
};
export const STAGES: Stage[] = ["collect", "adhoc", "inplan"];

export const SCOPES: Scope[] = ["отдел", "отделение", "тот же руководитель", "свой руководитель", "вся компания"];
export const SCOPE_TEXT: Record<Scope, string> = {
  "отдел": "в своём отделе", "отделение": "в своём отделении", "тот же руководитель": "у того же руководителя",
  "свой руководитель": "свой руководитель", "вся компания": "во всей компании",
};

/** Строгость при сборке графика, если у правила выбор уже обычного «запрет / предупреждение / справка». */
export const MAIN_SEVERITIES: Record<string, Severity[]> = {
  // замещающий не указан или сам в отпуске — справкой это не бывает
  R15: ["block", "warn"],
};

/** Числовой параметр правила регламента: единицы и разумные границы. */
export const PARAM_META: Record<string, { unit: [string, string, string]; min: number; max: number; hint: string }> = {
  R03: { unit: ["день", "дня", "дней"], min: 1, max: 92, hint: "дней летом в одной части" },
  R04: { unit: ["день", "дня", "дней"], min: 0, max: 90, hint: "дней от заявки до начала" },
  R10: { unit: ["часть", "части", "частей"], min: 1, max: 10, hint: "частей в плане" },
  R14: { unit: ["день", "дня", "дней"], min: 0, max: 60, hint: "дней до прежнего начала" },
};

export function plural(n: number, [one, few, many]: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Жёсткость правила на этапе: при сборке графика — колонка severity, остальное — params.stages. */
export function stageSeverity(r: Pick<Rule, "severity" | "params">, s: Stage): Severity {
  return s === "collect" ? r.severity : r.params.stages?.[s] ?? r.severity;
}

/** Название правила с подставленным N. */
export function ruleTitle(r: Pick<Rule, "title" | "params">) {
  const v = r.params.value;
  return typeof v === "number" ? r.title.replace(/\bN\b/, String(v)) : r.title;
}

export interface LegalRisk {
  stage?: Stage | "benefit";
  text: string;
}

const HOLIDAY_PRIORITY =
  "Льготники ч. 4 ст. 168 ТК (мать двоих детей до 14 лет, совместитель и др.) получают отпуск в удобное время — лимиты регламента против них не действуют.";

/**
 * Где правило регламента выходит за ТК. Вывод сверки: лимиты регламента законны как критерии
 * планирования — жёстко при сборке графика, иначе только предупреждение (ст. 7 ч. 2, ст. 168 ч. 1).
 */
export function legalRisks(r: Pick<Rule, "code" | "severity" | "params" | "enabled">): LegalRisk[] {
  if (!r.enabled) return [];
  const sev = (s: Stage) => stageSeverity(r, s);
  const out: LegalRisk[] = [];
  switch (r.code) {
    case "R01":
    case "R02":
    case "R15":
      if (sev("inplan") === "block")
        out.push({ stage: "inplan", text: "Утверждённый график обязателен для обеих сторон и меняется только по соглашению (ст. 171). Запретить отпуск, который уже стоит в графике, наниматель не может — здесь законно только предупреждение." });
      break;
    case "R03":
      for (const s of ["collect", "adhoc", "inplan"] as Stage[])
        if (sev(s) === "block") {
          out.push({ stage: s, text: "Ограничение длины летом на деле делит отпуск, а делить его можно только по соглашению с работником (ч. 1 ст. 174). Законно — предупреждение «нужна договорённость», а не запрет." });
          break;
        }
      break;
    case "R04":
      for (const s of ["collect", "inplan"] as Stage[])
        if (sev(s) === "block") {
          out.push({ stage: s, text: "Для отпуска по графику ТК не требует заявления: уведомляет наниматель, за 15 дней (ст. 169). Жёстко срок подачи можно применять только к заявкам вне графика." });
          break;
        }
      break;
    // отпускные, полугодия и плановое лечение по регламенту расходятся с ТК: применяем по решению компании, но всегда помечаем риск
    case "R18":
    case "R19":
    case "R20":
      out.push({ text: CONTRADICTS_TK.find((x) => x.code === r.code)!.why });
      break;
    // R14 без риска: перенос по соглашению и так требует согласия нанимателя (п. 6 ч. 1 ст. 171), поздний — через
    // исключение HR; болезнь и другие основания ст. 171 оформляет HR, срок заявки к ним не относится
  }
  if (["R01", "R02", "R03", "R15"].includes(r.code) && r.params.benefitApplies)
    out.push({ stage: "benefit", text: HOLIDAY_PRIORITY });
  return out;
}

export const PENALTY_NOTE = "За нарушение порядка предоставления отпусков — штраф по ст. 10.12 КоАП; правило, ухудшающее положение работника по сравнению с ТК, недействительно (ч. 2 ст. 7 ТК).";

/** Пункты регламента, которые система не проверяет: противоречат ТК. */
export const CONTRADICTS_TK = [
  {
    code: "R18", clause: "отпускные", title: "Отпускные — по заявлению, не больше оклада",
    why: "Сохраняется средний заработок и выплачивается не позднее чем за 2 дня до отпуска без всякого заявления (ст. 175–176). Урезание до оклада — недоплата.",
  },
  {
    code: "R19", clause: "полугодия", title: "График на полугодие: до 15 января и до 15 июля",
    why: "График составляется на календарный год не позднее 5 января (ч. 2 ст. 168); иной срок — только по коллективному договору или с профсоюзом. Июльский пересмотр — изменения по соглашению.",
  },
  {
    code: "R20", clause: "лечение", title: "Правила отпусков распространяются на плановое лечение",
    why: "Лечение — временная нетрудоспособность по листку, а не отпуск (ст. 171 ч. 1 п. 1). Сведения о здоровье — специальные персональные данные, в графике им не место.",
  },
];

/** Иванова Анна Сергеевна → Иванова А. С. */
export function shortName(full: string) {
  const [last, ...rest] = full.split(" ");
  return [last, ...rest.map((p) => `${p[0]}.`)].join(" ");
}

export interface FieldChange {
  label: string;
  before: string;
  after: string;
  /** Изменение ушло в юридический риск */
  risky?: boolean;
}

const yesNo = (v: unknown) => (v ? "да" : "нет");

/** Чем отличаются две версии правила — подписи для панели изменений и журнала. */
export function ruleChanges(before: Rule, after: Rule): FieldChange[] {
  const out: FieldChange[] = [];
  if (before.enabled !== after.enabled) out.push({ label: "Включено", before: yesNo(before.enabled), after: yesNo(after.enabled) });
  if (before.params.value !== after.params.value)
    out.push({ label: "Параметр N", before: String(before.params.value ?? "—"), after: String(after.params.value ?? "—") });
  const risks = new Set(legalRisks(after).map((r) => r.stage));
  for (const s of STAGES) {
    const a = stageSeverity(before, s), b = stageSeverity(after, s);
    if (a !== b) out.push({ label: STAGE_LABEL[s], before: SEVERITY_LABEL[a], after: SEVERITY_LABEL[b], risky: risks.has(s) });
  }
  if (!!before.params.benefitApplies !== !!after.params.benefitApplies)
    out.push({ label: "Льготникам ч. 4 ст. 168", before: yesNo(before.params.benefitApplies), after: yesNo(after.params.benefitApplies), risky: risks.has("benefit") });
  if (before.title !== after.title) out.push({ label: "Название", before: before.title, after: after.title });
  if (before.basis !== after.basis) out.push({ label: "Основание", before: before.basis, after: after.basis });
  return out;
}

/* ---------------- карточка сотрудника ---------------- */

/** Поля карточки сотрудника, которые правит HR (строка employees или черновик экрана). */
export interface PersonFields {
  fullName: string; position: string; division: string; department: string | null; managerId: string | null;
  roleCode: RoleCode; isHr: boolean; benefit: string | null; benefit189?: string | null; under18: boolean;
  hiredOn: string; baseDays: number; extraDays: number;
}

/** «Было → стало» по карточке; before = null — новый сотрудник. */
export function personChanges(
  before: PersonFields | null, after: PersonFields,
  l: {
    name: (id: string | null) => string | null; roleTitle: (c: RoleCode) => string; groupOf: (c: RoleCode) => string | null;
    label189: (code: string | null) => string | null;
  },
): FieldChange[] {
  const out: FieldChange[] = [];
  const days = (n: number) => `${n} ${plural(n, ["день", "дня", "дней"])}`;
  const add = (label: string, b: string | null | undefined, a: string | null | undefined, risky?: boolean) => {
    if ((b ?? "") !== (a ?? "")) out.push({ label, before: b ?? (before ? "нет" : ""), after: a ?? "нет", ...(risky ? { risky } : {}) });
  };
  add("ФИО", before?.fullName, after.fullName);
  add("Должность", before?.position, after.position);
  add("Отделение", before?.division, after.division);
  add("Отдел", before?.department, after.department);
  add("Руководитель", before ? l.name(before.managerId) : null, l.name(after.managerId));
  add("Роль", before ? l.roleTitle(before.roleCode) : null, l.roleTitle(after.roleCode));
  add("Группа лимита", before ? l.groupOf(before.roleCode) ?? "без группы" : null, l.groupOf(after.roleCode) ?? "без группы");
  if (!before ? after.isHr : before.isHr !== after.isHr)
    out.push({ label: "Доступ HR", before: before ? (before.isHr ? "есть" : "нет") : "", after: after.isHr ? "есть" : "нет" });
  add("Льгота ч. 4 ст. 168", before?.benefit, after.benefit);
  add("Категория по ст. 189", before ? l.label189(before.benefit189 ?? null) : null, l.label189(after.benefit189 ?? null));
  if (!before ? after.under18 : before.under18 !== after.under18)
    out.push({ label: "Младше 18 лет", before: before ? (before.under18 ? "да" : "нет") : "", after: after.under18 ? "да" : "нет" });
  add("Дата приёма", before ? fmtDate(before.hiredOn, true) : null, fmtDate(after.hiredOn, true));
  add("Основной отпуск", before ? days(before.baseDays) : null, days(after.baseDays));
  add("Дополнительный", before ? days(before.extraDays) : null, days(after.extraDays));
  return out;
}
