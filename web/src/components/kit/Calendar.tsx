"use client";

/**
 * Календарь РБ: месяц с листанием, выбор даты или диапазона, выходные и праздники красным
 * (праздник подчёркнут), подкраска дней снаружи и своя подсказка дня (DayTip).
 * Праздники и переносы рабочих дней — из `@/domain/calendar`.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Placement } from "@floating-ui/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { WORKDAY_TRANSFERS, holidayAt, isWorkingDay, vacationDays } from "@/domain/calendar";
import { dateText, daysText, dayNum, parts, rangeText, toDay, toIso } from "@/domain/dates";
import { cx } from "./cx";
import { Button, IconButton } from "./Button";
import { Popover } from "./Popover";
import { useControlRadius } from "./Surface";
import { DayTipLine, dayTip } from "./DayTip";

export type IsoDate = string;
export interface DateRange { start: IsoDate | null; end: IsoDate | null }

/** Готовые тона подкраски дня. Цвета — токены: --load-free / --load-one / --load-full / --vacation-bg. */
export type DayTone = "free" | "one" | "full" | "own" | "muted";
const TONE_BG: Record<DayTone, string> = {
  free: "var(--load-free)", one: "var(--load-one)", full: "var(--load-full)", own: "var(--vacation-bg)", muted: "var(--fill-2)",
};
export const DAY_TONE_LABEL: Record<Exclude<DayTone, "muted">, string> = {
  free: "свободно", one: "одно место", full: "мест нет", own: "ваш отпуск",
};

/** Произвольная подкраска дня. Всё необязательно. */
export interface DayDecoration {
  tone?: DayTone;
  /** Свой фон (CSS-цвет), если готовых тонов мало. */
  bg?: string;
  /** Точка под числом (цвет). */
  dot?: string;
  /**
   * Строки подсказки дня под датой и праздником: текст, узел или массив строк.
   * Строка с цветной точкой — `<DayTipLine tone="bad">запрет: мест нет</DayTipLine>`.
   */
  tooltip?: ReactNode | ReactNode[];
  /** Короткая подпись строкой: попадает и в подсказку, и в aria-label дня. */
  title?: string;
  /** Запретить выбор дня (подсказка при этом показывается). */
  disabled?: boolean;
  /** «Поднятый» день — призрак при перетаскивании: тень и scale 1.06 поверх соседей. */
  lift?: boolean;
  /** Бледный день: число opacity 0.35, подкраска 0.55, обводка края диапазона не бледнеет — исходное место переносимой части. */
  faded?: boolean;
  /** Цвет обводки одного дня (CSS-цвет), 1.5 px внутрь. */
  ring?: string;
  /** Курсор «взять» на дне, который можно тащить. Во время переноса — атрибут data-grabbing на предке. */
  grab?: boolean;
}

const WEEKDAY = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const TONE_TIP: Record<Exclude<DayTone, "muted">, { tone: "ok" | "warn" | "bad" | "vacation"; text: string }> = {
  free: { tone: "ok", text: "в группе есть места" }, one: { tone: "warn", text: "в группе осталось одно место" },
  full: { tone: "bad", text: "в группе мест нет" }, own: { tone: "vacation", text: "ваш отпуск" },
};

