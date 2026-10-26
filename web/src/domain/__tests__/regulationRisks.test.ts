import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../config';
import { dbRuleCode, planFromDb, rulesFromDb } from '../fromDb';
import type * as Db from '../../server/db/types';
import { check } from './helpers';

describe('плановое лечение (регламент)', () => {
  const treat = (start: string, end: string) => ({ start, end, type: 'treatment' as const });

  it('подчиняется лимиту группы и сроку «за месяц»', () => {
    // E13 на 14–20 июня — третий менеджер по продажам
    const { of } = check('E13', [treat('2027-06-14', '2027-06-20')], { today: '2027-06-01' });
    expect(of('groupLimit')[0]).toMatchObject({ status: 'block', consequence: 'exception' });
    expect(of('noticeMonth')[0]).toMatchObject({ status: 'block', consequence: 'exception' });
  });

  it('в норму дней не входит, лимиты ст. 189/190 и лето не действуют', () => {
    const { res, of } = check('E18', [['2027-03-09', '2027-04-01'], treat('2027-07-01', '2027-08-15')]);
    expect(res.totalDays).toBe(24);
    expect(of('yearNorm')[0].status).toBe('ok');
    expect(of('unpaid190Limit')[0].status).toBe('off');
    expect(of('unpaid189Limit')[0].status).toBe('off');
    expect(of('summerLength').every((r) => r.status !== 'warn')).toBe(true);
  });
});

describe('полугодовой график (регламент, п. 5)', () => {
  it('первое полугодие — до 15 января: позже — запрос исключения с пометкой о риске', () => {
    const [r] = check('E18', [{ start: '2027-03-01', end: '2027-03-15', submittedOn: '2027-01-20' }], { today: '2027-01-20' })
      .of('halfYearDeadline');
    expect(r).toMatchObject({
      status: 'block', consequence: 'exception', dateBound: true,
      message: 'Часть 1: заявление на первое полугодие нужно было подать до 15 января 2027',
    });
    expect(r.legalRisk).toContain('ч. 2 ст. 168');
  });

  it('второе полугодие — до 15 июля: та же дата подачи проходит', () => {
    const [r] = check('E18', [{ start: '2027-09-06', end: '2027-09-19', submittedOn: '2027-01-20' }], { today: '2027-01-20' })
      .of('halfYearDeadline');
    expect(r).toMatchObject({ status: 'ok', message: 'Заявление на второе полугодие — до 15 июля 2027' });
  });

  it('график полугодия уже утверждён — новая часть только по договорённости; срок можно задать', () => {
    const settings = { year: 2027, regulationDeadlines: [], collectiveAgreement: false,
      halfYears: [{ year: 2027, half: 1 as const, deadline: '2027-01-15', approved: true }, { year: 2027, half: 2 as const, deadline: '2027-07-01', approved: false }] };
    expect(check('E18', [['2027-03-01', '2027-03-15']], { today: '2027-02-01', settings }).of('halfYearDeadline')[0].message)
      .toBe('Часть 1: график на первое полугодие 2027 уже утверждён — нужна договорённость с отделом кадров');
    expect(check('E18', [['2027-09-06', '2027-09-19']], { today: '2027-07-05', settings }).of('halfYearDeadline')[0].message)
      .toBe('Часть 1: заявление на второе полугодие нужно было подать до 1 июля 2027');
  });

  it('вне графика и для согласованных частей не проверяется', () => {
    const late = { start: '2027-03-01', end: '2027-03-15', submittedOn: '2027-01-20' };
    expect(check('E18', [late], { today: '2027-01-20', stage: 'adhoc' }).of('halfYearDeadline')[0].status).toBe('off');
    expect(check('E18', [{ ...late, status: 'approved' as const }], { today: '2027-01-20' }).of('halfYearDeadline')[0].status).toBe('off');
  });
});

