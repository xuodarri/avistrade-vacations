import { describe, expect, it } from 'vitest';
import { checkChange, extendForSickness, recallFromVacation, withOpenChanges } from '../change';
import { dayLoad } from '../engine';
import { DEFAULT_ROLES } from '../config';
import { groupOf } from '../groups';
import { SAMPLE_EMPLOYEES, SAMPLE_PLANS } from '../sample';
import type { PartChange, Plan } from '../types';
import { ctxWith, emp, planOf } from './helpers';

// у Жук (E18, без лимитов) обе части согласованы: 1–15 марта (14 дней, 8 марта не в счёт) и 4–13 октября, норма 24
const plan = planOf('E18', [
  { start: '2027-03-01', end: '2027-03-15', status: 'approved' },
  { start: '2027-10-04', end: '2027-10-13', status: 'approved' },
]);
const change = (c: Partial<PartChange>): PartChange =>
  ({ id: 'C1', employeeId: 'E18', partId: 'E18-p1', kind: 'move', requestedOn: '2026-11-25', ...c });
const of = (res: ReturnType<typeof checkChange>, code: string) => res.results.filter((r) => r.code === code);

describe('заявка на перенос согласованной части', () => {
  it('перенос заранее — проходит, старые даты у самого сотрудника не учитываются', () => {
    const res = checkChange(emp('E18'), plan, change({ newStart: '2027-04-05', newEnd: '2027-04-18' }), ctxWith());
    expect(res.status).toBe('ok');
    expect(res.summary).toMatchObject({ canSubmit: true, needsException: false });
    expect(of(res, 'rescheduleNotice')[0]).toMatchObject({ status: 'ok', message: 'Перенос заявлен за 96 дней' });
  });

  it('позже чем за 14 дней до прежнего начала — нужно исключение (R14)', () => {
    const res = checkChange(emp('E18'), plan,
      // новые даты через 16 дней после подачи: R04 «за 30 дней» у переноса не проверяется
      change({ newStart: '2027-03-08', newEnd: '2027-03-22', requestedOn: '2027-02-20' }), ctxWith({ today: '2027-02-20' }));
    expect(of(res, 'rescheduleNotice')[0]).toMatchObject({
      status: 'block', consequence: 'exception', message: 'Часть 1: перенос заявлен за 9 дней, по регламенту — за 14',
    });
    expect(res.summary).toMatchObject({ canSubmit: true, needsException: true });
    // срок «заявка за 30 дней» у переноса не проверяется — у него свой срок R14
    expect(of(res, 'noticeMonth').some((r) => r.status === 'warn')).toBe(false);
    expect(res.summary.warnings).toEqual([]);
  });

  it('начавшуюся часть сотрудник не переносит — law', () => {
    const res = checkChange(emp('E18'), plan, change({ newStart: '2027-04-05', newEnd: '2027-04-18', requestedOn: '2027-03-05' }),
      ctxWith({ today: '2027-03-05' }));
    expect(of(res, 'changeLocked')[0]).toMatchObject({
      status: 'block', consequence: 'law',
      message: 'Часть 1: идёт с 1 марта — изменить её может только отдел кадров (продление по болезни или отзыв)',
    });
    expect(res.summary.canSubmit).toBe(false);
  });

  it('прошедшую — тоже', () => {
    const res = checkChange(emp('E18'), plan, change({ newStart: '2027-04-05', newEnd: '2027-04-18' }), ctxWith({ today: '2027-03-20' }));
    expect(of(res, 'changeLocked')[0].message).toContain('1–15 марта уже прошла');
  });

  it('сокращение проверяется по всем правилам: без части от 14 дней — law', () => {
    const res = checkChange(emp('E18'), plan, change({ kind: 'shorten', newStart: '2027-03-01', newEnd: '2027-03-07' }), ctxWith());
    expect(of(res, 'longPart')[0]).toMatchObject({ status: 'block', consequence: 'law' });
    expect(of(res, 'yearNorm')[0]).toMatchObject({ status: 'info', message: 'Не распределено ещё 7 дней из 24' });
  });

  it('отказ от части: остаток — к сведению, части от 14 может не остаться', () => {
    const second = checkChange(emp('E18'), plan, change({ kind: 'cancel', partId: 'E18-p2' }), ctxWith());
    expect(second.summary.canSubmit).toBe(true);
    expect(of(second, 'yearNorm')[0].status).toBe('info');
    const first = checkChange(emp('E18'), plan, change({ kind: 'cancel' }), ctxWith());
    expect(of(first, 'longPart')[0].status).toBe('block');
  });

  it('поздний отказ — тоже через исключение', () => {
    const res = checkChange(emp('E18'), plan, change({ kind: 'cancel', partId: 'E18-p2', requestedOn: '2027-09-27' }),
      ctxWith({ today: '2027-09-27' }));
    expect(of(res, 'rescheduleNotice')[0]).toMatchObject({ status: 'block', message: 'Часть 2: отказ заявлен за 7 дней, по регламенту — за 14' });
  });
});