/** Содержимое подсказки дня: дата и день недели, праздник или выходной, строки декоратора. */
function DayTipContent({ iso, deco, tone, outside }: { iso: IsoDate; deco: DayDecoration | null; tone: DayTone | null; outside: boolean }) {
  const n = toDay(iso);
  const holiday = holidayAt(n);
  const wd = parts(n).wd;
  const transfer = WORKDAY_TRANSFERS[iso] as boolean | undefined;
  const off = !!holiday || transfer === false || (wd >= 5 && transfer !== true);
  const kind = holiday ? holiday : transfer === false ? "Выходной по переносу рабочего дня"
    : transfer === true ? "Рабочий день по переносу" : wd >= 5 ? "Выходной" : null;
  const extra = deco?.tooltip == null ? [] : Array.isArray(deco.tooltip) ? deco.tooltip : [deco.tooltip];
  const toneLine = tone && tone !== "muted" && !extra.length ? TONE_TIP[tone] : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="font-semibold text-[13px] tnum">{dateText(iso, true)}, {WEEKDAY[wd]}</div>
      {kind && <DayTipLine tone={off ? "bad" : "neutral"}>{kind}</DayTipLine>}
      {holiday && <div className="pl-[14px] text-[11.5px] text-white/55">праздник в отпуск не входит</div>}
      {deco?.title && <DayTipLine>{deco.title}</DayTipLine>}
      {extra.map((x, i) => (typeof x === "string" ? <DayTipLine key={i}>{x}</DayTipLine> : <div key={i}>{x}</div>))}
      {toneLine && <DayTipLine tone={toneLine.tone}>{toneLine.text}</DayTipLine>}
      {outside && <DayTipLine tone="neutral">вне доступного периода</DayTipLine>}
    </div>
  );
}

const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export interface MonthProps {
  year: number;
  month: number; // 0–11
  range?: DateRange;
  /** Предпросмотр диапазона при наведении (второй клик ещё не сделан). */
  hoverEnd?: IsoDate | null;
  onHover?: (d: IsoDate | null) => void;
  onPick?: (d: IsoDate) => void;
  min?: IsoDate;
  max?: IsoDate;
  dayTone?: (d: IsoDate) => DayTone | null | undefined;
  dayDecorator?: (d: IsoDate) => DayDecoration | null | undefined;
  /** Направление анимации смены месяца. */
  dir?: "next" | "prev" | null;
  /** Скрыть строку с праздником под сеткой. */
  hideFootnote?: boolean;
  /**
   * Как рисовать выбранный диапазон: fill — заливка (по умолчанию), outline — только обводка
   * цветом --vacation-strong, края-кружки белые. Обводкой удобно показать часть, которую меняют,
   * чтобы она отличалась от нового выделения.
   */
  rangeStyle?: "fill" | "outline";
}

/** Стиль кнопки дня: обводка и «поднятый» призрак. Подкраска — отдельный слой ячейки (kit-day-bg). */
function dayStyle(deco: DayDecoration | null, edge: boolean): CSSProperties | undefined {
  const st: CSSProperties = {};
  const shadows: string[] = [];
  if (deco?.ring && !edge) shadows.push(`inset 0 0 0 1.5px ${deco.ring}`);
  // у края выделения поднимается круг слоя (data-lift), кнопка остаётся прозрачной
  if (deco?.lift && !edge) {
    shadows.push("0 2px 4px rgba(0,0,0,0.08), 0 8px 18px rgba(0,0,0,0.16)");
    st.transform = "scale(1.06)";
    st.background = "var(--surface)";
  }
  if (shadows.length) st.boxShadow = shadows.join(", ");
  return Object.keys(st).length ? st : undefined;
}

/* ---------------- слой выделения ---------------- */

/**
 * Геометрия выделенного диапазона в сетке месяца: по капсуле на строку недели и круги краёв.
 * Капсулы и круги — отдельный слой под днями, а не фон ячеек: при выделении ячейки не меняют
 * ни фон, ни радиус, анимируются только opacity и transform слоя (и сдвиг при перетаскивании края).
 */
interface Seg { r: number; c0: number; c1: number }
interface Dot { r: number; c: number; lift: boolean }
/** a, b — номера первого и последнего дня выделения (могут быть за пределами месяца) */
interface Geom { a: number; b: number; segs: (Seg | null)[]; start: Dot | null; end: Dot | null; preview: boolean; outline: boolean }

