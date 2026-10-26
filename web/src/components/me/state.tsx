"use client";

/**
 * Состояние экрана «Мой отпуск»: части плана, проверка, статус заявки. Правки применяются сразу
 * (оптимистично) и уходят на сервер по очереди; при ошибке — откат и уведомление.
 */
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/kit";
import { previewSubmit, saveMyPlan, submitMyPlan } from "@/server/actions/plan";
import type { PartInput, PartStatus, VacationType } from "@/server/db/types";
import { rangeText, vacationDays, worse } from "./cal";
import type { DayLoadView, Level, MyChange, MyCheck, MyFinding, MyPlan, MyRequest, SaveResult } from "./types";

export interface Part {
  key: string;
  /** id в базе; null — ещё не сохранена */
  id: number | null;
  /** Открытая или возвращённая заявка на изменение согласованной части */
  change: MyChange | null;
  type: VacationType;
  start: string;
  end: string;
  status: PartStatus;
  /** Кто замещает: id и короткое имя */
  substituteId: string | null;
  substituteName: string | null;
  /** За свой счёт: причина и пояснение */
  reason: string | null;
  reasonNote: string | null;
  /** Нужны отпускные (п. 4 регламента) */
  needsPay: boolean;
}
/** Части в проверке и при сохранении: даты, вид и, если есть, замещающий и причина */
export type PartDraft = Pick<Part, "type" | "start" | "end"> & Partial<Pick<Part, "substituteId" | "substituteName" | "reason" | "reasonNote" | "needsPay">>;
/** Сократить другую часть вместе с выделением — чтобы уложиться в норму */
export interface Also { index: number; start: string; end: string }

const byStart = (a: PartDraft, b: PartDraft) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
const toInput = (p: PartDraft): PartInput => ({
  type: p.type, startDate: p.start, endDate: p.end,
  substituteId: p.substituteId ?? null, reason: p.reason ?? null, reasonNote: p.reasonNote ?? null, needsPay: !!p.needsPay,
});
const draftOf = ({ type, start, end, substituteId, reason, reasonNote, needsPay }: Part): PartDraft => ({ type, start, end, substituteId, reason, reasonNote, needsPay });
let keySeq = 0;
const newKey = () => `p${++keySeq}`;

interface PlanState {
  plan: MyPlan;
  year: number;
  holidays: Map<string, string>;
  holSet: Set<string>;
  load: Record<string, DayLoadView>;
  beneficiary: boolean;
  parts: Part[];
  check: MyCheck;
  request: MyRequest | null;
  locked: boolean;
  /** Идёт сохранение: проверка на экране может отстать на мгновение */
  saving: boolean;
  submitting: boolean;
  days: (p: PartDraft) => number;
  totalMain: number;
  partFindings: (no: number) => MyFinding[];
  partLevel: (no: number) => Level;
  /** Список частей после правки: index — какую заменить (null — добавить), вернёт и номер этой части */
  withPart: (index: number | null, p: PartDraft, also?: Also) => { list: PartDraft[]; no: number; origin: (number | null)[] };
  /** also — заодно сократить другую часть; одно сохранение и одно «Отменить» */
  upsert: (index: number | null, p: PartDraft, also?: Also) => void;
  remove: (index: number) => void;
  /** Что будет при отправке: можно ли подать и что уйдёт как исключение */
  previewSubmit: () => ReturnType<typeof previewSubmit>;
  /** note — обоснование исключения («почему нужны именно эти даты»); true — отправлено */
  submit: (note?: string) => Promise<boolean>;
  /** Заявка на изменение согласованной части подана или отозвана — обновить строку */
  setChange: (index: number, change: MyChange | null) => void;
}

const Ctx = createContext<PlanState | null>(null);
export const usePlan = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlan вне PlanProvider");
  return c;
};

