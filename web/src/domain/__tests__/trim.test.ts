import { describe, expect, it } from 'vitest';
import { checkPlan } from '../engine';
import { normFixes, trimSuggestions } from '../trim';
import { SAMPLE_EMPLOYEES, SAMPLE_PLANS } from '../sample';
import { ctxWith, planOf } from './helpers';

const withNorm = (id: string, normDays: number) => SAMPLE_EMPLOYEES.map((e) => (e.id === id ? { ...e, normDays } : e));

describe('где освободить дни', () => {
  // Иванова, норма 26: 5–19 июля (15 дн.) и 22 ноября – 2 декабря (11 дн.), новое выделение 22–28 сентября (7 дн.)
  const employees = withNorm('E13', 26);
  const me = employees.find((e) => e.id === 'E13')!;
  const plan = planOf('E13', [
    { start: '2027-07-05', end: '2027-07-19', status: 'approved' },
    { start: '2027-11-22', end: '2027-12-02', status: 'approved' },
    ['2027-09-22', '2027-09-28'],
  ]);
  const list = trimSuggestions(me, plan, ctxWith({ employees }), { draftId: 'E13-p3' });

  it('часть 1 не предлагается: без неё не останется части от 14 дней', () => {
    expect(list.some((s) => s.index === 1)).toBe(false);
  });

  it('лучший совет — сократить часть 2 до 22–25 ноября', () => {
    expect(list[0]).toMatchObject({
      index: 2, side: 'end', from: { start: '2027-11-22', end: '2027-12-02' }, to: { start: '2027-11-22', end: '2027-11-25' },
      days: 4, freedDays: 7, shift: 0, message: 'Часть 2: 22 ноября – 2 декабря → 22–25 ноября, освободится 7 дней',
    });
  });

  it('варианты не добавляют запретов, норма соблюдена', () => {
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      // остаётся только прежний запрет: часть 1 (5–19 июля) летом 15 дней
      expect(s.result.results.filter((r) => r.status === 'block').every((r) => r.code === 'summerLength')).toBe(true);
      expect(s.result.totalDays).toBe(26);
    }
  });

  it('согласованные части — после несогласованных при прочих равных', () => {
    const draft = list.filter((s) => s.draft);
    // само выделение 7 дней на 7 не обрезать: от части ничего не останется
    expect(draft).toEqual([]);
    const order = list.map((s) => `${s.status}/${s.touchesApproved}/${s.shift}`);
    expect(order).toEqual([...order].sort((a, b) => {
      const r = (x: string) => { const [st, ap, sh] = x.split('/'); return [st === 'ok' ? 0 : 1, ap === 'true' ? 1 : 0, +sh]; };
      const p = r(a), q = r(b);
      return p[0] - q[0] || p[1] - q[1] || p[2] - q[2];
    }));
  });

  it('обрезка учитывает праздники: часть с 3 июля сокращается по дням отпуска', () => {
    const p = planOf('E18', [['2027-06-28', '2027-07-16'], ['2027-10-04', '2027-10-13']]);
    // 18 + 10 = 28 при норме 24: лишних 4
    const [s] = trimSuggestions(SAMPLE_EMPLOYEES.find((e) => e.id === 'E18')!, p, ctxWith()).filter((x) => x.index === 1 && x.side === 'end');
    expect(s.to).toEqual({ start: '2027-06-28', end: '2027-07-12' });
    expect(s.days).toBe(14);
  });

  it('лишних дней больше, чем есть в других частях — советов нет', () => {
    const employees = withNorm('E13', 14);
    const me = employees.find((e) => e.id === 'E13')!;
    // 10 + 20 = 30 при норме 14: лишних 16 — часть в 10 дней целиком не убираем, новые 20 до 4 — не останется части от 14
    const p = planOf('E13', [['2027-03-01', '2027-03-10'], ['2027-09-06', '2027-09-25']]);
    expect(trimSuggestions(me, p, ctxWith({ employees }), { draftId: 'E13-p2' })).toEqual([]);
  });

  it('без превышения — пусто', () => {
    const p = planOf('E13', [['2027-06-21', '2027-07-05'], ['2027-09-06', '2027-09-15']]);
    expect(trimSuggestions(me, p, ctxWith({ employees }))).toEqual([]);
  });
});

describe('normFixes: советы для экрана сотрудника', () => {
  // норма 26 через доп. дни; части не согласованы, список по датам: июль, сентябрь (новое), ноябрь
  const employees = SAMPLE_EMPLOYEES.map((e) => (e.id === 'E13' ? { ...e, extraDays: 2 } : e));
  const me = employees.find((e) => e.id === 'E13')!;
  const plan = planOf('E13', [['2027-07-05', '2027-07-19'], ['2027-09-22', '2027-09-28'], ['2027-11-22', '2027-12-02']]);

  it('совет про часть с ноябрём, не про июльскую', () => {
    const fixes = normFixes(me, plan, 'E13-p2', ctxWith({ employees }));
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.length).toBeLessThanOrEqual(3);
    expect(fixes.some((f) => f.partId === 'E13-p1')).toBe(false);
    expect(fixes[0]).toMatchObject({ partId: 'E13-p3', side: 'end', to: { start: '2027-11-22', end: '2027-11-25' }, freedDays: 7 });
  });

  it('согласованные части не трогаются', () => {
    const approved = { ...plan, parts: plan.parts.map((p) => (p.id === 'E13-p3' ? { ...p, status: 'approved' as const } : p)) };
    expect(normFixes(me, approved, 'E13-p2', ctxWith({ employees })).some((f) => f.partId === 'E13-p3')).toBe(false);
  });
});

describe('старые запреты на нетронутых частях совету не мешают', () => {
  // как в сиде: Иванова 7–20 июня (14–20 июня мест нет, R01) и 13–22 сентября, выделение 23–29 сентября
  const me = SAMPLE_EMPLOYEES.find((e) => e.id === 'E13')!;
  const plan = planOf('E13', [['2027-06-07', '2027-06-20'], ['2027-09-13', '2027-09-22'], ['2027-09-23', '2027-09-29']]);
  const ctx = ctxWith({}, SAMPLE_PLANS);

  it('совет «13–22 сентября → 13–15 сентября»', () => {
    expect(checkPlan(me, plan, ctx).results.some((r) => r.code === 'groupLimit' && r.status === 'block')).toBe(true);
    const fixes = normFixes(me, plan, 'E13-p3', ctx);
    expect(fixes[0]).toMatchObject({ partId: 'E13-p2', side: 'end', to: { start: '2027-09-13', end: '2027-09-15' }, status: 'warn' });
    // часть 1 сокращать нельзя: пропадёт часть от 14 дней — это новый запрет
    expect(fixes.some((f) => f.partId === 'E13-p1')).toBe(false);
  });
});
