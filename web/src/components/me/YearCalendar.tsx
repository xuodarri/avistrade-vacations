"use client";

/**
 * Карточка «Календарь и мои отпуска»: сверху сетка квартала или года (заливка — загрузка группы,
 * свой отпуск синий), под ней список отпусков. Первая строка — «Новый отпуск»: клик по первому и
 * последнему дню раскрывает её с видом отпуска, проверкой и «Добавить в план». Клик по своей части
 * (в календаре или в списке) раскрывает её строку на месте: края выделения можно тянуть, клик по
 * дню двигает ближайший край. Одновременно раскрыта одна строка.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, MousePointerClick } from "lucide-react";
import { CalendarLegend, CalendarMonth, Card, DayTipLine, IconButton, SegmentedControl, Surface, type DayDecoration } from "@/components/kit";
import { previewEdge } from "@/server/actions/plan";
import type { VacationType } from "@/server/db/types";
import { LOAD_BG, MONTHS, OWN_BG, PART_STATUS, daysText, loadKind, loadPhrase, monthOf, quarterLabel, rangeText } from "./cal";
import { PartEditor, type EditorValue } from "./PartEditor";
import { ChangeEditor, type ChangeKind } from "./ChangeEditor";
import { ApprovedView, NewRow, PartRow, rowOrder, type RowFace } from "./PlanRows";
import { usePlan, type Part } from "./state";
import type { MoveVerdict } from "./types";
import { span, useEdgeDrag, type EdgeDrag } from "./useEdgeDrag";

type Mode = "quarter" | "year";
/**
 * Раскрытая строка: «new» — новый отпуск, иначе ключ части. from — даты части до изменения,
 * readonly — согласованная часть (только просмотр); change — по ней готовят заявку на изменение.
 */
interface Sel { key: string; value: EditorValue; from?: EditorValue; readonly?: boolean; change?: ChangeKind }
/** Выбран первый день нового отпуска */
interface Pending { day: string; type: VacationType }

const VERDICT_FG: Record<MoveVerdict["level"] | "wait", string> = { ok: "var(--ok)", warn: "var(--warn)", block: "var(--bad)", wait: "var(--muted-2)" };
/** Старые даты изменяемой части — бледная обводка «было» */
const WAS_RING = "color-mix(in srgb, var(--vacation-strong) 45%, transparent)";
const DAY = 86_400_000;
const gap = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / DAY;
const NEW = "new";

