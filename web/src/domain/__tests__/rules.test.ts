import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, DEFAULT_RULES } from '../config';
import { groupOf } from '../groups';
import { SAMPLE_EMPLOYEES, SAMPLE_PLANS } from '../sample';
import type { HrException, Plan, RuleConfig } from '../types';
import { check, planOf } from './helpers';

const withRule = (code: string, patch: Partial<RuleConfig>) => DEFAULT_RULES.map((r) => (r.code === code ? { ...r, ...patch } : r));
const away = (employeeId: string, start: string, end: string): Plan[] =>
  [...SAMPLE_PLANS, planOf(employeeId, [{ start, end, status: 'approved' }])];

describe('лимит группы', () => {
  it('третий менеджер по продажам — запрет при сборке графика', () => {
    // 7–20 июня в отпуске Петров (E14), 14–27 июня — Ковалёв (E15)
    const [r] = check('E13', [['2027-06-14', '2027-06-27']]).of('groupLimit');
    expect(r.status).toBe('block');
    expect(r.message).toBe('Часть 1: 14–20 июня мест нет (лимит 2)');
    expect(r.dates).toEqual([{ start: '2027-06-14', end: '2027-06-20' }]);
    expect(r.employeeIds.sort()).toEqual(['E14', 'E15']);
    // имён коллег в тексте нет: экран сотрудника показывает его как есть
    expect(r.message).not.toMatch(/Петров|Ковалёв/);
  });

  it('свободные дни проходят', () => {
    expect(check('E13', [['2027-06-21', '2027-07-04']]).of('groupLimit')[0].status).toBe('ok');
  });

  it('для отпуска из утверждённого графика — только предупреждение', () => {
    const [r] = check('E13', [{ start: '2027-06-14', end: '2027-06-27', status: 'approved' }]).of('groupLimit');
    expect(r.status).toBe('warn');
  });

  it('льготник ч. 4 ст. 168 из-под лимита выходит', () => {
    const [r] = check('E17', [['2027-06-14', '2027-06-27']]).of('groupLimit');
    expect(r.status).toBe('off');
    expect(r.message).toContain('ч. 4 ст. 168');
  });

  it('работник до 18 лет тоже', () => {
    const minor = SAMPLE_EMPLOYEES.map((e) => (e.id === 'E13' ? { ...e, minor: true } : e));
    expect(check('E13', [['2027-06-14', '2027-06-27']], { employees: minor }).of('groupLimit')[0].status).toBe('off');
  });

  it('отпуск по ст. 189 лимиту не подчиняется', () => {
    const [r] = check('E13', [{ start: '2027-06-14', end: '2027-06-20', type: 'unpaid189' }]).of('groupLimit');
    expect(r.status).toBe('off');
    expect(r.message).toContain('Ст. 189');
  });

  it('исключение HR: конфликт помечен «разрешён исключением», план проходит', () => {
    const x: HrException = { id: 'X', employeeId: 'E13', ruleCode: 'groupLimit', partId: 'E13-p1', reason: 'Клиентов ведёт НО' };
    const { res, of } = check('E13', [['2027-06-14', '2027-06-27']], { exceptions: [x] });
    const [r] = of('groupLimit');
    expect(r.status).toBe('exception');
    expect(r.severity).toBe('block');
    expect(r.exception).toBe(x);
    expect(r.message).toContain('Разрешено исключением РО1: Клиентов ведёт НО');
    expect(res.status).toBe('ok');
  });

  it('исключение на другую часть не действует', () => {
    const x: HrException = { id: 'X', employeeId: 'E13', ruleCode: 'groupLimit', partId: 'E13-p9', reason: '—' };
    expect(check('E13', [['2027-06-14', '2027-06-27']], { exceptions: [x] }).of('groupLimit')[0].status).toBe('block');
  });

  it('HR меняет жёсткость и выключает правило', () => {
    const soft = withRule('groupLimit', { severity: 'warn', severityByStage: {} });
    expect(check('E13', [['2027-06-14', '2027-06-27']], { rules: soft }).of('groupLimit')[0].status).toBe('warn');
    const off = withRule('groupLimit', { enabled: false });
    const [r] = check('E13', [['2027-06-14', '2027-06-27']], { rules: off }).of('groupLimit');
    expect(r.status).toBe('off');
    expect(r.message).toBe('Правило выключено');
  });
});