const ROW = 40; // h-9 (36) + gap-y-1 (4)
const W = "(100% / 7)";
const segLeft = (c: number) => `calc(${c} * ${W} + (${W} - 36px) / 2)`;
const sameGeom = (x: Geom | null, y: Geom | null) => x === y || (!!x && !!y && JSON.stringify(x) === JSON.stringify(y));

/**
 * Слой выделения. Новое выделение (или сброс) — старые капсулы гаснут на месте, новые появляются
 * целиком (opacity + scale). Если один край остался на месте (перетаскивают другой) — те же элементы
 * плавно едут: так перетаскивание края двигает капсулу без мигания.
 */
function RangeLayer({ geom, rows }: { geom: Geom | null; rows: number }) {
  const [st, setSt] = useState<{ cur: Geom | null; prev: Geom | null; epoch: number }>({ cur: geom, prev: null, epoch: 0 });
  if (!sameGeom(st.cur, geom)) {
    const kept = !!geom && !!st.cur && (st.cur.a === geom.a || st.cur.b === geom.b);
    setSt({ cur: geom, prev: st.cur, epoch: kept ? st.epoch : st.epoch + 1 });
  }
  const { prev, epoch } = st;
  const kept = !!geom && !!prev && (prev.a === geom.a || prev.b === geom.b);
  if (!geom && !prev) return null;
  const outline = (geom ?? prev)!.outline;

  const segEl = (s: Seg, key: string, on: boolean, move: boolean, preview: boolean) => (
    <span key={key} aria-hidden data-on={on ? "" : undefined} data-move={move ? "" : undefined}
      className={cx("kit-range-seg absolute rounded-full", outline ? "border-[1.5px] border-vacation-strong" : "bg-vacation-bg",
        outline && preview && "border-dashed", !outline && preview && "kit-range-preview")}
      style={{ top: s.r * ROW + 1, height: 34, left: segLeft(s.c0), width: `calc(${s.c1 - s.c0} * ${W} + 36px)` }} />
  );
  const dotEl = (d: Dot, key: string, on: boolean, move: boolean) => (
    <span key={key} aria-hidden data-on={on ? "" : undefined} data-move={move ? "" : undefined} data-lift={d.lift ? "" : undefined}
      className={cx("kit-range-dot absolute w-9 h-9 rounded-full",
        outline ? "bg-surface shadow-[inset_0_0_0_1.5px_var(--vacation-strong)]" : "bg-vacation-strong shadow-[0_2px_6px_rgba(10,132,255,0.35)]")}
      style={{ top: d.r * ROW, left: segLeft(d.c) }} />
  );

  const out: ReactNode[] = [];
  // гаснущее: прошлое выделение, если оно сменилось целиком или сброшено (ключи прошлой эпохи)
  if (prev && !kept) {
    const pe = geom ? epoch - 1 : epoch;
    prev.segs.forEach((s, r) => { if (s) out.push(segEl(s, `s${r}-${pe}`, false, false, prev.preview)); });
    if (prev.start) out.push(dotEl(prev.start, `a-${pe}`, false, false));
    if (prev.end) out.push(dotEl(prev.end, `b-${pe}`, false, false));
  }
  if (geom) {
    for (let r = 0; r < rows; r++) {
      const s = geom.segs[r], was = kept ? prev!.segs[r] : null;
      if (s) out.push(segEl(s, `s${r}-${epoch}`, true, !!was, geom.preview));
      else if (was) out.push(segEl(was, `s${r}-${epoch}`, false, false, geom.preview)); // строка ушла из выделения — гаснет на месте
    }
    if (geom.start) out.push(dotEl(geom.start, `a-${epoch}`, true, kept && !!prev!.start));
    else if (kept && prev!.start) out.push(dotEl(prev!.start, `a-${epoch}`, false, false));
    if (geom.end) out.push(dotEl(geom.end, `b-${epoch}`, true, kept && !!prev!.end));
    else if (kept && prev!.end) out.push(dotEl(prev!.end, `b-${epoch}`, false, false));
  }
  return <div aria-hidden className="absolute inset-0 pointer-events-none">{out}</div>;
}

