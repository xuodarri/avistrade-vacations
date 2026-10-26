import { describe, expect, it } from 'vitest';
import { EDGE_PART_ID, checkPlan, dayLoad, edgeVerdicts, findWindows, groupAbsences, loadRange, shiftVerdicts, teamConflicts } from '../engine';
import { DEFAULT_ROLES } from '../config';
import { parts, toDay } from '../dates';
import { groupOf } from '../groups';
import { vacationDays } from '../calendar';
import { SAMPLE_EMPLOYEES, SAMPLE_EXCEPTIONS, SAMPLE_PLANS } from '../sample';
import type { Plan } from '../types';
import { RULES, ctxWith, emp, planOf } from './helpers';

const group = (id: string) => groupOf(emp(id), SAMPLE_EMPLOYEES, DEFAULT_ROLES);

describe('checkPlan', () => {
  it('чистый план: общий статус ok, все правила на месте', () => {
    const res = checkPlan(emp('E13'), planOf('E13', [['2027-06-21', '2027-07-05'], ['2027-09-06', '2027-09-15']]), ctxWith());
    expect(res.status).toBe('ok');
    const codes = new Set(res.results.map((r) => r.code));
    for (const code of ['groupLimit', 'roleDependencies', 'summerLength', 'noticeMonth', 'rescheduleNotice', 'firstVacation',
      'holidays', 'noOverlap', 'longPart', 'yearNorm']) expect(codes.has(code as never)).toBe(true);
    // 21 июня – 5 июля: 15 календарных минус 3 июля
    expect(res.parts.map((p) => p.days)).toEqual([14, 10]);
    expect(res.totalDays).toBe(24);
  });

  it('предупреждение не запрещает отправку: общий статус warn', () => {
    const res = checkPlan(emp('E16'), planOf('E16', [['2027-03-01', '2027-03-15'], ['2027-10-04', '2027-10-13']]), ctxWith());
    expect(res.status).toBe('warn');
    expect(res.parts.map((p) => p.status)).toEqual(['warn', 'ok']);
  });

  it('отклонённые части в план не входят', () => {
    const plan = planOf('E18', [['2027-03-09', '2027-04-01'], { start: '2027-03-15', end: '2027-03-20', status: 'rejected' }]);
    const res = checkPlan(emp('E18'), plan, ctxWith());
    expect(res.parts).toHaveLength(1);
    expect(res.status).toBe('ok');
  });

  it('собственный старый план из context.plans не мешает новому', () => {
    // в SAMPLE_PLANS у E14 отпуск 7–20 июня; новый план E14 на те же даты не конфликтует сам с собой
    const res = checkPlan(emp('E14'), planOf('E14', [['2027-06-07', '2027-06-20'], ['2027-08-16', '2027-08-25']]), ctxWith());
    expect(res.results.find((r) => r.code === 'groupLimit')!.status).toBe('ok');
  });
});

describe('dayLoad', () => {
  it('сколько отсутствует и лимит — без имён', () => {
    const d = dayLoad(group('E13'), '2027-06-15', SAMPLE_PLANS);
    expect(d).toEqual({ date: '2027-06-15', absent: 2, limit: 2, free: 0, dependencyAbsent: false, full: true });
    expect(JSON.stringify(d)).not.toMatch(/E1\d/);
  });

  it('свой отпуск в загрузку не входит', () => {
    const d = dayLoad(group('E13'), '2027-06-15', SAMPLE_PLANS, { excludeEmployeeId: 'E14' });
    expect(d).toMatchObject({ absent: 1, free: 1, full: false });
  });

  it('связанная роль в отпуске — день занят', () => {
    const plans: Plan[] = [...SAMPLE_PLANS, planOf('E07', [{ start: '2027-07-05', end: '2027-07-18', status: 'approved' }])];
    expect(dayLoad(group('E10'), '2027-07-12', plans)).toMatchObject({ absent: 0, limit: 1, free: 1, dependencyAbsent: true, full: true });
    expect(dayLoad(group('E10'), '2027-07-19', plans)).toMatchObject({ dependencyAbsent: false, full: false });
  });

  it('черновики места не занимают', () => {
    const plans: Plan[] = [planOf('E14', [{ start: '2027-06-07', end: '2027-06-20', status: 'draft' }])];
    expect(dayLoad(group('E13'), '2027-06-15', plans).absent).toBe(0);
  });

  it('загрузка на месяц для календаря, с праздниками', () => {
    const days = loadRange(group('E13'), '2027-07-01', '2027-07-31', SAMPLE_PLANS, { excludeEmployeeId: 'E13' });
    expect(days).toHaveLength(31);
    expect(days[2]).toMatchObject({ date: '2027-07-03', holiday: 'День Независимости' });
    // 19 июля – 1 августа в отпуске Шумская (E16)
    expect(days[18]).toMatchObject({ date: '2027-07-19', absent: 1, free: 1 });
  });
});