export function YearCalendar() {
  const p = usePlan();
  const [mode, setMode] = useState<Mode>("quarter");
  const [quarter, setQuarter] = useState(() => {
    const first = p.parts[0]?.start;
    return first ? Math.floor(monthOf(first) / 3) : 2;
  });
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [rowHot, setRowHot] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const reset = () => { setSel(null); setPending(null); };
  const go = (q: number) => {
    if (q < 0 || q > 3) return;
    setDir(q > quarter ? "next" : "prev");
    setQuarter(q);
  };
  const indexOf = (key: string) => p.parts.findIndex((x) => x.key === key);
  const selIndex = sel && sel.key !== NEW ? indexOf(sel.key) : -1;
  const editing = selIndex >= 0 ? selIndex : null;

  /** Раскрыть часть: её даты — выделение в календаре, строка — на месте. Одно обновление состояния. */
  const open = (i: number) => {
    const x = p.parts[i];
    if (!x) return;
    setPending(null);
    const value: EditorValue = {
      range: { start: x.start, end: x.end }, type: x.type, reason: x.reason, note: x.reasonNote,
      substituteId: x.substituteId, substituteName: x.substituteName, needsPay: x.needsPay,
    };
    setSel({ key: x.key, from: value, readonly: p.locked || x.status === "approved", value });
  };
  const toggle = (i: number) => {
    const x = p.parts[i];
    if (sel?.key === x?.key) reset();
    else { open(i); setQuarter(Math.floor(monthOf(x.start) / 3)); setDir(null); setMode("quarter"); }
  };

  // Esc сбрасывает выделение, стрелки листают кварталы
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (pending || sel)) { reset(); return; }
      if (mode !== "quarter" || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body && (!root.current?.contains(el) || el.closest("[role=radiogroup],[role=tablist],input,textarea"))) return;
      e.preventDefault();
      go(quarter + (e.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // клик мимо карточки (календарь и список) сворачивает строку и сбрасывает выделение;
  // всплывающее из порталов (меню, подсказки, тосты, списки Select) — не «мимо»
  useEffect(() => {
    if (!pending && !sel) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || root.current?.contains(t)) return;
      if (t.closest("[data-floating-ui-portal],[role=menu],[role=listbox],[role=tooltip],[role=dialog],[aria-live]")) return;
      reset();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [pending, sel]);

  const ownAt = (d: string) => p.parts.findIndex((x) => x.start <= d && d <= x.end);
  // у заявки на отмену новых дат нет: в календаре только бледные прежние
  const full = sel?.value.range.start && sel.value.range.end && sel.change !== "cancel" ? { start: sel.value.range.start, end: sel.value.range.end } : null;
  // даты можно менять: обычная часть или новый отпуск — либо согласованная, по которой готовят заявку
  const editable = !!sel && (sel.readonly ? !!sel.change && sel.change !== "cancel" : !p.locked);
  const setValue = (v: EditorValue) => setSel((s) => (s ? { ...s, value: v } : s));

  const edges = useEdgeDrag({
    grid,
    fixedFor: (d) => (!full || pending || !editable ? null : d === full.start ? full.end : d === full.end ? full.start : null),
    preview: (fixed) => previewEdge(p.parts.map((x) => ({ type: x.type, startDate: x.start, endDate: x.end, substituteId: x.substituteId })),
      editing, sel?.value.type ?? "main", fixed),
    onDrop: (start, end) => setSel((s) => (s ? { ...s, value: { ...s.value, range: { start, end } } } : s)),
    onEdge: (k) => {
      if (mode !== "quarter") return;
      const n = quarter + k;
      if (n < 0 || n > 3) return;
      setDir(k > 0 ? "next" : "prev");
      setQuarter(n);
    },
  });
  const drag = edges.drag;

  const pick = (d: string) => {
    if (edges.consumeClick()) return;
    if (pending) {
      const [start, end] = pending.day <= d ? [pending.day, d] : [d, pending.day];
      setPending(null);
      setSel({ key: NEW, value: { range: { start, end }, type: pending.type } });
      return;
    }
    const i = ownAt(d);
    if (i >= 0 && i !== editing) { open(i); return; }
    // изменяемая часть: клик двигает ближайший край, а не начинает выделение заново
    if (editing !== null && full && editable) {
      if (d === full.start || d === full.end) return;
      const range = d < full.start ? { start: d, end: full.end }
        : d > full.end ? { start: full.start, end: d }
        : gap(full.start, d) <= gap(d, full.end) ? { start: d, end: full.end } : { start: full.start, end: d };
      setValue({ ...sel!.value, range });
      return;
    }
    if (p.locked) return;
    setSel(null);
    setPending({ day: d, type: sel?.value.type ?? "main" });
  };

  /** Раскрылась строка: если её низ ушёл за край окна — докрутить, но верх календаря не уводить за край */
  const reveal = (el: HTMLElement) => {
    const card = root.current;
    if (!card) return;
    const over = el.getBoundingClientRect().bottom + 16 - window.innerHeight;
    const room = card.getBoundingClientRect().top - 16;
    const dy = Math.min(over, room);
    if (dy > 0) window.scrollBy({ top: dy, behavior: "smooth" });
  };

  const range = drag ? span(drag.fixed, drag.cur) : full ?? (pending ? { start: pending.day, end: null } : undefined);
  // строка, на которую навели, и строка дня под курсором в календаре подсвечивают друг друга
  const hot = rowHot ?? (hover ? ownAt(hover) : -1);

  /** Заливка дня и строки его подсказки: загрузка группы, свой отпуск, края выделения */
  const decorate = (d: string): DayDecoration | null => {
    const l = p.load[d];
    const i = ownAt(d);
    const kind = l ? loadKind(l) : null;
    const load = l && <DayTipLine key="load" tone={p.beneficiary ? "info" : kind === "full" ? "bad" : kind === "one" ? "warn" : "ok"}>{loadPhrase(l, p.beneficiary)}</DayTipLine>;
    const who = p.plan.absent[d] && <DayTipLine key="who" tone="neutral">в отпуске: {p.plan.absent[d].join(", ")}</DayTipLine>;
    // края выделения — синие кружки, их можно тянуть; тащимый край чуть приподнят
    const isStart = range?.start === d, isEnd = range?.end === d;
    if ((isStart || isEnd) && full && !pending) {
      const grab = editable;
      return {
        grab, lift: drag?.cur === d,
        tooltip: [
          grab && <DayTipLine key="edge" tone="vacation">
            {isStart && isEnd ? "потяните, чтобы растянуть выделение" : isStart ? "потяните, чтобы сдвинуть начало" : "потяните, чтобы сдвинуть конец"}
          </DayTipLine>,
          load, who,
        ].filter(Boolean),
      };
    }
    // дни изменяемой части: внутри выделения — без своей заливки и точек (их рисует диапазон),
    // вне его — спокойный «призрак» старых дат
    const inSel = !!range?.start && !!range.end && range.start <= d && d <= range.end;
    if (editing !== null && i === editing) {
      return inSel ? { tooltip: [load, who].filter(Boolean) }
        : { faded: true, ring: WAS_RING, tooltip: [<DayTipLine key="was" tone="neutral">было: часть {i + 1}</DayTipLine>, load, who].filter(Boolean) };
    }
    // часть, которую сократят вместе с выделением (совет по норме): отрезанные дни бледные
    const also = sel?.value.also;
    if (also && i === also.index && (d < also.start || d > also.end)) {
      return { faded: true, ring: WAS_RING, tooltip: [<DayTipLine key="free" tone="neutral">освободится: часть {i + 1} станет {rangeText(also.start, also.end)}</DayTipLine>, load, who].filter(Boolean) };
    }
    // открытая заявка на перенос: её новые даты подсвечены, пока заявку не решат
    const moving = p.parts.findIndex((x) => x.change?.status === "open" && x.change.newStart && x.change.newStart <= d && d <= x.change.newEnd!);
    if (moving >= 0 && !(moving === editing && sel?.change) && (i < 0 || i === moving)) {
      const c = p.parts[moving].change!;
      return {
        ...(i >= 0 ? { bg: OWN_BG } : kind ? { bg: LOAD_BG[kind] } : {}), ring: "var(--warn)",
        tooltip: [<DayTipLine key="chg" tone="warn">заявка: часть {moving + 1} на {rangeText(c.newStart!, c.newEnd!)} — на согласовании</DayTipLine>, load, who].filter(Boolean),
      };
    }
    const own = i >= 0 ? p.parts[i] : null;
    if (own) {
      // свой отпуск всегда синий; конфликт с группой — красная точка, а не перекраска дня
      const conflict = kind === "full" && own.type !== "unpaid189";
      const movable = !p.locked && own.status !== "approved";
      return {
        bg: OWN_BG, dot: conflict ? "var(--bad)" : "var(--vacation)",
        ring: i === hot && !inSel ? "var(--vacation-strong)" : undefined,
        tooltip: [
          <DayTipLine key="own" tone="vacation">ваш отпуск, часть {i + 1} — {PART_STATUS[own.status].label.toLowerCase()}</DayTipLine>,
          load, who,
          movable
            ? <DayTipLine key="how" tone="neutral">нажмите, чтобы изменить даты</DayTipLine>
            : <DayTipLine key="how" tone="neutral">перенос согласованного отпуска — через РО1{p.plan.rescheduleDays ? `, не позднее чем за ${p.plan.rescheduleDays} дней до начала` : ""}</DayTipLine>,
        ].filter(Boolean),
      };
    }
    const tooltip = [load, who].filter(Boolean);
    return kind ? { bg: LOAD_BG[kind], tooltip } : tooltip.length ? { tooltip } : null;
  };

  const months = mode === "year" ? Array.from({ length: 12 }, (_, m) => m) : [quarter * 3, quarter * 3 + 1, quarter * 3 + 2];
  const isNew = sel?.key === NEW;
  // шапка раскрытой строки показывает выделение вживую: тянут края — меняются даты и дни
  const face: RowFace | null = sel && range?.start && range.end ? {
    start: range.start, end: range.end, type: sel.value.type, substituteName: sel.value.substituteName ?? null,
    reason: sel.value.reason ?? null, reasonNote: sel.value.note ?? null, needsPay: sel.value.type === "main" && !!sel.value.needsPay,
  } : null;
  const editor = (x: Part | null, i: number | null) => {
    if (!sel) return null;
    const back = () => setSel((s) => (s ? { ...s, change: undefined, value: s.from ?? s.value } : s));
    if (sel.change && x && i !== null) {
      return <ChangeEditor part={x} index={i} kind={sel.change} range={sel.value.range.start && sel.value.range.end ? { start: sel.value.range.start, end: sel.value.range.end } : null}
        onKind={(k) => setSel((s) => (s ? { ...s, change: k } : s))} onRange={(r) => setValue({ ...sel.value, range: r })}
        onBack={back} onSent={back} />;
    }
    if (sel.readonly && x && i !== null) return <ApprovedView part={x} index={i} onRequest={() => setSel((s) => (s ? { ...s, change: "move" } : s))} />;
    return <PartEditor key={sel.key} index={i} value={sel.value} from={sel.from} onChange={setValue} onDone={reset} />;
  };

  return (
    <div ref={root} className="scroll-mt-4">
    <Card className="flex flex-col gap-4" data-tour="me.calendar">
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <h2 className="text-[19px] font-semibold tracking-[-0.022em]">Календарь {p.year}</h2>
        {mode === "quarter" && (
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Предыдущий квартал (←)" size="sm" disabled={quarter === 0} onClick={() => go(quarter - 1)} />
            <span className="text-[14px] text-muted min-w-[210px] text-center tnum">{quarterLabel(quarter)}</span>
            <IconButton icon={ChevronRight} label="Следующий квартал (→)" size="sm" disabled={quarter === 3} onClick={() => go(quarter + 1)} />
          </div>
        )}
        <div className="ml-auto">
          <SegmentedControl size="sm" value={mode} onChange={(m) => { setDir(null); setMode(m); }}
            options={[{ value: "quarter", label: "Квартал" }, { value: "year", label: "Год" }]} />
        </div>
      </div>
      <div data-tour="me.legend" className="-mt-1"><CalendarLegend className="px-1" /></div>

      <div ref={grid} onPointerDown={edges.onPointerDown}>
      <div key={mode === "quarter" ? quarter : "year"} data-tour="me.months" className="grid grid-cols-[repeat(auto-fill,280px)] justify-between gap-y-5">
        {months.map((m) => (
          <div key={m}>
            <button type="button" onClick={() => { if (mode === "year") { setDir(null); setQuarter(Math.floor(m / 3)); setMode("quarter"); } }}
              className={`px-2 mb-1 text-[15px] font-semibold tracking-[-0.015em] ${mode === "year" ? "press cursor-pointer hover:text-accent-strong" : "cursor-default"}`}
              title={mode === "year" ? "Открыть квартал" : undefined}>
              {MONTHS[m]}
            </button>
            <CalendarMonth year={p.year} month={m} range={range} hoverEnd={pending ? hover : null} onHover={setHover}
              onPick={pick} dayDecorator={decorate} dir={mode === "quarter" ? dir : null} hideFootnote={mode === "year"} />
          </div>
        ))}
      </div>
      </div>
      {drag && <EdgeBadge drag={drag} verdict={edges.verdicts?.[drag.cur]} />}

      {/* Мои отпуска: новый сверху, дальше части — черновики, на согласовании, согласованные */}
      <section className="flex flex-col gap-2" aria-label="Мои отпуска" data-tour="me.parts">
        <NewRow face={isNew ? face : null} onOpened={reveal} hint={<DayInfo day={hover} pending={pending?.day ?? null} />}>
          {isNew ? editor(null, null) : null}
        </NewRow>
        {rowOrder(p.parts).map(({ x, i }) => (
          <PartRow key={x.key} part={x} index={i} open={sel?.key === x.key} hot={hot === i} face={sel?.key === x.key ? face ?? undefined : undefined}
            badge={sel?.key === x.key && sel.change ? "Заявка на изменение" : undefined}
            onToggle={() => toggle(i)} onHot={(on) => setRowHot(on ? i : null)} onOpened={reveal}>
            {sel?.key === x.key ? editor(x, i) : null}
          </PartRow>
        ))}
      </section>
    </Card>
    </div>
  );
}

/** Плашка у курсора, пока тянут край: новые даты, длина и одна причина, если не проходит */
function EdgeBadge({ drag, verdict }: { drag: EdgeDrag; verdict?: MoveVerdict }) {
  const p = usePlan();
  const { start, end } = span(drag.fixed, drag.cur);
  const days = p.days({ type: "main", start, end });
  return createPortal(
    <div className="fixed z-[95] pointer-events-none max-w-[300px]" style={{ left: drag.x + 16, top: drag.y + 18 }}>
      <Surface level="block" pad={10} tone="raised" className="shadow-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold tnum whitespace-nowrap">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: VERDICT_FG[verdict?.level ?? "wait"] }} />
          {rangeText(start, end)} · {daysText(days)}
        </div>
        {verdict?.reason && <div className="text-[12px] text-text-2 leading-snug mt-1 pl-4">{verdict.reason}</div>}
        {!verdict && <div className="text-[12px] text-muted mt-1 pl-4">Проверяем…</div>}
      </Surface>
    </div>,
    document.body,
  );
}

/** Свёрнутая строка «Новый отпуск»: как выбрать даты */
function DayInfo({ day, pending }: { day: string | null; pending: string | null }) {
  const p = usePlan();
  if (p.locked) return <p className="text-[13px] text-muted">План утверждён. Чтобы изменить даты, откройте часть ниже и нажмите «Запросить перенос».</p>;
  if (pending) {
    const [a, b] = day && day < pending ? [day, pending] : [pending, day ?? pending];
    return (
      <p className="text-[13px] text-text-2 tnum">
        <b className="font-semibold">Новый отпуск: начало — {rangeText(pending, pending)}.</b> Выберите последний день или нажмите ещё раз — один день
        {day && day !== pending && <span className="text-muted">: {rangeText(a, b)}, {daysText(p.days({ type: "main", start: a, end: b }))}</span>}
        <span className="text-muted">. Esc — отменить.</span>
      </p>
    );
  }
  return (
    <p className="text-[13px] text-muted flex items-center gap-1.5">
      <MousePointerClick size={15} className="shrink-0" />
      <span><b className="font-semibold text-text-2">Новый отпуск</b> — выделите даты в календаре: первый и последний день</span>
    </p>
  );
}