/** Праздники месяца для строки под сеткой: «1, 2 января — Новый год», «7 января — Рождество Христово (православное)». */
function holidayLines(days: number[]): string[] {
  const groups: { name: string; days: number[] }[] = [];
  for (const n of days) {
    const name = holidayAt(n)!;
    const g = groups.find((x) => x.name === name);
    if (g) g.days.push(n); else groups.push({ name, days: [n] });
  }
  return groups.map((g) => {
    const month = dateText(toIso(g.days[0])).split(" ")[1];
    return `${g.days.map((n) => parts(n).d).join(", ")} ${month} — ${g.name}`;
  });
}

/** Сетка одного месяца. Можно ставить отдельно — например, годовой обзор из 12 месяцев. */
export function CalendarMonth({ year, month, range, hoverEnd, onHover, onPick, min, max, dayTone, dayDecorator, dir, hideFootnote, rangeStyle = "fill" }: MonthProps) {
  const outline = rangeStyle === "outline";
  const first = dayNum(year, month, 1);
  const lead = parts(first).wd; // 0 — понедельник
  const total = dayNum(year, month + 1, 1) - first;
  const last = first + total - 1;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => first + i)];
  while (cells.length % 7) cells.push(null);
  const rows = cells.length / 7;

  let a = range?.start ? toDay(range.start) : null;
  let b = range?.end ? toDay(range.end) : hoverEnd && a != null ? toDay(hoverEnd) : null;
  if (a != null && b != null && b < a) [a, b] = [b, a];
  const preview = !range?.end && hoverEnd != null;
  const minN = min ? toDay(min) : -Infinity, maxN = max ? toDay(max) : Infinity;
  const monthHolidays = cells.filter((n): n is number => n != null && !!holidayAt(n));
  const decos = cells.map((n) => (n == null ? null : dayDecorator?.(toIso(n)) ?? null));
  const bgs = cells.map((n, i) => {
    if (n == null) return null;
    const t = decos[i]?.tone ?? dayTone?.(toIso(n)) ?? null;
    return decos[i]?.bg ?? (t ? TONE_BG[t] : null);
  });
  const dots = decos.map((d) => d?.dot ?? null);
  // экран может убрать заливку и точку у выделенных дней тем же рендером, что и выделение;
  // тогда показываем прежние «призраки» — они гаснут вместе с появлением капсулы, без пустого кадра
  const sig = bgs.join("|") + "#" + dots.join("|");
  const [paint, setPaint] = useState<{ sig: string; bgs: (string | null)[]; dots: (string | null)[]; prev: { bgs: (string | null)[]; dots: (string | null)[] } | null }>(
    { sig, bgs, dots, prev: null });
  if (paint.sig !== sig) setPaint({ sig, bgs, dots, prev: { bgs: paint.bgs, dots: paint.dots } });

  // геометрия выделения в этом месяце
  const pos = (n: number) => { const i = lead + (n - first); return { r: Math.floor(i / 7), c: i % 7 }; };
  let geom: Geom | null = null;
  if (a != null && (b ?? a) >= first && a <= last) {
    const hi = b ?? a;
    const lo = Math.max(a, first), top = Math.min(hi, last);
    const segs: (Seg | null)[] = Array.from({ length: rows }, () => null);
    if (hi > a) {
      for (let n = lo; n <= top; n++) {
        const { r, c } = pos(n);
        const sg = segs[r];
        segs[r] = sg ? { r, c0: Math.min(sg.c0, c), c1: Math.max(sg.c1, c) } : { r, c0: c, c1: c };
      }
    }
    const liftAt = (n: number) => !!decos[lead + (n - first)]?.lift;
    geom = {
      a, b: hi, segs, preview, outline,
      start: a >= first ? { ...pos(a), lift: liftAt(a) } : null,
      end: hi !== a && hi <= last ? { ...pos(hi), lift: liftAt(hi) } : null,
    };
  }

  const showTip = (el: HTMLElement) => {
    const iso = el.dataset.day!;
    const deco = dayDecorator?.(iso) ?? null;
    dayTip.show(el, <DayTipContent iso={iso} deco={deco} tone={deco?.tone ?? dayTone?.(iso) ?? null}
      outside={toDay(iso) < minN || toDay(iso) > maxN} />);
  };

  return (
    <div className={cx("w-[280px] select-none", dir === "next" && "kit-month-next", dir === "prev" && "kit-month-prev")}>
      <div className="grid grid-cols-7 mb-1">
        {WEEK.map((w, i) => (
          <div key={w} className={cx("h-7 flex items-center justify-center text-[11.5px] font-medium", i >= 5 ? "text-weekend/80" : "text-muted-2")}>{w}</div>
        ))}
      </div>
      {/* подсказка — общий пузырь страницы (DayTip.tsx): наведение и фокус ловятся делегированием, якорь — ячейка */}
      <div
        className="relative grid grid-cols-7 gap-y-1"
        data-range-active={geom && !outline ? "" : undefined}
        onPointerOver={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
          if (el) { onHover?.(el.dataset.day!); showTip(el); }
          else if ((e.target as HTMLElement).closest("[data-empty]")) dayTip.hide();
        }}
        onPointerLeave={() => { onHover?.(null); dayTip.hide(); }}
        onFocus={(e) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]"); if (el) showTip(el); }}
        onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.("[data-day]")) dayTip.hide(); }}
      >
        <RangeLayer geom={geom} rows={rows} />
        {cells.map((n, i) => {
          if (n == null) return <div key={`x${i}`} data-empty className="h-9" />;
          const iso = toIso(n);
          const deco = decos[i];
          const tone = deco?.tone ?? dayTone?.(iso) ?? null;
          const inSpanNow = a != null && n >= a && n <= (b ?? a) && !outline;
          const bg = bgs[i] ?? (inSpanNow ? paint.prev?.bgs[i] ?? null : null);
          const dot = dots[i] ?? (inSpanNow ? paint.prev?.dots[i] ?? null : null);
          const holiday = holidayAt(n);
          const off = !isWorkingDay(iso);
          const disabled = n < minN || n > maxN || !!deco?.disabled;
          const isStart = a != null && n === a, isEnd = b != null && n === b;
          const inSpan = a != null && n >= a && n <= (b ?? a);
          const edge = isStart || isEnd;
          const label = [dateText(iso, true), holiday, deco?.title, tone && tone !== "muted" ? DAY_TONE_LABEL[tone] : null].filter(Boolean).join(", ");
          return (
            // ячейка не перемонтируется (key — номер дня); подкраска и точка — свои слои, в выделении гаснут одним классом сетки
            <div key={n} className="kit-day relative h-9 flex items-center justify-center" data-in-range={inSpan ? "" : undefined}>
              {bg && (
                <span aria-hidden className="kit-day-bg absolute w-9 h-9 rounded-[11px]"
                  style={{ background: bg, ["--bg-op" as string]: deco?.faded ? 0.55 : 1 }} />
              )}
              {/* aria-disabled вместо disabled: у недоступного дня тоже есть подсказка */}
              <button
                type="button"
                data-day={iso}
                aria-disabled={disabled || undefined}
                aria-label={label}
                aria-pressed={edge || undefined}
                onClick={() => { if (!disabled) onPick?.(iso); }}
                className={cx(
                  "kit-day-btn press relative w-9 h-9 rounded-[11px] inline-flex flex-col items-center justify-center text-[14px] tnum",
                  deco?.lift ? "z-[2]" : "z-[1]",
                  disabled ? "cursor-default opacity-30" : deco?.grab ? "cursor-grab" : "cursor-pointer",
                  edge ? cx("font-semibold", outline ? "text-vacation-strong" : "text-white")
                    : cx(off ? "text-weekend" : "text-text", !disabled && !inSpan && "hover:bg-fill-2"),
                  holiday && "font-semibold",
                )}
                style={dayStyle(deco, edge)}
              >
                <span className={cx(holiday && "underline decoration-[1.5px] underline-offset-[3px]")} style={deco?.faded ? { opacity: 0.35 } : undefined}>{parts(n).d}</span>
                {dot && <span className="kit-day-dot absolute bottom-[3px] w-1 h-1 rounded-full" style={{ background: dot }} />}
              </button>
            </div>
          );
        })}
      </div>
      {!hideFootnote && (
        <div className="min-h-5 mt-2 px-1 text-[12px] leading-[1.35] text-muted-2">
          {holidayLines(monthHolidays).map((l) => <div key={l}>{l}</div>)}
        </div>
      )}

    </div>
  );
}