describe('findWindows', () => {
  const plan = planOf('E13', [['2027-06-14', '2027-06-27'], ['2027-10-04', '2027-10-13']]);

  it('три ближайших свободных окна той же длины', () => {
    const ctx = ctxWith();
    const w = findWindows(emp('E13'), plan, 'E13-p1', ctx);
    expect(w).toHaveLength(3);
    for (const x of w) {
      expect(parts(toDay(x.start)).wd).toBe(0);
      expect(x.days).toBe(14);
      expect(vacationDays(x.start, x.end)).toBe(14);
      // окно действительно проходит лимит группы
      const moved = { ...plan, parts: plan.parts.map((p) => (p.id === 'E13-p1' ? { ...p, start: x.start, end: x.end } : p)) };
      const r = checkPlan(emp('E13'), moved, ctx).results.find((y) => y.code === 'groupLimit')!;
      expect(r.status).toBe('ok');
    }
    expect(w.map((x) => x.start)).toEqual([...w.map((x) => x.start)].sort());
    // 7–20 июня в отпуске Петров, 14–27 июня — Ковалёв: третьему месту нет только 14–20 июня
    expect(w.map((x) => x.start)).toEqual(['2027-05-31', '2027-06-21', '2027-06-28']);
  });

  it('окно с 3 июля длиннее на день', () => {
    const w = findWindows(emp('E13'), plan, 'E13-p1', ctxWith(), { count: 10, weekday: null });
    const withHoliday = w.find((x) => x.holidays.some((h) => h.date === '2027-07-03'));
    expect(withHoliday).toBeDefined();
    expect(toDay(withHoliday!.end) - toDay(withHoliday!.start) + 1).toBe(15);
  });

  it('окно не залезает на другую часть плана', () => {
    const w = findWindows(emp('E13'), plan, 'E13-p2', ctxWith(), { count: 20, before: 200, after: 0 });
    for (const x of w) expect(x.end < '2027-06-14' || x.start > '2027-06-27').toBe(true);
  });

  it('нет такой части — пусто', () => {
    expect(findWindows(emp('E13'), plan, 'нет', ctxWith())).toEqual([]);
  });
});

describe('строгие окна', () => {
  it('окно проходит весь checkPlan без запретов', () => {
    const plan = planOf('E13', [['2027-06-14', '2027-06-27'], ['2027-10-04', '2027-10-13']]);
    const ctx = ctxWith();
    const w = findWindows(emp('E13'), plan, 'E13-p1', ctx, { strict: true });
    expect(w).toHaveLength(3);
    for (const x of w) {
      const moved = { ...plan, parts: plan.parts.map((p) => (p.id === 'E13-p1' ? { ...p, start: x.start, end: x.end } : p)) };
      expect(checkPlan(emp('E13'), moved, ctx).status).not.toBe('block');
    }
  });

  it('запрет не от дат — окон нет, без strict окна были бы', () => {
    // 14 + 10 + 3 = 27 дней при норме 24: сдвиг третьей части норму не исправит
    const plan = planOf('E13', [['2027-06-21', '2027-07-05'], ['2027-09-06', '2027-09-15'], ['2027-08-18', '2027-08-20']]);
    const ctx = ctxWith();
    expect(checkPlan(emp('E13'), plan, ctx).results.find((r) => r.code === 'yearNorm')!.status).toBe('block');
    expect(findWindows(emp('E13'), plan, 'E13-p3', ctx).length).toBeGreaterThan(0);
    expect(findWindows(emp('E13'), plan, 'E13-p3', ctx, { strict: true })).toEqual([]);
  });
});

