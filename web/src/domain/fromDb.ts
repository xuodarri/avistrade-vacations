/**
 * Перевод строк базы (`@/server/db/types`) в типы движка и обратно. Только типы и чистые
 * функции: в базу не ходит, поэтому годится и на сервере, и в клиентском компоненте.
 *
 * Коды правил в базе — R01…R14 (как в мастер-таблице на Таблицах), в движке — смысловые.
 * R11 (напоминание об уведомлении) и R12 (ст. 189 — только даты) движок отдельными правилами
 * не проверяет: ст. 189 выводит из-под лимитов сам тип части.
 */
import type * as Db from '../server/db/types';
import type {
  Employee, HrException, PartChange, Plan, PartStatus, RolePolicy, RuleCode, RuleConfig, Scope, Severity, Stage, VacationPart,
} from './types';
import { DEFAULT_RULES } from './config';

/** Код правила в базе → код движка и имя числового параметра (N из названия правила) */
export const DB_RULES: Record<string, { code: RuleCode; param?: string }> = {
  R00: { code: 'pastDates', param: 'daysAhead' },
  R01: { code: 'groupLimit' },
  R02: { code: 'roleDependencies' },
  R03: { code: 'summerLength', param: 'days' },
  R04: { code: 'noticeMonth', param: 'days' },
  R05: { code: 'longPart', param: 'days' },
  R06: { code: 'yearNorm' },
  R07: { code: 'noOverlap' },
  R08: { code: 'holidays' },
  R09: { code: 'firstVacation', param: 'months' },
  R10: { code: 'maxParts', param: 'parts' },
  R13: { code: 'scheduleDeadline' },
  R14: { code: 'rescheduleNotice', param: 'days' },
  R15: { code: 'substitute' },
  R16: { code: 'unpaid190Limit', param: 'days' },
  R17: { code: 'unpaid189Limit', param: 'days' },
  R18: { code: 'payRequest' },
  R19: { code: 'halfYearDeadline' },
  R20: { code: 'treatmentLeave' },
  R21: { code: 'changeLocked' },
};

/** Нормы закона, которые действуют и без строки в базе */
const LAW_DEFAULTS: RuleCode[] = ['pastDates', 'unpaid190Limit', 'unpaid189Limit', 'changeLocked'];

/** Код движка → код в базе (для исключений HR и подписей «R01») */
export function dbRuleCode(code: RuleCode): string {
  return Object.keys(DB_RULES).find((k) => DB_RULES[k].code === code) ?? code;
}

const SCOPES: Record<Db.Scope, Scope> = {
  'вся компания': 'company',
  'отделение': 'unit',
  'отдел': 'dept',
  'тот же руководитель': 'same-manager',
  'свой руководитель': 'own-manager',
};

export function employeeFromDb(e: Db.Employee): Employee {
  return {
    id: e.id, name: e.fullName, role: e.roleCode, title: e.position, unit: e.division,
    ...(e.department ? { dept: e.department } : {}),
    ...(e.managerId ? { managerId: e.managerId } : {}),
    hiredOn: e.hiredOn, normDays: e.baseDays, extraDays: e.extraDays,
    ...(e.benefit ? { benefits: [e.benefit] } : {}),
    ...(e.under18 ? { minor: true } : {}),
    ...(e.dismissedOn ? { dismissedOn: e.dismissedOn } : {}),
    ...(e.benefit189 ? { benefit189: e.benefit189 } : {}),
  };
}

/** Роли, группы ограничения и зависимости ролей → политики ролей */
export function rolesFromDb(roles: Db.Role[], groups: Db.LimitGroup[], deps: Db.RoleDependency[]): RolePolicy[] {
  return roles.map((r) => {
    const g = groups.find((x) => x.id === r.groupId);
    const d = deps.filter((x) => x.roleCode === r.code);
    return {
      role: r.code,
      name: r.title.charAt(0).toLowerCase() + r.title.slice(1),
      groupLabel: r.calendarGroup,
      ...(g ? { peerScope: SCOPES[g.scope], limit: g.maxConcurrent } : {}),
      ...(d.length ? { dependsOn: d.map((x) => ({ role: x.requiresRole, scope: SCOPES[x.scope] })) } : {}),
    };
  });
}

function riskText(p: Db.RuleParams): string | undefined {
  if (typeof p.legalRisk === 'string' && p.legalRisk) return p.legalRisk;
  if (p.legalRisk && typeof p.legalNote === 'string' && p.legalNote) return p.legalNote;
  return undefined;
}

