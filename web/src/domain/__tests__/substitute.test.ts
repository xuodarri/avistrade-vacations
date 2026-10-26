import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../config';
import { substituteCandidates } from '../engine';
import { dbRuleCode } from '../fromDb';
import { check, ctxWith, emp } from './helpers';

const on = { rules: DEFAULT_RULES };
// E14 (Петров) в отпуске 7–20 июня и 16–25 августа
const july = (substituteId?: string | null, status: 'draft' | 'pending' = 'pending') =>
  [{ start: '2027-06-14', end: '2027-06-27', substituteId, status }];

describe('замещающий на месте (R15)', () => {
  it('код в базе — R15, зависит от дат', () => {
    expect(dbRuleCode('substitute')).toBe('R15');
    const [r] = check('E18', [{ start: '2027-03-01', end: '2027-03-14', substituteId: 'E19x' }], on).of('substitute');
    expect(r.dateBound).toBe(true);
  });

  it('не указан в черновике — предупреждение', () => {
    const [r] = check('E18', july(null, 'draft'), on).of('substitute');
    expect(r).toMatchObject({ status: 'warn', message: 'Часть 1: укажите, кто вас замещает' });
  });

  it('не указан при отправке — запрет', () => {
    const [r] = check('E18', july(null, 'draft'), { ...on, submitting: true }).of('substitute');
    expect(r).toMatchObject({ status: 'block', message: 'Часть 1: укажите, кто вас замещает' });
  });

  it('не указан у поданной части — предупреждение «не указан»', () => {
    expect(check('E18', july(null), on).of('substitute')[0]).toMatchObject({ status: 'warn', message: 'Часть 1: замещающий не указан' });
  });

  it('указан и свободен', () => {
    expect(check('E18', july('E16'), on).of('substitute')[0]).toMatchObject({ status: 'ok', message: 'Замещающий на месте' });
  });

  it('указан и в отпуске — запрет, дни пересечения в результате', () => {
    const [r] = check('E18', july('E14'), on).of('substitute');
    expect(r).toMatchObject({
      status: 'block', employeeIds: ['E14'], dates: [{ start: '2027-06-14', end: '2027-06-20' }],
      message: 'Часть 1: замещающий в отпуске 14–20 июня — выберите другого коллегу или сдвиньте даты',
    });
    expect(r.message).not.toContain('Петров');
  });

  it('для отпуска из графика — предупреждение; исключение HR снимает', () => {
    const approved = [{ start: '2027-06-14', end: '2027-06-27', substituteId: 'E14', status: 'approved' as const }];
    expect(check('E18', approved, on).of('substitute')[0].status).toBe('warn');
    const x = { id: 'X', employeeId: 'E18', ruleCode: 'substitute' as const, partId: 'E18-p1', reason: 'Замещает НО' };
    expect(check('E18', july('E14'), { ...on, exceptions: [x] }).of('substitute')[0].status).toBe('exception');
  });

  it('сам себя или уволенный — запрет', () => {
    expect(check('E18', july('E18'), on).of('substitute')[0].message).toBe('Часть 1: замещающим указан сам сотрудник');
    const employees = ctxWith().employees.map((e) => (e.id === 'E10' ? { ...e, dismissed: true } : e));
    const [r] = check('E18', july('E10'), { ...on, employees }).of('substitute');
    expect(r).toMatchObject({ status: 'block', message: 'Часть 1: замещающий не найден среди работающих сотрудников' });
  });

  it('уволен к концу части — не может замещать; уволен позже — может', () => {
    const at = (dismissedOn: string) => ctxWith().employees.map((e) => (e.id === 'E16' ? { ...e, dismissedOn } : e));
    expect(check('E18', july('E16'), { ...on, employees: at('2027-06-20') }).of('substitute')[0].status).toBe('block');
    expect(check('E18', july('E16'), { ...on, employees: at('2027-09-01') }).of('substitute')[0].status).toBe('ok');
  });

  it('уволенного нет среди кандидатов', () => {
    const employees = ctxWith().employees.map((e) => (e.id === 'E16' ? { ...e, dismissedOn: '2027-01-31' } : e));
    expect(substituteCandidates(emp('E13'), { start: '2027-06-14', end: '2027-06-27' }, ctxWith({ employees })).some((c) => c.employeeId === 'E16')).toBe(false);
  });
});

describe('кандидаты в замещающие', () => {
  const list = substituteCandidates(emp('E13'), { start: '2027-06-14', end: '2027-06-27' }, ctxWith());

  it('без самого сотрудника; сначала свой отдел, внутри — свободные раньше', () => {
    expect(list.some((c) => c.employeeId === 'E13')).toBe(false);
    const dept = list.filter((c) => c.sameDept);
    expect(list.slice(0, dept.length)).toEqual(dept);
    // отдел оптовых продаж: E09, E14, E15, E16, E17; в эти дни в отпуске E14 и E15
    expect(dept.map((c) => c.employeeId).sort()).toEqual(['E09', 'E14', 'E15', 'E16', 'E17']);
    expect(dept.slice(0, 3).every((c) => c.free)).toBe(true);
    expect(dept.slice(3).map((c) => c.employeeId).sort()).toEqual(['E14', 'E15']);
    // дальше отделение, потом остальные
    const unit = list.findIndex((c) => !c.sameDept && c.sameUnit), other = list.findIndex((c) => !c.sameUnit);
    expect(unit).toBeGreaterThan(dept.length - 1);
    expect(other).toBeGreaterThan(unit);
  });

  it('у занятого — дни пересечения', () => {
    expect(list.find((c) => c.employeeId === 'E14')).toMatchObject({ free: false, busy: [{ start: '2027-06-14', end: '2027-06-20' }] });
    expect(list.find((c) => c.employeeId === 'E15')).toMatchObject({ free: false, busy: [{ start: '2027-06-14', end: '2027-06-27' }] });
  });
});