describe('зависимости ролей', () => {
  const grp = (id: string) => groupOf(SAMPLE_EMPLOYEES.find((e) => e.id === id)!, SAMPLE_EMPLOYEES, DEFAULT_ROLES);

  it('МС — другие МС отдела и НО отдела', () => {
    expect(grp('E10')).toMatchObject({ memberIds: ['E10', 'E11'], limit: 1, dependencyIds: ['E07'] });
    // на складе МС один: лимита нет, но НО склада должен быть на месте
    expect(grp('E12')).toMatchObject({ memberIds: ['E12'], limit: null, dependencyIds: ['E08'] });
  });

  it('НО — другие НО отделения и РО', () => {
    expect(grp('E07')).toMatchObject({ memberIds: ['E07', 'E08'], limit: 1, dependencyIds: ['E04'] });
  });

  it('РО — другие РО под тем же ЗАВ/ЗТВ и сам ЗАВ/ЗТВ', () => {
    expect(grp('E04')).toMatchObject({ memberIds: ['E04', 'E05'], limit: 1, dependencyIds: ['E02'] });
    expect(grp('E06')).toMatchObject({ memberIds: ['E06'], dependencyIds: ['E03'] });
  });

  it('ЗАВ и ЗТВ — ИД; ИД — ЗАВ и ЗТВ', () => {
    expect(grp('E02').dependencyIds).toEqual(['E01']);
    expect(grp('E03').dependencyIds).toEqual(['E01']);
    expect(grp('E01').dependencyIds).toEqual(['E02', 'E03']);
  });

  it('менеджер по продажам: лимит 2, зависимостей нет', () => {
    expect(grp('E13')).toMatchObject({ memberIds: ['E13', 'E14', 'E15', 'E16', 'E17'], limit: 2, dependencyIds: [] });
  });

  it('МС не уходит, пока в отпуске его НО', () => {
    const [r] = check('E10', [['2027-07-12', '2027-07-25']], {}, {}, away('E07', '2027-07-05', '2027-07-18')).of('roleDependencies');
    expect(r.status).toBe('block');
    expect(r.message).toBe('Часть 1: 12–18 июля в отпуске начальник отдела');
    expect(r.employeeIds).toEqual(['E07']);
  });

  it('МС не уходит одновременно с другим МС отдела (лимит 1)', () => {
    // Лукашевич (E11) в отпуске 24 мая – 2 июня
    const [r] = check('E10', [['2027-05-31', '2027-06-13']]).of('groupLimit');
    expect(r.status).toBe('block');
    expect(r.message).toBe('Часть 1: 31 мая – 2 июня мест нет (лимит 1)');
  });

  it('РО смотрит только на своего заместителя', () => {
    // ЗТВ (E03) в отпуске 9–22 августа, но у E04 руководитель — ЗАВ (E02), она уходит с 16-го
    expect(check('E04', [['2027-08-09', '2027-08-15']]).of('roleDependencies')[0].status).toBe('ok');
    const [r] = check('E04', [['2027-08-09', '2027-08-22']]).of('roleDependencies');
    expect(r.message).toBe('Часть 1: 16–22 августа в отпуске заместитель директора (ЗАВ)');
  });

  it('ИД не уходит без ЗАВ и ЗТВ, ЗАВ — без ИД', () => {
    expect(check('E01', [['2027-08-09', '2027-08-15']]).of('roleDependencies')[0].message)
      .toBe('Часть 1: 9–15 августа в отпуске заместитель директора (ЗТВ)');
    expect(check('E02', [['2027-12-13', '2027-12-19']]).of('roleDependencies')[0].message)
      .toBe('Часть 1: 13–19 декабря в отпуске исполнительный директор');
  });

  it('по ст. 189 зависимость не действует', () => {
    const [r] = check('E10', [{ start: '2027-07-12', end: '2027-07-18', type: 'unpaid189' }], {}, {}, away('E07', '2027-07-05', '2027-07-18'))
      .of('roleDependencies');
    expect(r.status).toBe('off');
  });
});

