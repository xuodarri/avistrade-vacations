import { describe, expect, it } from 'vitest';
import type * as Db from '../../server/db/types';
import { DEFAULT_ROLES } from '../config';
import { checkPlan } from '../engine';
import { dbRuleCode, employeeFromDb, exceptionsFromDb, planFromDb, rolesFromDb, rulesFromDb } from '../fromDb';
import { groupOf } from '../groups';
import { SAMPLE_EMPLOYEES } from '../sample';
import { check, ctxWith, emp } from './helpers';

// группы, роли и зависимости — как в сиде базы (src/server/db/seed.ts)
const groups: Db.LimitGroup[] = [
  { id: 1, code: 'sales', name: 'Менеджеры по продажам', roleCode: 'МПП', scope: 'отдел', maxConcurrent: 2, regClause: 'п. 1' },
  { id: 2, code: 'ms', name: 'Менеджеры секций отдела', roleCode: 'МС', scope: 'отдел', maxConcurrent: 1, regClause: 'п. 2' },
  { id: 3, code: 'no', name: 'Начальники отделов отделения', roleCode: 'НО', scope: 'отделение', maxConcurrent: 1, regClause: 'п. 2' },
  { id: 4, code: 'ro', name: 'Руководители отделений', roleCode: 'РО', scope: 'тот же руководитель', maxConcurrent: 1, regClause: 'п. 2' },
];
const role = (code: Db.RoleCode, title: string, groupId: number | null): Db.Role => ({ code, title, groupId, calendarGroup: title, regClause: '' });
const roles: Db.Role[] = [
  role('ИД', 'Исполнительный директор', null), role('ЗАВ', 'Заместитель директора (ЗАВ)', null),
  role('ЗТВ', 'Заместитель директора (ЗТВ)', null), role('РО', 'Руководитель отделения', 4), role('НО', 'Начальник отдела', 3),
  role('МС', 'Менеджер секции', 2), role('МПП', 'Менеджер по продажам', 1), role('СП', 'Специалист', null),
];
const dep = (id: number, roleCode: Db.RoleCode, requiresRole: Db.RoleCode, scope: Db.Scope): Db.RoleDependency =>
  ({ id, roleCode, requiresRole, scope, regClause: 'п. 2' });
const deps: Db.RoleDependency[] = [
  dep(1, 'ИД', 'ЗАВ', 'вся компания'), dep(2, 'ИД', 'ЗТВ', 'вся компания'), dep(3, 'ЗАВ', 'ИД', 'вся компания'),
  dep(4, 'ЗТВ', 'ИД', 'вся компания'), dep(5, 'РО', 'ЗАВ', 'свой руководитель'), dep(6, 'РО', 'ЗТВ', 'свой руководитель'),
  dep(7, 'НО', 'РО', 'отделение'), dep(8, 'МС', 'НО', 'отдел'),
];

const rule = (code: string, value: number | null, sev: Db.Severity, stages: Db.RuleParams['stages'], source: Db.Rule['source'], benefitApplies = true): Db.Rule =>
  ({ code, title: code, params: { value, stages, benefitApplies }, enabled: true, severity: sev, source, basis: 'основание', howChecked: '' });

describe('перевод из базы', () => {
  it('сотрудник', () => {
    const e: Db.Employee = {
      id: 'E17', fullName: 'Лис Наталья Петровна', email: '', position: 'Менеджер по продажам', roleCode: 'МПП',
      division: 'Оптовое отделение', department: 'отдел оптовых продаж', managerId: 'E09', hiredOn: '2020-03-10',
      baseDays: 24, extraDays: 0, benefit: 'мать двоих и более детей до 14 лет', under18: false, ackOn: null, isHr: false,
      dismissedOn: null, benefit189: null,
    };
    expect(employeeFromDb(e)).toEqual(SAMPLE_EMPLOYEES.find((x) => x.id === 'E17'));
  });

  it('роли из базы дают те же группы, что политики по умолчанию', () => {
    const fromDb = rolesFromDb(roles, groups, deps);
    for (const e of SAMPLE_EMPLOYEES) {
      const a = groupOf(e, SAMPLE_EMPLOYEES, fromDb), b = groupOf(e, SAMPLE_EMPLOYEES, DEFAULT_ROLES);
      expect({ id: e.id, m: a.memberIds, l: a.limit, d: a.dependencyIds }).toEqual({ id: e.id, m: b.memberIds, l: b.limit, d: b.dependencyIds });
    }
  });

  it('правило: N, жёсткость по этапам, льготники, источник', () => {
    const [r] = rulesFromDb([rule('R03', 21, 'warn', { collect: 'warn', adhoc: 'block', inplan: 'off' }, 'регламент', false)]);
    expect(r).toMatchObject({
      code: 'summerLength', params: { days: 21 }, severity: 'warn',
      severityByStage: { collect: 'warn', adhoc: 'block', approved: 'off' }, source: 'regulation', appliesToBeneficiaries: false,
    });
    // R11 движок не проверяет; нормы закона, которых нет в базе, добавляются по умолчанию
    expect(rulesFromDb([rule('R11', 15, 'info', {}, 'ТК')]).map((r) => r.code)).toEqual(['pastDates', 'unpaid190Limit', 'unpaid189Limit', 'changeLocked']);
  });

  it('HR выключил правило на этапе сбора графика', () => {
    const rules = rulesFromDb([rule('R01', null, 'off', { collect: 'block', adhoc: 'block', inplan: 'warn' }, 'регламент', false)]);
    expect(check('E13', [['2027-06-14', '2027-06-27']], { rules }).of('groupLimit')[0].status).toBe('off');
  });

  it('исключения: только действующие «разрешить»', () => {
    const x = (id: number, decision: Db.ExceptionDecision, active: boolean): Db.RuleException => ({
      id, createdAt: '2026-10-22T10:15:00.000Z', createdBy: 'E19', employeeId: 'E05', partId: 9, ruleCode: 'R01', decision, reason: 'причина', active,
    });
    expect(exceptionsFromDb([x(1, 'allow', true), x(2, 'return', true), x(3, 'allow', false)])).toEqual([
      { id: '1', employeeId: 'E05', ruleCode: 'groupLimit', partId: '9', reason: 'причина', approvedBy: 'E19', approvedOn: '2026-10-22' },
    ]);
    expect(dbRuleCode('groupLimit')).toBe('R01');
  });

  it('план из частей экрана и из базы', () => {
    const plan = planFromDb('E13', 2027, [
      { type: 'main', startDate: '2027-06-21', endDate: '2027-07-05' },
      { id: 42, requestId: 1, partNo: 2, type: 'main', startDate: '2027-09-06', endDate: '2027-09-15', days: 10, status: 'approved', inSchedule: true, result: null, notes: null,
        substituteId: null, treatmentKind: null, needsPay: false, reason: null, reasonNote: null },
    ], '2026-11-20T08:00:00.000Z');
    expect(plan.parts.map((p) => [p.id, p.status, p.submittedOn])).toEqual([['new-1', 'draft', '2026-11-20'], ['42', 'approved', '2026-11-20']]);
    expect(checkPlan(emp('E13'), plan, ctxWith()).status).toBe('ok');
  });
});

describe('частей не больше 3', () => {
  it('четыре части — запрет', () => {
    const [r] = check('E18', [['2027-02-01', '2027-02-14'], ['2027-04-05', '2027-04-07'], ['2027-09-06', '2027-09-09'], ['2027-11-01', '2027-11-03']])
      .of('maxParts');
    expect(r).toMatchObject({ status: 'block', message: 'Частей 4, можно не больше 3' });
  });
});