describe('dateBound', () => {
  it('лимит зависит от дат, норма и число частей — нет', () => {
    const plan = planOf('E13', [['2027-06-14', '2027-06-20'], ['2027-09-06', '2027-09-15'], ['2027-10-04', '2027-10-05'], ['2027-11-01', '2027-11-10']]);
    const res = checkPlan(emp('E13'), plan, ctxWith());
    const by = (code: string) => res.results.find((r) => r.code === code)!;
    expect(by('groupLimit')).toMatchObject({ status: 'block', dateBound: true });
    expect(by('yearNorm')).toMatchObject({ status: 'block', dateBound: false });
    expect(by('maxParts')).toMatchObject({ status: 'block', dateBound: false });
    expect(by('longPart')).toMatchObject({ status: 'block', dateBound: false });
  });
});

describe('groupAbsences', () => {
  it('кто из группы лимита в отпуске', () => {
    const [d] = groupAbsences(group('E13'), '2027-06-15', '2027-06-15', SAMPLE_PLANS, { excludeEmployeeId: 'E13' });
    expect(d).toEqual({ date: '2027-06-15', peers: ['E14', 'E15'], deputies: [] });
  });

  it('кого сотрудник ждёт на месте — отдельно', () => {
    const plans: Plan[] = [...SAMPLE_PLANS, planOf('E07', [{ start: '2027-07-05', end: '2027-07-18', status: 'approved' }])];
    const days = groupAbsences(group('E10'), '2027-07-18', '2027-07-19', plans, { excludeEmployeeId: 'E10' });
    expect(days).toEqual([
      { date: '2027-07-18', peers: [], deputies: ['E07'] },
      { date: '2027-07-19', peers: [], deputies: [] },
    ]);
  });
});

describe('shiftVerdicts', () => {
  it('вердикт на каждое начало части той же длины, в пределах года', () => {
    const plan = planOf('E13', [['2027-06-14', '2027-06-27'], ['2027-10-04', '2027-10-13']]);
    const ctx = ctxWith();
    const all = shiftVerdicts(emp('E13'), plan, 'E13-p1', ctx);
    const starts = Object.keys(all);
    expect(starts[0]).toBe('2027-01-01');
    // последнее начало: 14 дней отпуска с 25 декабря (праздник) кончаются 31-го
    expect(starts[starts.length - 1]).toBe('2027-12-17');
    // исходные даты — запрет по лимиту, 21 июня — свободно
    expect(all['2027-06-14'].results.find((r) => r.code === 'groupLimit')!.status).toBe('block');
    expect(all['2027-06-21'].status).toBe('ok');
    // наложение на вторую часть
    expect(all['2027-09-27'].results.find((r) => r.code === 'noOverlap')!.status).toBe('block');
    // совпадает с отдельной проверкой
    const moved = { ...plan, parts: [{ ...plan.parts[0], start: '2027-08-02', end: '2027-08-15' }, plan.parts[1]] };
    expect(all['2027-08-02'].status).toBe(checkPlan(emp('E13'), moved, ctx).status);
  });
});