describe('летом до 14 дней', () => {
  it('больше 14 летних дней — запрет регламента (нужно исключение), с пометкой риска', () => {
    const [r] = check('E18', [['2027-07-01', '2027-07-21']]).of('summerLength');
    expect(r).toMatchObject({ status: 'block', consequence: 'exception' });
    expect(r.legalRisk).toContain('ч. 1 ст. 174');
    // 21 календарный день минус 3 июля
    expect(r.message).toBe('Часть 1: летом (1 июня — 31 августа) можно не больше 14 дней — у вас 20');
  });

  it('две смежные части летом — один отпуск: 1–14 и 15–28 июня', () => {
    const { of } = check('E18', [['2027-06-01', '2027-06-14'], ['2027-06-15', '2027-06-28']]);
    const rs = of('summerLength');
    expect(rs.map((r) => r.status)).toEqual(['block', 'block']);
    expect(rs[0].message).toBe('Часть 1: летом (1 июня — 31 августа) можно не больше 14 дней — у вас 28 (части 1 и 2 подряд, 1–28 июня)');
  });

  it('между частями только выходные — тоже подряд; есть рабочий день — нет', () => {
    // пятница 11 июня — понедельник 14 июня: между ними суббота и воскресенье
    expect(check('E18', [['2027-06-01', '2027-06-11'], ['2027-06-14', '2027-06-20']]).of('summerLength')[0].status).toBe('block');
    // между 11 и 15 июня — рабочий понедельник 14-го
    expect(check('E18', [['2027-06-01', '2027-06-11'], ['2027-06-15', '2027-06-21']]).of('summerLength')[0].status).toBe('ok');
  });

  it('3 июля не в счёт: 28 июня – 12 июля — ровно 14 дней', () => {
    expect(check('E18', [['2027-06-28', '2027-07-12']]).of('summerLength')[0].status).toBe('ok');
  });

  it('параметр меняет HR', () => {
    const rules = withRule('summerLength', { params: { days: 21 } });
    expect(check('E18', [['2027-07-01', '2027-07-21']], { rules }).of('summerLength')[0].status).toBe('ok');
  });

  it('льготнику не применяется', () => {
    expect(check('E17', [['2027-07-01', '2027-07-21']]).of('summerLength')[0].status).toBe('off');
  });
});

describe('заявка за месяц', () => {
  it('меньше 30 дней — запрет регламента (нужно исключение)', () => {
    const [r] = check('E18', [['2027-05-20', '2027-06-02']], { today: '2027-05-01' }).of('noticeMonth');
    expect(r).toMatchObject({ status: 'block', consequence: 'exception' });
    expect(r.message).toBe('Часть 1: до начала 19 дней, по регламенту заявка за 30');
  });

  it('считается от даты подачи', () => {
    const p = { start: '2027-05-20', end: '2027-06-02', submittedOn: '2027-04-01' };
    expect(check('E18', [p], { today: '2027-05-01' }).of('noticeMonth')[0].status).toBe('ok');
  });

  it('к отпуску из утверждённого графика не применяется', () => {
    const [r] = check('E18', [{ start: '2027-05-20', end: '2027-06-02', status: 'approved' }], { today: '2027-05-01' }).of('noticeMonth');
    expect(r.status).toBe('off');
    expect(r.message).toBe('Не применяется на этапе «уже в графике»');
  });
});

describe('перенос за 14 дней', () => {
  const moved = (reason: 'agreement' | 'illness') => ({
    start: '2027-09-13', end: '2027-09-26',
    reschedule: { fromStart: '2027-09-27', fromEnd: '2027-10-10', requestedOn: '2027-09-20', reason },
  });

  it('перенос по соглашению позже срока — запрет регламента, нужно исключение', () => {
    const [r] = check('E18', [moved('agreement')]).of('rescheduleNotice');
    expect(r).toMatchObject({ status: 'block', consequence: 'exception' });
    expect(r.message).toBe('Часть 1: перенос заявлен за 7 дней, по регламенту — за 14');
  });

  it('перенос по болезни от срока не зависит', () => {
    expect(check('E18', [moved('illness')]).of('rescheduleNotice')[0].status).toBe('ok');
  });

  it('без переноса правило молчит', () => {
    expect(check('E18', [['2027-09-13', '2027-09-26']]).of('rescheduleNotice')[0].status).toBe('off');
  });
});

