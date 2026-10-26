import { describe, expect, it } from 'vitest';
import { checkChange } from '../change';
import { exceptionsFromDb } from '../fromDb';
import type * as Db from '../../server/db/types';
import type { HrException } from '../types';
import { check, ctxWith, emp, planOf } from './helpers';

// Иванова (E13) на 14–27 июня — третий менеджер по продажам, запрет лимита 14–20 июня
const june = { start: '2027-06-14', end: '2027-06-27' };
const limit = (exceptions: HrException[], parts: Parameters<typeof check>[1] = [june, ['2027-10-04', '2027-10-13']]) =>
  check('E13', parts, { exceptions }).of('groupLimit').find((r) => r.partIds.includes('E13-p1'))!;
const x = (over: Partial<HrException>): HrException => ({ id: 'X', employeeId: 'E13', ruleCode: 'groupLimit', reason: 'про июль', ...over });

describe('исключение HR — только к своей части и своим датам', () => {
  it('исключение без части не снимает нарушения частей (баг: текст про июль на новом выделении)', () => {
    expect(limit([x({})]).status).toBe('block');
  });

  it('исключение без части, но с датами — только к частям, пересекающим эти даты', () => {
    expect(limit([x({ dates: { start: '2027-06-10', end: '2027-06-16' } })]).status).toBe('exception');
    expect(limit([x({ dates: { start: '2027-07-05', end: '2027-07-12' } })]).status).toBe('block');
  });

  it('исключение на часть действует, пока её даты не изменились', () => {
    expect(limit([x({ partId: 'E13-p1', dates: june })]).status).toBe('exception');
    // та же часть сдвинута на неделю раньше: 7–20 июня тоже нет мест, но решение HR было про другие даты
    const moved = limit([x({ partId: 'E13-p1', dates: june })], [{ start: '2027-06-07', end: '2027-06-20' }, ['2027-10-04', '2027-10-13']]);
    expect(moved.status).toBe('block');
    expect(moved.message).not.toContain('про июль');
  });

  it('новое выделение (без id в базе) исключения не получает', () => {
    const res = check('E13', [['2027-10-04', '2027-10-13'], { id: 'new-2', ...june }], { exceptions: [x({ partId: 'E13-p1', dates: june })] });
    expect(res.of('groupLimit').find((r) => r.partIds.includes('new-2'))!.status).toBe('block');
  });

  it('перенос части — исключение прежних дат не переносится', () => {
    const plan = planOf('E13', [{ start: '2027-05-17', end: '2027-05-30', status: 'approved' }, ['2027-10-04', '2027-10-13']]);
    const res = checkChange(emp('E13'), plan,
      { id: 'C', employeeId: 'E13', partId: 'E13-p1', kind: 'move', newStart: june.start, newEnd: june.end, requestedOn: '2026-11-25' },
      ctxWith({ exceptions: [x({ partId: 'E13-p1' })] }));
    expect(res.results.find((r) => r.code === 'groupLimit' && r.partIds.includes('E13-p1'))!.status).toBe('block');
  });

  it('из базы: даты исключения — даты части на момент проверки', () => {
    const row: Db.RuleException = {
      id: 1, createdAt: '2026-10-22T10:15:00.000Z', createdBy: 'E19', employeeId: 'E05', partId: 9, ruleCode: 'R01',
      decision: 'allow', reason: 'причина', active: true,
    };
    const part = { id: 9, startDate: '2027-07-05', endDate: '2027-07-19' } as Db.RequestPart;
    expect(exceptionsFromDb([row], [part])[0]).toMatchObject({ partId: '9', dates: { start: '2027-07-05', end: '2027-07-19' } });
  });
});