describe('edgeVerdicts', () => {
  const plan = planOf('E13', [['2027-03-01', '2027-03-14'], ['2027-10-04', '2027-10-13']]);
  const ctx = ctxWith();

  it('новая часть: выделение от закреплённого края до каждого дня года', () => {
    const all = edgeVerdicts(emp('E13'), plan, null, 'main', '2027-06-21', ctx);
    expect(Object.keys(all)).toHaveLength(365);
    // 14–21 июня: третий менеджер по продажам 14–20 июня
    const back = all['2027-06-14'];
    expect(back.results.find((r) => r.code === 'groupLimit' && r.partIds.includes(EDGE_PART_ID))!.status).toBe('block');
    // 21–23 июня свободно
    expect(all['2027-06-23'].results.find((r) => r.code === 'groupLimit')!.status).toBe('ok');
    // наложение на часть 2
    expect(all['2027-10-05'].results.find((r) => r.code === 'noOverlap')!.status).toBe('block');
    const direct = checkPlan(emp('E13'), { ...plan, parts: [...plan.parts, { id: EDGE_PART_ID, type: 'main', start: '2027-06-21', end: '2027-06-30', status: 'draft' }] }, ctx);
    expect(all['2027-06-30'].status).toBe(direct.status);
  });

  it('существующая часть: тянется её край', () => {
    const all = edgeVerdicts(emp('E13'), plan, 'E13-p2', 'main', '2027-10-04', ctx);
    expect(all['2027-10-20'].parts.find((p) => p.partId === 'E13-p2')!.days).toBe(17);
    expect(edgeVerdicts(emp('E13'), plan, 'нет', 'main', '2027-10-04', ctx)).toEqual({});
  });
});

describe('teamConflicts', () => {
  const report = teamConflicts(SAMPLE_EMPLOYEES, SAMPLE_PLANS, RULES, { today: '2026-11-25', exceptions: SAMPLE_EXCEPTIONS });

  it('конфликты по компании для Ганта', () => {
    const brief = report.conflicts.map((c) => `${c.employeeId} ${c.code} ${c.status}`);
    expect(brief).toEqual([
      'E01 roleDependencies warn',
      'E03 roleDependencies block',
      'E04 groupLimit warn',
      'E05 groupLimit exception',
      'E05 summerLength block',
      'E09 roleDependencies warn',
      'E12 roleDependencies block',
      'E12 summerLength block',
    ]);
  });

  it('исключение HR: конфликт «разрешён исключением»', () => {
    const c = report.conflicts.find((x) => x.employeeId === 'E05' && x.code === 'groupLimit')!;
    expect(c.resolved).toBe(true);
    expect(c.exception?.id).toBe('X1');
    // у второй стороны того же пересечения (E04, отпуск согласован) — предупреждение остаётся
    expect(report.conflicts.find((x) => x.employeeId === 'E04')!.resolved).toBe(false);
  });

  it('итог по сотрудникам', () => {
    expect(report.statusByEmployee).toMatchObject({ E02: 'ok', E03: 'block', E05: 'block', E14: 'ok' });
    // у E07, E13, E17 планов нет
    expect(report.statusByEmployee.E13).toBeUndefined();
  });

  it('флаг срока графика: ТК — 5 января, регламент — полугодовой', () => {
    expect(report.notices).toHaveLength(1);
    expect(report.notices[0]).toMatchObject({ code: 'scheduleDeadline', status: 'info' });
    expect(report.notices[0].message).toContain('до 5 января 2027');
    expect(report.notices[0].message).toContain('15 января и 15 июля');
    const agreed = teamConflicts(SAMPLE_EMPLOYEES, SAMPLE_PLANS, RULES, { settings: { year: 2027, regulationDeadlines: ['2027-01-15', '2027-07-15'], collectiveAgreement: true } });
    expect(agreed.notices).toEqual([]);
  });

  it('этап «вне графика» и выключенное правило', () => {
    const rules = RULES.map((r) => (r.code === 'roleDependencies' ? { ...r, enabled: false } : r));
    const r = teamConflicts(SAMPLE_EMPLOYEES, SAMPLE_PLANS, rules, { today: '2026-11-25', exceptions: SAMPLE_EXCEPTIONS, stage: 'adhoc' });
    expect(r.conflicts.some((c) => c.code === 'roleDependencies')).toBe(false);
  });
});