describe('загрузка группы, пока заявка открыта', () => {
  it('для коллег заняты и старые, и новые даты', () => {
    // Петров (E14) просит перенести 7–20 июня на 5–18 июля
    const c: PartChange = {
      id: '7', employeeId: 'E14', partId: 'E14-1', kind: 'move', newStart: '2027-07-05', newEnd: '2027-07-18', requestedOn: '2026-11-25',
    };
    const plans: Plan[] = withOpenChanges(SAMPLE_PLANS, [c]);
    const group = groupOf(emp('E13'), SAMPLE_EMPLOYEES, DEFAULT_ROLES);
    expect(dayLoad(group, '2027-06-10', plans).absent).toBe(1);
    expect(dayLoad(group, '2027-07-06', plans).absent).toBe(1);
    expect(dayLoad(group, '2027-07-06', SAMPLE_PLANS).absent).toBe(0);
    // решённая заявка уже не добавляет дат
    expect(withOpenChanges(SAMPLE_PLANS, [{ ...c, status: 'approved' }])).toBe(SAMPLE_PLANS);
  });
});

describe('продление по болезни (ст. 171)', () => {
  it('3 июля болезнь не «съедает»: продление на 4 дня', () => {
    expect(extendForSickness('2027-06-28', '2027-07-12', '2027-07-01', '2027-07-05')).toMatchObject({ end: '2027-07-16', addedDays: 4, holidays: [] });
  });

  it('праздник в хвосте сдвигает конец', () => {
    const x = extendForSickness('2027-12-11', '2027-12-24', '2027-12-20', '2027-12-24');
    expect(x.addedDays).toBe(5);
    expect(x.end).toBe('2027-12-30');
    expect(x.holidays.map((h) => h.date)).toEqual(['2027-12-25']);
  });

  it('болезнь дольше отпуска — хвост после выздоровления', () => {
    expect(extendForSickness('2027-06-07', '2027-06-20', '2027-06-18', '2027-06-25')).toMatchObject({ addedDays: 3, end: '2027-06-28' });
  });

  it('болезнь вне отпуска — без изменений', () => {
    expect(extendForSickness('2027-06-07', '2027-06-20', '2027-06-21', '2027-06-25')).toMatchObject({ addedDays: 0, end: '2027-06-20' });
  });
});

describe('отзыв из отпуска (ст. 174)', () => {
  it('неиспользованные дни возвращаются в остаток', () => {
    const r = recallFromVacation(emp('E18'), { start: '2027-06-07', end: '2027-06-20' }, '2027-06-15');
    expect(r).toMatchObject({ allowed: true, usedDays: 8, returnedDays: 6, end: '2027-06-14' });
    expect(r.message).toBe('Выход 15 июня 2027: использовано 8 дней, в остаток вернётся 6 дней. Отзыв — только с согласия работника');
  });

  it('праздник не считается ни использованным, ни возвращённым', () => {
    expect(recallFromVacation(emp('E18'), { start: '2027-06-28', end: '2027-07-12' }, '2027-07-06'))
      .toMatchObject({ usedDays: 7, returnedDays: 7 });
  });

  it('работника до 18 лет отзывать нельзя', () => {
    const r = recallFromVacation({ ...emp('E18'), minor: true }, { start: '2027-06-07', end: '2027-06-20' }, '2027-06-15');
    expect(r).toMatchObject({ allowed: false, returnedDays: 0, message: 'Работника моложе 18 лет отзывать из отпуска нельзя (ч. 5 ст. 174 ТК)' });
  });

  it('дата выхода вне отпуска', () => {
    expect(recallFromVacation(emp('E18'), { start: '2027-06-07', end: '2027-06-20' }, '2027-06-07').allowed).toBe(false);
  });
});
