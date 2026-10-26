import { describe, expect, it } from 'vitest';
import {
  holidaysOf, isHoliday, isWorkingDay, orthodoxEaster, radunitsa, summerDays, vacationDays, vacationEnd, workingYear,
} from '../calendar';
import { addMonths, rangeText, rangesText } from '../dates';

describe('праздники РБ 2027', () => {
  it('десять нерабочих праздников по Указу № 157', () => {
    expect(holidaysOf(2027).map((h) => h.date)).toEqual([
      '2027-01-01', '2027-01-02', '2027-01-07', '2027-03-08', '2027-05-01',
      '2027-05-09', '2027-05-11', '2027-07-03', '2027-11-07', '2027-12-25',
    ]);
  });

  it('Радуница 2027 — вторник 11 мая, через 9 дней после Пасхи 2 мая', () => {
    expect(orthodoxEaster(2027)).toBe('2027-05-02');
    expect(radunitsa(2027)).toBe('2027-05-11');
    // сверка с прошлыми годами: Радуница 2025 — 29 апреля, 2026 — 21 апреля
    expect(radunitsa(2025)).toBe('2025-04-29');
    expect(radunitsa(2026)).toBe('2026-04-21');
  });

  it('перенос 2027: суббота 8 мая рабочая, понедельник 10 мая выходной, но не праздник', () => {
    expect(isWorkingDay('2027-05-08')).toBe(true);
    expect(isWorkingDay('2027-05-10')).toBe(false);
    expect(isHoliday('2027-05-10')).toBe(false);
    expect(isWorkingDay('2027-05-11')).toBe(false);
    expect(isWorkingDay('2027-05-12')).toBe(true);
    // выходной от переноса в отпуск входит (ст. 151 исключает только праздники)
    expect(vacationDays('2027-05-10', '2027-05-10')).toBe(1);
  });

  it('праздник на выходном не переносится', () => {
    // 9 мая 2027 — воскресенье
    expect(isHoliday('2027-05-09')).toBe(true);
    expect(isWorkingDay('2027-05-09')).toBe(false);
  });
});

describe('подсчёт дней отпуска (ст. 151)', () => {
  it('3 июля продлевает отпуск на день', () => {
    expect(vacationDays('2027-06-28', '2027-07-11')).toBe(13);
    expect(vacationEnd('2027-06-28', 14)).toBe('2027-07-12');
    expect(vacationDays('2027-06-28', '2027-07-12')).toBe(14);
  });

  it('выходные входят в отпуск', () => {
    expect(vacationDays('2027-06-07', '2027-06-20')).toBe(14);
    expect(vacationEnd('2027-06-07', 14)).toBe('2027-06-20');
  });

  it('майские праздники: 1, 9 и 11 мая не в счёт', () => {
    expect(vacationDays('2027-05-01', '2027-05-14')).toBe(11);
    expect(vacationEnd('2027-05-01', 14)).toBe('2027-05-17');
  });

  it('новогодние: отпуск через 1, 2 и 7 января удлиняется на три дня', () => {
    expect(vacationEnd('2027-01-01', 10)).toBe('2027-01-13');
  });

  it('конец раньше начала — ноль дней', () => {
    expect(vacationDays('2027-06-10', '2027-06-01')).toBe(0);
  });
});

describe('лето и рабочий год', () => {
  it('летние дни считаются без праздников и только с 1 июня по 31 августа', () => {
    expect(summerDays('2027-06-28', '2027-07-12')).toBe(14);
    expect(summerDays('2027-08-25', '2027-09-10')).toBe(7);
    expect(summerDays('2027-05-25', '2027-06-03')).toBe(3);
  });

  it('рабочий год — 12 месяцев от даты приёма (ст. 163)', () => {
    expect(workingYear('2026-10-01', '2027-03-01')).toEqual({ start: '2026-10-01', end: '2027-09-30', number: 1 });
    expect(workingYear('2021-01-11', '2027-06-01')).toEqual({ start: '2027-01-11', end: '2028-01-10', number: 7 });
    // сдвиг на дни без сохранения сверх 14 (ст. 164)
    expect(workingYear('2026-10-01', '2027-10-03', 5).start).toBe('2026-10-01');
    expect(workingYear('2026-10-01', '2027-10-06', 5).start).toBe('2027-10-06');
  });

  it('прибавление месяцев не перескакивает через конец месяца', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });
});

describe('тексты дат', () => {
  it('по-русски', () => {
    expect(rangeText('2027-06-14', '2027-06-20')).toBe('14–20 июня');
    expect(rangeText('2027-06-28', '2027-07-12')).toBe('28 июня – 12 июля');
    expect(rangeText('2027-07-03', '2027-07-03')).toBe('3 июля');
    expect(rangesText([{ start: '2027-06-14', end: '2027-06-20' }, { start: '2027-07-02', end: '2027-07-05' }]))
      .toBe('14–20 июня и 2–5 июля');
  });
});