function MonthNav({ year, month, onShift, canPrev, canNext, months = 1 }: {
  year: number; month: number; onShift: (k: number) => void; canPrev: boolean; canNext: boolean; months?: number;
}) {
  const label = (k: number) => { const d = parts(dayNum(year, month + k, 1)); return `${MONTHS[d.m]} ${d.y}`; };
  return (
    <div className="flex items-center gap-1 mb-2">
      <IconButton icon={ChevronLeft} label="Предыдущий месяц" size="sm" disabled={!canPrev} onClick={() => onShift(-1)} />
      <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${months}, 1fr)` }}>
        {Array.from({ length: months }, (_, k) => (
          <div key={k} className="text-center text-[15px] font-semibold tracking-[-0.015em]">{label(k)}</div>
        ))}
      </div>
      <IconButton icon={ChevronRight} label="Следующий месяц" size="sm" disabled={!canNext} onClick={() => onShift(1)} />
    </div>
  );
}

/** Состояние листания: текущий месяц и направление последнего шага (для анимации). */
function useMonthCursor(initial: IsoDate | null | undefined, fallback?: IsoDate) {
  const [cur, setCur] = useState(() => {
    const base = parts(toDay(initial ?? fallback ?? toIso(Math.floor(Date.now() / 86_400_000))));
    return { y: base.y, m: base.m, dir: null as "next" | "prev" | null, key: 0 };
  });
  const shift = (k: number) => setCur((c) => {
    const d = parts(dayNum(c.y, c.m + k, 1));
    return { y: d.y, m: d.m, dir: k > 0 ? "next" : "prev", key: c.key + 1 };
  });
  return { ...cur, shift };
}

const monthKey = (y: number, m: number) => y * 12 + m;

/* ---------------- выбор диапазона ---------------- */

export interface RangeCalendarProps {
  value: DateRange;
  onChange: (r: DateRange) => void;
  min?: IsoDate;
  max?: IsoDate;
  months?: 1 | 2;
  dayTone?: MonthProps["dayTone"];
  dayDecorator?: MonthProps["dayDecorator"];
  /** С какого месяца открыть, если даты не выбраны. */
  defaultMonth?: IsoDate;
  /** fill (по умолчанию) или outline — см. MonthProps.rangeStyle. */
  rangeStyle?: MonthProps["rangeStyle"];
}

/** Календарь диапазона без поповера: первый клик — начало, второй — конец. */
export function RangeCalendar({ value, onChange, min, max, months = 2, dayTone, dayDecorator, defaultMonth, rangeStyle }: RangeCalendarProps) {
  const cur = useMonthCursor(value.start, defaultMonth ?? min);
  const [hover, setHover] = useState<IsoDate | null>(null);
  const pick = (d: IsoDate) => {
    if (!value.start || value.end) onChange({ start: d, end: null });
    else if (d < value.start) onChange({ start: d, end: value.start });
    else onChange({ start: value.start, end: d });
  };
  const minK = min ? monthKey(parts(toDay(min)).y, parts(toDay(min)).m) : -Infinity;
  const maxK = max ? monthKey(parts(toDay(max)).y, parts(toDay(max)).m) : Infinity;
  const k0 = monthKey(cur.y, cur.m);
  return (
    <div>
      <MonthNav year={cur.y} month={cur.m} onShift={cur.shift} canPrev={k0 > minK} canNext={k0 + months - 1 < maxK} months={months} />
      <div key={cur.key} className="flex gap-6">
        {Array.from({ length: months }, (_, k) => {
          const d = parts(dayNum(cur.y, cur.m + k, 1));
          return (
            <CalendarMonth key={k} year={d.y} month={d.m} range={value} hoverEnd={value.start && !value.end ? hover : null}
              onHover={setHover} onPick={pick} min={min} max={max} dayTone={dayTone} dayDecorator={dayDecorator} dir={cur.dir} rangeStyle={rangeStyle} />
          );
        })}
      </div>
    </div>
  );
}

/** Календарь одной даты без поповера. */
export function DateCalendar({ value, onChange, min, max, dayTone, dayDecorator, defaultMonth }: {
  value: IsoDate | null; onChange: (d: IsoDate) => void; min?: IsoDate; max?: IsoDate; defaultMonth?: IsoDate;
  dayTone?: MonthProps["dayTone"]; dayDecorator?: MonthProps["dayDecorator"];
}) {
  const cur = useMonthCursor(value, defaultMonth ?? min);
  const minK = min ? monthKey(parts(toDay(min)).y, parts(toDay(min)).m) : -Infinity;
  const maxK = max ? monthKey(parts(toDay(max)).y, parts(toDay(max)).m) : Infinity;
  const k0 = monthKey(cur.y, cur.m);
  return (
    <div>
      <MonthNav year={cur.y} month={cur.m} onShift={cur.shift} canPrev={k0 > minK} canNext={k0 < maxK} />
      <div key={cur.key}>
        <CalendarMonth year={cur.y} month={cur.m} range={{ start: value, end: value }} onPick={onChange} min={min} max={max}
          dayTone={dayTone} dayDecorator={dayDecorator} dir={cur.dir} />
      </div>
    </div>
  );
}

/** «14 календарных дней, праздники не считаются» — подпись под выбранным диапазоном. */
export function RangeSummary({ start, end }: { start: IsoDate | null; end: IsoDate | null }) {
  if (!start || !end) return <span className="text-muted">{start ? "Выберите последний день" : "Выберите первый день отпуска"}</span>;
  const n = vacationDays(start, end);
  const hol = toDay(end) - toDay(start) + 1 - n;
  return (
    <span>
      <span className="font-semibold text-text tnum">{daysText(n)}</span>
      <span className="text-muted"> календарных{hol === 1 ? ", праздник не считается" : ", праздники не считаются"}</span>
    </span>
  );
}

/* ---------------- поля с поповером ---------------- */

function FieldButton({ children, placeholder, empty, size = "md", disabled, invalid, className, ...rest }: {
  children?: ReactNode; placeholder: string; empty: boolean; size?: "sm" | "md"; disabled?: boolean; invalid?: boolean; className?: string;
} & Record<string, unknown>) {
  const h = size === "sm" ? 30 : 36;
  const r = useControlRadius(h);
  return (
    <button type="button" disabled={disabled} {...rest}
      className={cx("press inline-flex items-center gap-2 bg-fill-2 hover:bg-fill pl-3 pr-3 text-left cursor-pointer disabled:opacity-45 disabled:cursor-default",
        size === "sm" ? "text-[13px]" : "text-[14px]", invalid && "shadow-[0_0_0_1px_var(--bad),0_0_0_4px_rgba(255,59,48,0.16)]", className)}
      style={{ height: h, borderRadius: r }}>
      <CalendarDays size={16} strokeWidth={2} className="text-muted shrink-0" />
      <span className={cx("flex-1 truncate tnum", empty && "text-muted-2")}>{empty ? placeholder : children}</span>
    </button>
  );
}

export interface DatePickerProps {
  value: IsoDate | null;
  onChange: (d: IsoDate) => void;
  min?: IsoDate;
  max?: IsoDate;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  placement?: Placement;
  dayTone?: MonthProps["dayTone"];
  dayDecorator?: MonthProps["dayDecorator"];
}

/** Поле даты: кнопка с датой и календарь в поповере. Закрывается после выбора. */
export function DatePicker({ value, onChange, min, max, placeholder = "Дата", size, disabled, invalid, className, placement, dayTone, dayDecorator }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} placement={placement} pad={14}
      content={<DateCalendar value={value} onChange={(d) => { onChange(d); setOpen(false); }} min={min} max={max} dayTone={dayTone} dayDecorator={dayDecorator} />}>
      <FieldButton placeholder={placeholder} empty={!value} size={size} disabled={disabled} invalid={invalid} className={className}>
        {value && dateText(value, true)}
      </FieldButton>
    </Popover>
  );
}

export interface DateRangePickerProps extends Omit<RangeCalendarProps, "onChange"> {
  onChange: (r: { start: IsoDate; end: IsoDate }) => void;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  placement?: Placement;
  /** Подсказка над кнопками в поповере (например, легенда загрузки). */
  footnote?: ReactNode;
}

/** Поле диапазона: два месяца в поповере, подсветка диапазона, «Готово» применяет. */
export function DateRangePicker({ value, onChange, placeholder = "Даты отпуска", size, disabled, invalid, className, placement = "bottom-start", footnote, ...cal }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const ready = !!draft.start && !!draft.end;
  const label = useMemo(() => (value.start && value.end ? rangeText(value.start, value.end) : null), [value.start, value.end]);
  return (
    <Popover open={open} placement={placement} pad={14}
      onOpenChange={(o) => { setOpen(o); if (o) setDraft(value); }}
      content={
        <div className="flex flex-col gap-3">
          <RangeCalendar {...cal} value={draft} onChange={setDraft} />
          {footnote && <div className="px-1 text-[12px] text-muted">{footnote}</div>}
          <div className="flex items-center gap-3 pt-3 border-t-[0.5px] border-line">
            <div className="flex-1 text-[13px] px-1"><RangeSummary start={draft.start} end={draft.end} /></div>
            <Button size="sm" variant="ghost" onClick={() => setDraft({ start: null, end: null })} disabled={!draft.start}>Сбросить</Button>
            <Button size="sm" variant="primary" disabled={!ready} onClick={() => { onChange({ start: draft.start!, end: draft.end! }); setOpen(false); }}>Готово</Button>
          </div>
        </div>
      }>
      <FieldButton placeholder={placeholder} empty={!label} size={size} disabled={disabled} invalid={invalid} className={className}>
        {label}{label && <span className="text-muted"> · {daysText(vacationDays(value.start!, value.end!))}</span>}
      </FieldButton>
    </Popover>
  );
}

/** Легенда подкраски для экранов: «свободно / одно место / мест нет / ваш отпуск / праздник». */
export function CalendarLegend({ tones = ["free", "one", "full", "own"], holidays = true, className }: {
  tones?: Exclude<DayTone, "muted">[]; holidays?: boolean; className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted", className)}>
      {tones.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-[4px]" style={{ background: TONE_BG[t] }} />{DAY_TONE_LABEL[t]}
        </span>
      ))}
      {holidays && (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-weekend font-semibold underline decoration-[1.5px] underline-offset-2 tnum">8</span>праздник
          <span className="text-weekend tnum ml-2">6</span>выходной
        </span>
      )}
    </div>
  );
}