/**
 * Правила из базы; неизвестные коды пропускаются. Правила, которых нет в базе, выключены — кроме
 * новых норм закона LAW_DEFAULTS: они действуют по умолчанию.
 */
export function rulesFromDb(rules: Db.Rule[]): RuleConfig[] {
  const out: RuleConfig[] = [];
  for (const r of rules) {
    const map = DB_RULES[r.code];
    const base = map && DEFAULT_RULES.find((x) => x.code === map.code);
    if (!map || !base) continue;
    // severity в базе — жёсткость при сборке графика (её правит HR), stages — для остальных этапов
    const stages = r.params.stages ?? {};
    const byStage: Partial<Record<Stage, Severity | 'off'>> = { collect: r.severity };
    if (stages.adhoc) byStage.adhoc = stages.adhoc;
    if (stages.inplan) byStage.approved = stages.inplan;
    const value = r.params.value;
    out.push({
      code: map.code,
      title: r.title,
      enabled: r.enabled,
      params: map.param && typeof value === 'number' ? { ...base.params, [map.param]: value } : base.params,
      severity: r.severity === 'off' ? base.severity : r.severity,
      severityByStage: byStage,
      basis: r.basis,
      source: r.source === 'ТК' ? 'law' : 'regulation',
      appliesToBeneficiaries: r.params.benefitApplies ?? base.appliesToBeneficiaries,
      // пометка риска: params.legalRisk — текст или true с текстом в params.legalNote
      ...(riskText(r.params) ?? base.legalRisk ? { legalRisk: riskText(r.params) ?? base.legalRisk } : {}),
    });
  }
  // новые нормы закона (R00, R16, R17) действуют, даже если строки в базе ещё нет
  for (const d of DEFAULT_RULES) if (LAW_DEFAULTS.includes(d.code) && !out.some((x) => x.code === d.code)) out.push(d);
  return out;
}

/** Части заявки из базы или с экрана (у новых частей id нет) → план */
export function planFromDb(
  employeeId: string, year: number, parts: (Db.RequestPart | Db.PartInput)[], submittedOn?: string | null,
): Plan {
  return {
    employeeId, year,
    parts: parts.map((p, i): VacationPart => ({
      id: p.id != null ? String(p.id) : `new-${i + 1}`,
      type: p.type,
      start: p.startDate,
      end: p.endDate,
      status: ('status' in p ? p.status : 'draft') as PartStatus,
      ...(p.substituteId ? { substituteId: p.substituteId } : {}),
      ...(p.needsPay ? { needsPay: true } : {}),
      ...(submittedOn ? { submittedOn: submittedOn.slice(0, 10) } : {}),
    })),
  };
}

/**
 * Действующие исключения «разрешить» → исключения движка. parts — сохранённые части: даты части
 * из базы становятся датами исключения, и к той же части на других датах (сдвиг на экране,
 * перенос) оно уже не применяется.
 */
export function exceptionsFromDb(list: Db.RuleException[], parts: Db.RequestPart[] = []): HrException[] {
  return list
    .filter((x) => x.active && x.decision === 'allow' && DB_RULES[x.ruleCode])
    .map((x) => {
      const p = x.partId != null ? parts.find((y) => y.id === x.partId) : undefined;
      return {
        id: String(x.id), employeeId: x.employeeId, ruleCode: DB_RULES[x.ruleCode].code, reason: x.reason,
        approvedBy: x.createdBy, approvedOn: x.createdAt.slice(0, 10),
        ...(x.partId != null ? { partId: String(x.partId) } : {}),
        ...(p ? { dates: { start: p.startDate, end: p.endDate } } : {}),
      };
    });
}

/**
 * Заявка на изменение части из базы. extend и recall (их оформляет HR, сразу согласованы и уже
 * применены к части) движку как заявки не нужны — null.
 */
export function changeFromDb(c: Db.PartChange): PartChange | null {
  if (c.kind !== 'move' && c.kind !== 'shorten' && c.kind !== 'cancel') return null;
  return {
    id: String(c.id), employeeId: c.employeeId, partId: String(c.partId), kind: c.kind,
    ...(c.newStart ? { newStart: c.newStart } : {}),
    ...(c.newEnd ? { newEnd: c.newEnd } : {}),
    reason: c.reason, requestedOn: c.requestedOn, status: c.status,
  };
}