describe('одна часть от 14 дней (ч. 1 ст. 174)', () => {
  it('все части короче — запрет', () => {
    const { res, of } = check('E18', [['2027-06-01', '2027-06-10'], ['2027-08-02', '2027-08-11'], ['2027-10-04', '2027-10-07']]);
    expect(of('longPart')[0]).toMatchObject({ status: 'block', message: 'Ни одна часть не дотягивает до 14 дней' });
    expect(res.status).toBe('block');
  });

  it('исключение HR закон не снимает', () => {
    const x: HrException = { id: 'X', employeeId: 'E18', ruleCode: 'longPart', reason: 'просьба работника' };
    expect(check('E18', [['2027-06-01', '2027-06-10']], { exceptions: [x] }).of('longPart')[0].status).toBe('block');
  });
});

describe('норма дней (ст. 155)', () => {
  it('больше нормы — запрет', () => {
    expect(check('E18', [['2027-03-01', '2027-03-30']]).of('yearNorm')[0])
      .toMatchObject({ status: 'block', message: 'Запланировано 29 дней при норме 24, лишних 5' });
  });

  it('меньше нормы — к сведению', () => {
    expect(check('E18', [['2027-03-09', '2027-03-28']]).of('yearNorm')[0])
      .toMatchObject({ status: 'info', message: 'Не распределено ещё 4 дня из 24' });
  });

  it('норма с дополнительными днями', () => {
    // у ИД 24 + 3; 13 декабря — 26 декабря без 25-го = 13
    const { res, of } = check('E01', [['2027-06-07', '2027-06-20'], ['2027-12-13', '2027-12-26']]);
    expect(of('yearNorm')[0].status).toBe('ok');
    expect(res.totalDays).toBe(27);
    expect(res.normDays).toBe(27);
  });

  it('без сохранения в норму не входит', () => {
    expect(check('E18', [['2027-03-09', '2027-04-01'], { start: '2027-10-01', end: '2027-10-10', type: 'unpaid190' }]).of('yearNorm')[0].status)
      .toBe('ok');
  });
});

describe('первый отпуск после 6 месяцев (ст. 166)', () => {
  it('раньше — предупреждение', () => {
    // Шумская (E16) принята 1 октября 2026
    const [r] = check('E16', [['2027-03-01', '2027-03-14']]).of('firstVacation');
    expect(r.status).toBe('warn');
    expect(r.message).toBe('Часть 1: работает с 1 октября 2026, без соглашения отпуск — с 1 апреля 2027');
  });

  it('с 1 апреля — можно', () => {
    expect(check('E16', [['2027-04-01', '2027-04-14']]).of('firstVacation')[0].status).toBe('ok');
  });

  it('соглашение или право ч. 2 ст. 166 снимают предупреждение', () => {
    expect(check('E16', [{ start: '2027-03-01', end: '2027-03-14', earlyConsent: true }]).of('firstVacation')[0].status).toBe('ok');
    const early = SAMPLE_EMPLOYEES.map((e) => (e.id === 'E16' ? { ...e, earlyFirstLeave: true } : e));
    expect(check('E16', [['2027-03-01', '2027-03-14']], { employees: early }).of('firstVacation')[0].status).toBe('ok');
  });
});

describe('части не пересекаются', () => {
  it('пересечение — запрет на обе части', () => {
    const { res, of } = check('E18', [['2027-06-01', '2027-06-14'], ['2027-06-10', '2027-06-20']]);
    const [r] = of('noOverlap');
    expect(r).toMatchObject({ status: 'block', message: 'Части 1 и 2 пересекаются: 10–14 июня' });
    expect(r.partIds).toEqual(['E18-p1', 'E18-p2']);
    expect(res.parts.map((p) => p.status)).toEqual(['block', 'block']);
  });

  it('конец раньше начала', () => {
    expect(check('E18', [['2027-06-10', '2027-06-01']]).of('noOverlap')[0].message).toBe('Часть 1: последний день раньше первого');
  });
});

describe('праздники в отпуске', () => {
  it('3 июля продлевает отпуск — к сведению', () => {
    const { res, of } = check('E18', [['2027-06-28', '2027-07-12']]);
    const [r] = of('holidays');
    expect(r.status).toBe('info');
    expect(r.message).toBe('Часть 1: 3 июля — День Независимости; отпуск длиннее на 1 день');
    expect(res.parts[0]).toMatchObject({ days: 14, holidays: ['2027-07-03'], summerDays: 14 });
  });
});