describe('отпускные по заявлению (п. 4, R18)', () => {
  const on = { rules: DEFAULT_RULES.map((r) => (r.code === 'substitute' ? { ...r, enabled: false } : r)) };

  it('флаг переносится из базы', () => {
    const row = { type: 'main', startDate: '2027-06-21', endDate: '2027-07-05', needsPay: true } as Db.PartInput;
    expect(planFromDb('E13', 2027, [row]).parts[0].needsPay).toBe(true);
  });

  it('не нарушение: без отметки — ничего, с отметкой — пометка риска (info)', () => {
    const plain = check('E18', [['2027-03-09', '2027-04-01']], on);
    expect(plain.of('payRequest')[0].status).toBe('ok');
    expect(plain.res.status).toBe('ok');
    const [r] = check('E18', [{ start: '2027-03-09', end: '2027-04-01', needsPay: true }], on).of('payRequest');
    expect(r).toMatchObject({ status: 'info', message: 'Часть 1: отпускные по заявлению, не больше оклада', dateBound: false });
    expect(r.consequence).toBeUndefined();
    expect(r.legalRisk).toContain('ст. 175–176');
  });

  it('не основной отпуск — не проверяется', () => {
    expect(check('E18', [{ start: '2027-03-09', end: '2027-03-12', type: 'unpaid190' }], on).of('payRequest')[0].status).toBe('off');
  });
});

describe('п. 8 выключен (R20)', () => {
  const off = { rules: DEFAULT_RULES.map((r) => (['substitute', 'payRequest', 'treatmentLeave'].includes(r.code) ? { ...r, enabled: false } : r)) };

  it('лечение не проверяется R01, R02, R04, R15 — только пересечение частей', () => {
    const rules = off.rules.map((r) => (r.code === 'substitute' ? { ...r, enabled: true } : r));
    const treat = check('E13', [{ start: '2027-06-14', end: '2027-06-20', type: 'treatment' }, { start: '2027-06-18', end: '2027-06-30' }],
      { rules, today: '2027-06-01' });
    const forTreat = (code: string) => treat.of(code as never).filter((r) => r.partIds.includes('E13-p1'));
    for (const code of ['groupLimit', 'roleDependencies', 'noticeMonth', 'substitute']) {
      expect(forTreat(code).every((r) => r.status === 'off' || r.status === 'ok')).toBe(true);
    }
    expect(treat.of('noOverlap')[0].status).toBe('block');
    // за свой счёт п. 8 не касается: лимит действует
    expect(check('E13', [{ start: '2027-06-14', end: '2027-06-20', type: 'unpaid190' }], off).of('groupLimit')[0].status).toBe('block');
  });

  it('включён — у части лечения пометка риска', () => {
    const [r] = check('E18', [{ start: '2027-03-01', end: '2027-03-05', type: 'treatment' }]).of('treatmentLeave');
    expect(r).toMatchObject({ status: 'info' });
    expect(r.legalRisk).toContain('ст. 171');
  });
});

describe('коды и пометки из базы', () => {
  it('R18–R21', () => {
    expect(['payRequest', 'halfYearDeadline', 'treatmentLeave', 'changeLocked'].map((c) => dbRuleCode(c as never))).toEqual(['R18', 'R19', 'R20', 'R21']);
  });

  it('legalRisk: true + legalNote из базы, жёсткость из базы (R19 — предупреждение)', () => {
    const row: Db.Rule = {
      code: 'R19', title: 'График на полугодие', enabled: true, severity: 'warn', source: 'регламент', basis: 'п. 5', howChecked: '',
      params: { value: null, stages: { collect: 'warn', adhoc: 'warn', inplan: 'warn' }, benefitApplies: true, legalRisk: true, legalNote: 'Противоречит ч. 2 ст. 168 ТК' },
    };
    const [r] = rulesFromDb([row]);
    expect(r).toMatchObject({ code: 'halfYearDeadline', severity: 'warn', legalRisk: 'Противоречит ч. 2 ст. 168 ТК' });
    const late = check('E18', [{ start: '2027-03-01', end: '2027-03-15', submittedOn: '2027-01-20' }], { today: '2027-01-20', rules: [r] }).of('halfYearDeadline')[0];
    expect(late).toMatchObject({ status: 'warn', consequence: 'warning', legalRisk: 'Противоречит ч. 2 ст. 168 ТК' });
  });
});