export function PlanProvider({ initial, children }: { initial: MyPlan; children: ReactNode }) {
  const holidays = useMemo(() => new Map(initial.holidays.map((h) => [h.date, h.name])), [initial.holidays]);
  const holSet = useMemo(() => new Set(holidays.keys()), [holidays]);
  const [parts, setParts] = useState<Part[]>(() =>
    initial.parts.map((p) => ({
      key: newKey(), id: p.id, change: p.change, type: p.type, start: p.startDate, end: p.endDate, status: p.status,
      substituteId: p.substitute?.id ?? null, substituteName: p.substitute?.name ?? null, reason: p.reason, reasonNote: p.reasonNote, needsPay: p.needsPay,
    })));
  const [check, setCheck] = useState(initial.check);
  const [request, setRequest] = useState(initial.request);
  const [saving, setSaving] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const current = useRef(parts);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const days = (p: PartDraft) => vacationDays(p.start, p.end, holSet);
  const apply = (r: SaveResult, list: Part[]) => {
    setRequest(r.request);
    setCheck(r.check);
    const next = list.map((p, i) => ({
      ...p, status: r.parts[i]?.status ?? p.status, id: r.parts[i]?.id ?? p.id,
      substituteName: r.parts[i] ? r.parts[i].substitute?.name ?? null : p.substituteName,
    }));
    current.current = next;
    setParts(next);
  };

  /** Применить список сразу и сохранить на сервере; undo — что вернуть по «Отменить» */
  const commit = (next: Part[], message: string, undo?: Part[]) => {
    const prev = current.current;
    const sorted = [...next].sort(byStart);
    current.current = sorted;
    setParts(sorted);
    setSaving((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const r = await saveMyPlan(sorted.map(toInput));
        if (!r.ok) throw new Error(r.error);
        if (current.current === sorted) apply(r, sorted);
        toast(message, undo ? { duration: 8000, action: { label: "Отменить", onClick: () => commit(undo, "Изменение отменено") } } : {});
      } catch (e) {
        current.current = prev;
        setParts(prev);
        toast("Не удалось сохранить", { tone: "bad", description: e instanceof Error && e.message ? e.message : "Попробуйте ещё раз" });
      } finally {
        setSaving((n) => n - 1);
      }
    });
  };

  const withPart = (index: number | null, p: PartDraft, also?: Also) => {
    const list: (PartDraft & { from: number | null })[] = parts.map((x, i) =>
      also?.index === i ? { ...draftOf(x), start: also.start, end: also.end, from: i } : { ...draftOf(x), from: i });
    const mine = { ...p, from: index };
    if (index === null) list.push(mine); else list[index] = mine;
    const sorted = [...list].sort(byStart);
    return { list: sorted.map(({ type, start, end, substituteId, reason, reasonNote, needsPay }) => ({ type, start, end, substituteId, reason, reasonNote, needsPay })), no: sorted.indexOf(mine) + 1, origin: sorted.map((x) => x.from) };
  };

  const partFindings = (no: number) => check.findings.filter((f) => f.partNo === no);

  const value: PlanState = {
    plan: initial,
    year: initial.year,
    holidays, holSet,
    load: initial.load,
    beneficiary: !!initial.employee.benefit,
    parts, check, request,
    locked: initial.locked,
    saving: saving > 0,
    submitting,
    days,
    totalMain: parts.filter((p) => p.type === "main").reduce((s, p) => s + days(p), 0),
    partFindings,
    partLevel: (no) => partFindings(no).reduce<Level>((w, f) => worse(w, f.level), "ok"),
    withPart,
    upsert: (index, p, also) => {
      const cur = current.current;
      const trimmed = cur.map((x, i) => (also?.index === i ? { ...x, start: also.start, end: also.end, status: "draft" as const } : x));
      const next = index === null
        ? [...trimmed, {
          key: newKey(), id: null, change: null, substituteId: null, substituteName: null, reason: null, reasonNote: null, needsPay: false, ...p, status: "draft" as const,
        }]
        : trimmed.map((x, i) => (i === index ? { ...x, ...p, status: "draft" as const } : x));
      const what = index === null ? `Добавлено в план: ${rangeText(p.start, p.end)}` : `Часть ${index + 1}: ${rangeText(p.start, p.end)}`;
      const plus = also ? `; часть ${also.index + 1}: ${rangeText(also.start, also.end)}` : "";
      commit(next, what + plus, index === null && !also ? undefined : cur);
    },
    remove: (index) => {
      const cur = current.current;
      const gone = cur[index];
      commit(cur.filter((_, i) => i !== index), `Удалено: ${rangeText(gone.start, gone.end)}`, cur);
    },
    setChange: (index, change) => {
      const next = current.current.map((x, i) => (i === index ? { ...x, change } : x));
      current.current = next;
      setParts(next);
    },
    previewSubmit: async () => {
      await queue.current;
      return previewSubmit(current.current.map(toInput));
    },
    submit: async (note) => {
      setSubmitting(true);
      await queue.current;
      try {
        const list = current.current;
        const r = await submitMyPlan(list.map(toInput), note);
        if (!r.ok) {
          setCheck(r.check);
          toast("План не отправлен", { tone: "bad", description: r.error });
          return false;
        }
        apply(r, list);
        toast(note ? "План отправлен как запрос исключения" : "План отправлен руководителю",
          { description: "Ответ придёт на почту, статус обновится здесь" });
        return true;
      } catch {
        toast("Не удалось отправить", { tone: "bad", description: "Попробуйте ещё раз" });
        return false;
      } finally {
        setSubmitting(false);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
