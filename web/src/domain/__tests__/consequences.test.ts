import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, todayIso } from '../config';
import type { HrException } from '../types';
import { check } from './helpers';

const today = { today: '2026-10-26' };

describe('даты в прошлом (R00)', () => {
  it('прошедшие даты — нарушение закона, исключением не снимается', () => {
    const x: HrException = { id: 'X', employeeId: 'E18', ruleCode: 'pastDates', reason: '—' };
    const [r] = check('E18', [['2026-10-05', '2026-10-12']], { ...today, exceptions: [x] }).of('pastDates');
    expect(r).toMatchObject({
      status: 'block', consequence: 'law', dateBound: true,
      message: 'Часть 1: 5–12 октября уже прошли — выберите даты не раньше 27 октября 2026',
      dates: [{ start: '2026-10-05', end: '2026-10-12' }],
    });
  });

  it('начало сегодня или уже прошло, конец впереди', () => {
    expect(check('E18', [['2026-10-26', '2026-11-08']], today).of('pastDates')[0].message)
      .toBe('Часть 1: начать 26 октября уже не успеть — выберите даты не раньше 27 октября 2026');
    expect(check('E18', [['2026-10-20', '2026-11-08']], today).of('pastDates')[0].message)
      .toBe('Часть 1: 20 октября уже прошло — выберите даты не раньше 27 октября 2026');
  });

  it('с завтрашнего дня — можно; согласованная часть не проверяется', () => {
    expect(check('E18', [['2026-10-27', '2026-11-09']], today).of('pastDates')[0].status).toBe('ok');
    expect(check('E18', [{ start: '2026-10-05', end: '2026-10-18', status: 'approved' }], today).of('pastDates')[0].status).toBe('off');
  });

  it('«сегодня» можно зафиксировать для демо', () => {
    process.env.DEMO_TODAY = '2026-10-26';
    expect(todayIso()).toBe('2026-10-26');
  });
  afterEach(() => { delete process.env.DEMO_TODAY; });
});

describe('за свой счёт за год (R16, R17)', () => {
  it('ст. 190: больше 30 дней — предупреждение', () => {
    const [r] = check('E18', [{ start: '2027-03-01', end: '2027-04-03', type: 'unpaid190' }]).of('unpaid190Limit');
    expect(r).toMatchObject({ status: 'warn', consequence: 'warning', dateBound: false });
    expect(r.message).toBe('За свой счёт в году можно до 30 календарных дней — у вас 34. Больше — только по коллективному договору или решению нанимателя');
  });

  it('ст. 190: больше 3 месяцев — нарушение закона; праздники считаются', () => {
    const { res, of } = check('E18', [
      { start: '2027-02-01', end: '2027-03-31', type: 'unpaid190' }, { start: '2027-10-01', end: '2027-11-05', type: 'unpaid190' },
    ]);
    expect(of('unpaid190Limit')[0]).toMatchObject({ status: 'block', consequence: 'law', message: 'За свой счёт (ст. 190) в году — не больше 90 дней, у вас 95' });
    expect(res.summary.canSubmit).toBe(false);
  });

  it('ст. 189: больше 14 дней — предупреждение, сверх — по договорённости', () => {
    const [r] = check('E18', [{ start: '2027-03-01', end: '2027-03-17', type: 'unpaid189' }]).of('unpaid189Limit');
    expect(r).toMatchObject({ status: 'warn', consequence: 'warning', dateBound: false });
    expect(r.message).toContain('у вас 17. Сверх 14 — только по договорённости (ст. 190)');
  });

  it('в пределах — ок', () => {
    expect(check('E18', [{ start: '2027-03-01', end: '2027-03-30', type: 'unpaid190' }]).of('unpaid190Limit')[0].status).toBe('ok');
  });
});

describe('последствия нарушений', () => {
  it('запрет регламента — подать можно, нужен запрос исключения', () => {
    // E13 на 14–27 июня: третий менеджер по продажам
    const { res, of } = check('E13', [['2027-06-14', '2027-06-27'], ['2027-10-04', '2027-10-13']]);
    expect(of('groupLimit')[0].consequence).toBe('exception');
    expect(res.summary).toMatchObject({ canSubmit: true, needsException: true });
    expect(res.summary.exceptions.map((r) => r.code)).toEqual(['groupLimit']);
  });

  it('норма закона — подать нельзя', () => {
    const { res, of } = check('E18', [['2027-03-01', '2027-03-30']]);
    expect(of('yearNorm')[0].consequence).toBe('law');
    expect(res.summary).toMatchObject({ canSubmit: false, needsException: false });
    expect(res.summary.law.map((r) => r.code)).toEqual(['yearNorm']);
  });

  it('предупреждение подаче не мешает', () => {
    // Шумская (E16) принята 1 октября 2026: отпуск в марте — раньше 6 месяцев, нужно соглашение
    const { res, of } = check('E16', [['2027-03-01', '2027-03-15'], ['2027-10-04', '2027-10-13']]);
    expect(of('firstVacation')[0].consequence).toBe('warning');
    expect(res.summary).toMatchObject({ canSubmit: true, needsException: false });
    expect(res.summary.warnings.map((r) => r.code)).toEqual(['firstVacation']);
  });

  it('разрешённое исключением нарушение — без последствий', () => {
    const x: HrException = { id: 'X', employeeId: 'E13', ruleCode: 'groupLimit', partId: 'E13-p1', reason: 'ок' };
    const { res, of } = check('E13', [['2027-06-14', '2027-06-27'], ['2027-10-04', '2027-10-13']], { exceptions: [x] });
    expect(of('groupLimit')[0]).toMatchObject({ status: 'exception' });
    expect(of('groupLimit')[0].consequence).toBeUndefined();
    expect(res.summary.needsException).toBe(false);
  });

  it('замещающий — сам сотрудник: ошибка данных, закон, исключение не помогает', () => {
    const x: HrException = { id: 'X', employeeId: 'E18', ruleCode: 'substitute', reason: 'ок' };
    const [r] = check('E18', [{ start: '2027-06-14', end: '2027-06-27', substituteId: 'E18' }], { rules: DEFAULT_RULES, exceptions: [x] })
      .of('substitute');
    expect(r).toMatchObject({ status: 'block', consequence: 'law' });
  });

  it('замещающий в отпуске — запрет регламента', () => {
    const [r] = check('E18', [{ start: '2027-06-14', end: '2027-06-27', substituteId: 'E14' }], { rules: DEFAULT_RULES }).of('substitute');
    expect(r).toMatchObject({ status: 'block', consequence: 'exception' });
  });
});
