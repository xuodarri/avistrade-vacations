"use client";

/**
 * Диаграмма Ганта на kit: слева закреплены люди по уровням иерархии, сверху закреплена шкала
 * (месяцы и дни или недели). Цвет полосы — только статус заявки; конфликт — красная штриховка
 * на днях пересечения и знак «!». Загрузка группы — тонкая тепловая лента в шапке группы.
 * Наведение подсвечивает день во всю высоту и подписывает его в шапке.
 * Данные готовит сервер (`getGanttBoard`), здесь только раскладка по шкале.
 */
import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRightLeft, ChevronDown, ShieldCheck, ShieldQuestion, Undo2 } from "lucide-react";
import { Avatar, Pill, Tooltip, cx } from "@/components/kit";
import { fmtRange } from "@/lib/dates";
import type { BoardEmployee, BoardFinding, BoardPart, GanttBoardData, LoadRow } from "./types";
import { MONTHS, dayNo, isoAt, isoWeek, weekday } from "./time";
import { STAGE_LABEL, STATUS_LABEL, STATUS_STYLE, statusOf } from "./tones";

export const NAME_W = 268;
const ROW = { group: 44, emp: 40 };
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export interface GanttChartProps {
  data: GanttBoardData;
  from: string;
  to: string;
  /** Ширина дня, px: 18 — по дням, 5 — по неделям */
  dw: number;
  visible: (e: BoardEmployee) => boolean;
  collapsed: Set<string>;
  onToggleTier: (key: string) => void;
  selectedPartId: number | null;
  onSelectPart: (id: number) => void;
  /** К какому дню прокрутить шкалу при смене периода */
  focusDate?: string;
  today: string;
  maxHeight?: string;
  /** Кнопка в углу над колонкой имён (свернуть всё) */
  corner?: ReactNode;
  /** Занять всю высоту родителя (прокрутка внутри); иначе — maxHeight */
  fill?: boolean;
}

export function GanttChart(props: GanttChartProps) {
  const { data, from, to, dw: baseDw, visible, collapsed, onToggleTier, selectedPartId, onSelectPart, today } = props;
  const days = dayNo(to, from) + 1;
  // ширина дня тянется под окно, если весь период помещается; иначе — заданная (18 по дням, 5 по неделям)
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dw = boxW ? Math.max(baseDw, Math.floor((boxW - NAME_W) / days)) : baseDw;
  const W = days * dw;
  const x = (iso: string) => dayNo(iso, from) * dw;
  const off = dayNo(from, `${data.year}-01-01`);
  const fine = dw >= 12;
  const holidays = data.holidays.filter((h) => h.date >= from && h.date <= to);
  const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
  const selected = data.parts.find((p) => p.id === selectedPartId) ?? null;
  const partsBy = new Map<string, BoardPart[]>();
  for (const p of data.parts) partsBy.set(p.employeeId, [...(partsBy.get(p.employeeId) ?? []), p]);

  const lane = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = props.focusDate && props.focusDate >= from && props.focusDate <= to ? Math.max(0, x(props.focusDate) - 7 * dw) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, dw]);
  useEffect(() => {
    // выбранная полоса (в том числе стрелками ↑ ↓ из панели) должна быть в кадре
    const el = box.current;
    if (!el || !selected) return;
    const l = x(selected.start), r = x(selected.end) + dw, view = el.clientWidth - NAME_W;
    if (l < el.scrollLeft || r > el.scrollLeft + view) el.scrollTo({ left: Math.max(0, l - 6 * dw), behavior: "smooth" });
    el.querySelector(`[data-part="${selected.id}"]`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartId]);

  const onMove = (e: React.MouseEvent) => {
    const r = lane.current?.getBoundingClientRect();
    if (!r) return;
    const d = Math.floor((e.clientX - r.left) / dw);
    const next = e.clientX - r.left < 0 || d >= days ? null : d;
    if (next !== hover) setHover(next);
  };

  // месяцы и недели в пределах периода
  const months: { label: string; left: number; width: number; summer: boolean }[] = [];
  const weeks: { label: string; left: number; width: number }[] = [];
  for (let i = 0; i < days; i++) {
    const iso = isoAt(from, i);
    if (i === 0 || iso.endsWith("-01")) {
      const m = +iso.slice(5, 7);
      months.push({ label: MONTHS[m - 1], left: i * dw, width: 0, summer: m >= 6 && m <= 8 });
    }
    if (i === 0 || weekday(iso) === 1) weeks.push({ label: String(isoWeek(iso)), left: i * dw, width: 0 });
  }
  months.forEach((m, i) => (m.width = (months[i + 1]?.left ?? W) - m.left));
  weeks.forEach((w, i) => (w.width = (weeks[i + 1]?.left ?? W) - w.left));
  const summerFrom = Math.max(0, x(`${data.year}-06-01`)), summerTo = Math.min(W, x(`${data.year}-08-31`) + dw);
  const showToday = today >= from && today <= to;

  const rows: ReactNode[] = [];
  const groups = ganttGroups(data);
  // якорь тура «Помощь»: первая в порядке строк полоса с конфликтом, видимая в периоде
  const tourBar = groups.filter((g) => !collapsed.has(g.key)).flatMap((g) => g.ids)
    .filter((id) => visible(data.employees[id]))
    .flatMap((id) => partsBy.get(id) ?? [])
    .find((p) => (p.tone === "block" || p.tone === "warn") && p.end >= from && p.start <= to)?.id ?? null;
  for (const g of groups) {
    const ids = g.ids.filter((id) => visible(data.employees[id]));
    if (!ids.length) continue;
    const shut = collapsed.has(g.key);
    rows.push(
      <GroupRow key={`g-${g.key}`} g={g} count={ids.length} open={ids.reduce((s, id) => s + data.employees[id].open, 0)}
        collapsed={shut} onToggle={() => onToggleTier(g.key)} from={from} off={off} days={days} dw={dw} W={W} />,
    );
    if (shut) continue;
    for (const id of ids) {
      const e = data.employees[id];
      const list = partsBy.get(id) ?? [];
      const active = selected?.employeeId === id;
      rows.push(
        <div key={`e-${id}`} className="flex group/row" style={{ height: ROW.emp }}>
          <NameCell e={e} tier={g.tier} active={active} onClick={() => list[0] && onSelectPart(pickPart(list).id)} />
          <div className={cx("relative", active && "bg-accent-bg/40")} style={{ width: W }}>
            {!list.length && <span className="absolute left-3 top-[11px] text-[12px] text-muted-2">План не подан</span>}
            {list.map((p) => <Bar key={p.id} p={p} issues={issuesOf(e, p)} x={x} dw={dw} W={W} selected={p.id === selectedPartId} tour={tourBar === p.id} onClick={() => onSelectPart(p.id)} />)}
          </div>
        </div>,
      );
    }
  }

  const hoverIso = hover !== null ? isoAt(from, hover) : null;
  return (
    <div ref={box} className="overflow-auto relative overscroll-contain" style={props.fill ? { height: "100%" } : { maxHeight: props.maxHeight ?? "calc(100vh - 220px)", minHeight: 380 }}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <div style={{ width: NAME_W + W }}>
        {/* шкала: закреплена сверху */}
        <div className="sticky top-0 z-20 flex glass shadow-[0_0.5px_0_var(--line)]">
          <div className="sticky left-0 z-30 bg-surface flex items-end justify-between gap-2 pl-4 pr-3 pb-1.5 text-[12px] text-muted shadow-[0.5px_0_0_var(--line-soft)]" style={{ width: NAME_W, minWidth: NAME_W }}>
            <span className="pb-1">Сотрудники по уровням</span>
            {props.corner}
          </div>
          <div className="relative" style={{ width: W, height: 54 }}>
            {months.map((m) => (
              <div key={m.left} className="absolute top-0 h-[30px] flex items-center gap-1.5 px-2 whitespace-nowrap overflow-hidden" style={{ left: m.left, width: m.width }}>
                <span className="text-[13px] font-semibold tracking-[-0.01em]">{m.label}</span>
                {m.summer && m.width > 90 && <span className="text-[11px] text-warn">лето</span>}
              </div>
            ))}
            {fine
              ? Array.from({ length: days }, (_, i) => {
                const iso = isoAt(from, i), wd = weekday(iso), h = holidayOf.get(iso);
                return (
                  <div key={iso} className={cx("absolute top-[30px] h-[24px] text-center text-[11px] leading-[24px] tnum",
                    h ? "text-weekend font-semibold underline underline-offset-2" : wd === 0 || wd === 6 ? "text-weekend/70" : "text-muted")}
                    style={{ left: i * dw, width: dw }}>
                    {+iso.slice(8, 10)}
                  </div>
                );
              })
              : weeks.map((w) => (
                <div key={w.left} className="absolute top-[30px] h-[24px] text-[10.5px] leading-[24px] text-muted px-1 whitespace-nowrap overflow-hidden tnum" style={{ left: w.left, width: w.width }}>
                  {w.width >= 34 ? `${w.label} нед.` : w.label}
                </div>
              ))}
            {showToday && (
              <div className="absolute top-[31px] -translate-x-1/2 h-[20px] px-1.5 rounded-full bg-bad text-white text-[10.5px] leading-[20px] font-semibold pointer-events-none" style={{ left: x(today) + dw / 2 }}>Сегодня</div>
            )}
            {hoverIso && (
              <div className="absolute top-[30px] -translate-x-1/2 h-[24px] px-2.5 rounded-full bg-header text-white text-[11.5px] leading-[24px] whitespace-nowrap pointer-events-none z-10 shadow-2"
                style={{ left: (hover ?? 0) * dw + dw / 2 }}>
                {WD[weekday(hoverIso)]}, {+hoverIso.slice(8, 10)} {MON_GEN[+hoverIso.slice(5, 7) - 1]}{holidayOf.get(hoverIso) ? ` — ${holidayOf.get(hoverIso)}` : ""}
              </div>
            )}
          </div>
        </div>

        {/* строки на подложке: лето, выходные, праздники, границы месяцев, сегодня, наведённый день */}
        <div className="relative">
          <div ref={lane} aria-hidden className="absolute top-0 bottom-0 pointer-events-none" style={{ left: NAME_W, width: W }}>
            {summerTo > summerFrom && <div className="absolute inset-y-0" style={{ left: summerFrom, width: summerTo - summerFrom, background: "rgba(255,204,0,.055)" }} />}
            {fine && Array.from({ length: days }, (_, i) => {
              const wd = weekday(isoAt(from, i));
              return wd === 0 || wd === 6 ? <div key={i} className="absolute inset-y-0 bg-fill-3/60" style={{ left: i * dw, width: dw }} /> : null;
            })}
            {holidays.map((h) => <div key={h.date} className="absolute inset-y-0 bg-holiday/60" style={{ left: x(h.date), width: Math.max(dw, 2) }} />)}
            {months.map((m) => <div key={m.left} className="absolute inset-y-0 w-px bg-line-soft" style={{ left: m.left }} />)}
            {hover !== null && <div className="absolute inset-y-0 bg-fill-2" style={{ left: hover * dw, width: dw }} />}
            {showToday && <div className="absolute inset-y-0 w-[1.5px] bg-bad" style={{ left: x(today) + dw / 2 }} />}
          </div>
          {rows.length ? rows : (
            <div className="flex"><div className="sticky left-0 px-5 py-12 text-[14px] text-muted" style={{ width: 640 }}>Под фильтр никто не попал. Сбросьте поиск или выберите другой отдел.</div></div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Группа на Ганте: шапка аккордеона с лимитом и тепловой лентой загрузки, под ней люди. */
export interface GanttGroup {
  key: string;
  tier: string;
  title: string;
  /** Подпись под названием: лимит и круг, например «не больше 2 одновременно» */
  note: string;
  ids: string[];
  load: LoadRow | null;
}

/**
 * Группы по уровням иерархии. Лента загрузки — у группы ограничения: если на уровне одна такая
 * группа (обычный случай), она становится лентой уровня; если несколько — уровень делится по ним.
 */
export function ganttGroups(data: GanttBoardData): GanttGroup[] {
  const out: GanttGroup[] = [];
  const scope = (hint: string) => hint.split(".")[0].trim();
  for (const t of data.tiers) {
    const limited = t.subgroups.filter((sg) => sg.load && sg.load.limit !== null);
    const all = t.subgroups.flatMap((sg) => sg.employeeIds);
    if (limited.length <= 1) {
      const sg = limited[0];
      const load = sg?.load ?? t.subgroups.find((x) => x.load)?.load ?? null;
      const partial = sg && sg.employeeIds.length < all.length;
      out.push({
        key: t.key, tier: t.key, title: t.title, ids: all, load,
        note: sg?.load ? `не больше ${sg.load.limit} одновременно${partial ? `, ${scope(sg.load.hint).toLowerCase()}` : ""}`
          : t.key === "lead" ? "ИД не уходит вместе с заместителями" : "",
      });
      continue;
    }
    for (const sg of limited) out.push({ key: sg.key, tier: t.key, title: t.title, ids: sg.employeeIds, load: sg.load,
      note: `не больше ${sg.load!.limit} одновременно, ${scope(sg.load!.hint).toLowerCase()}` });
    const rest = t.subgroups.filter((sg) => !limited.includes(sg)).flatMap((sg) => sg.employeeIds);
    if (rest.length) out.push({ key: `${t.key}-rest`, tier: t.key, title: t.title, ids: rest, load: null, note: "без лимита" });
  }
  return out;
}

/** Какую часть открыть по клику на имя: сначала с открытым конфликтом. */
export function pickPart(list: BoardPart[]) {
  return list.find((p) => p.tone === "block") ?? list.find((p) => p.tone === "warn") ?? list.find((p) => p.status === "pending") ?? list[0];
}

/** Уровень ленты загрузки: есть отпуск / лимит достигнут / превышен. */
const HEAT = {
  some: { bg: "rgba(60,90,140,.20)", label: "мест хватает" },
  full: { bg: "#F5C04A", label: "лимит достигнут" },
  over: { bg: "#F0473C", label: "лимит превышен" },
} as const;
type Heat = keyof typeof HEAT;
const heatOf = (n: number, level: number, limit: number | null): Heat | null =>
  !n ? null : level === 4 || (limit !== null && n > limit) ? "over" : limit !== null && n === limit ? "full" : "some";

function GroupRow({ g, count, open, collapsed, onToggle, from, off, days, dw, W }: {
  g: GanttGroup; count: number; open: number; collapsed: boolean; onToggle: () => void; from: string; off: number; days: number; dw: number; W: number;
}) {
  const row = g.load;
  const segs: { i: number; len: number; n: number; heat: Heat }[] = [];
  if (row) for (let i = 0; i < days; i++) {
    const n = row.absent[off + i] ?? 0, heat = heatOf(n, row.level[off + i] ?? 0, row.limit);
    const last = segs[segs.length - 1];
    if (heat && last && last.n === n && last.heat === heat && last.i + last.len === i) last.len++;
    else if (heat) segs.push({ i, len: 1, n, heat });
  }
  return (
    <div className="flex" style={{ height: ROW.group }}>
      <button type="button" onClick={onToggle} aria-expanded={!collapsed}
        className="press sticky left-0 z-10 flex items-center gap-2 pl-4 pr-3 bg-surface-alt text-left cursor-pointer hover:bg-fill-3 shadow-[0.5px_0_0_var(--line-soft)]"
        style={{ width: NAME_W, minWidth: NAME_W }}>
        <ChevronDown size={15} strokeWidth={2.25} className={cx("text-muted transition-transform duration-200 shrink-0", collapsed && "-rotate-90")} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold tracking-[-0.01em] truncate">{g.title}</span>
            <span className="text-[12px] text-muted shrink-0">{count}</span>
          </span>
          {g.note && <span className="block text-[11.5px] text-muted truncate mt-0.5">{g.note}</span>}
        </span>
        {open > 0 && <Pill tone="bad" size="sm" dot title={`Открытых конфликтов: ${open}`}>{open}</Pill>}
      </button>
      <div className="relative bg-surface-alt/80" style={{ width: W }}>
        {row && segs.map((s) => {
          const start = isoAt(from, s.i), end = isoAt(from, s.i + s.len - 1), who = row.who[off + s.i] ?? [];
          return (
            <Tooltip key={s.i} content={
              <span className="block max-w-[320px]">
                <span className="font-medium">{fmtRange(start, end)}</span>: в отпуске {s.n}{row.limit !== null ? ` из ${row.limit}` : ""}
                {who.length > 0 && <> — {who.join(", ")}</>}
                {row.limit !== null && <span className="block opacity-75">{HEAT[s.heat].label[0].toUpperCase() + HEAT[s.heat].label.slice(1)}</span>}
              </span>}>
              <span className="absolute top-[18px] h-[8px] rounded-full cursor-default" style={{ left: s.i * dw + 0.5, width: Math.max(s.len * dw - 1, 3), background: HEAT[s.heat].bg }} />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function NameCell({ e, tier, active, onClick }: { e: BoardEmployee; tier: string; active: boolean; onClick: () => void }) {
  const live = e.findings.filter((f) => f.actionable);
  const conflict = live.some((f) => f.level === "block") ? "bg-bad" : live.some((f) => f.level === "warn") ? "bg-warn" : null;
  const sub = tier === "lead" || tier === "sp" ? e.position : e.department ? `${e.department[0].toUpperCase()}${e.department.slice(1)}` : e.division;
  return (
    <button type="button" onClick={onClick}
      className={cx("sticky left-0 z-10 flex items-center gap-3 pl-4 pr-4 text-left cursor-pointer shadow-[0.5px_0_0_var(--line-soft)] transition-colors",
        active ? "bg-accent-bg" : "bg-surface hover:bg-surface-alt")}
      style={{ width: NAME_W, minWidth: NAME_W }}>
      <span className="relative shrink-0">
        <Avatar name={e.fullName} size={28} />
        {conflict && <span title="Есть конфликт" className={cx("absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-surface", conflict)} />}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-medium truncate tracking-[-0.01em]">{e.name}</span>
          {e.benefit && <Pill tone="ok" size="sm" title={`Льгота ч. 4 ст. 168 ТК: ${e.benefit}`}>льгота</Pill>}
        </span>
        <span className="flex gap-2 text-[11.5px] text-muted mt-0.5">
          <span className="truncate">{sub}</span>
          {e.requestStatus && <span className="ml-auto shrink-0 tnum" title="Распределено дней из нормы">{e.totalDays}/{e.normDays}</span>}
        </span>
      </span>
    </button>
  );
}

/** Уровни нарушения по движку: нельзя (норма ТК), нужно исключение (регламент), предупреждение. */
const LEVEL = {
  law: { dot: "bg-bad", label: "Нельзя по ТК" },
  exception: { dot: "bg-warn", label: "Нужно исключение" },
  warning: { dot: "bg-muted-2", label: "Предупреждение" },
} as const;
type Level = keyof typeof LEVEL;
const levelOf = (f: BoardFinding): Level => f.consequence ?? (f.level === "block" ? "exception" : "warning");

/** Открытые нарушения части: свои и на весь план, сначала самые серьёзные. */
function issuesOf(e: BoardEmployee, p: BoardPart): BoardFinding[] {
  const rank: Record<Level, number> = { law: 0, exception: 1, warning: 2 };
  return e.findings.filter((f) => f.actionable && (f.level === "block" || f.level === "warn") && (f.partIds.length === 0 || f.partIds.includes(p.id)))
    .sort((a, b) => rank[levelOf(a)] - rank[levelOf(b)]);
}

/** Короткие названия правил для подсказки: в базе в названии стоит параметр «N». */
const RULE_SHORT: Record<string, string> = {
  R00: "Даты в прошлом", R01: "Лимит группы", R02: "Кто без кого не уходит", R03: "Летом больше нормы",
  R04: "Поздняя заявка", R05: "Нет части от 14 дней", R06: "Больше нормы дней", R07: "Части пересекаются",
  R09: "Первый отпуск рано", R10: "Слишком много частей", R14: "Поздний перенос", R15: "Замещающий",
  R16: "За свой счёт сверх нормы", R17: "Ст. 189 сверх нормы",
};

/** Нарушение человеческим языком: правило, что не так (текст движка без «Часть N:»), кто мешает. */
function issueText(f: BoardFinding) {
  const what = f.message.replace(/^Часть \d+:\s*/, "").replace(/\. Разрешено исключением HR:.*$/, "");
  return `${RULE_SHORT[f.ruleCode] ?? f.title}: ${what}${f.people.length ? ` — ${f.people.join(", ")}` : ""}`;
}

/** Знак у полосы: кружок с иконкой. */
function Mark({ cls, title, children }: { cls: string; title: string; children: ReactNode }) {
  return <span title={title} className={cx("w-[16px] h-[16px] rounded-full text-white flex items-center justify-center shrink-0", cls)}>{children}</span>;
}

function Bar({ p, issues, x, dw, W, selected, tour, onClick }: {
  p: BoardPart; issues: BoardFinding[]; x: (iso: string) => number; dw: number; W: number; selected: boolean; tour?: boolean; onClick: () => void;
}) {
  const l = Math.max(0, x(p.start)), r = Math.min(W, x(p.end) + dw);
  if (r <= l) return null;
  const width = r - l;
  const status = statusOf(p);
  // уровень знака — по самому серьёзному нарушению части; штриховка дней — у «нельзя» и «нужно исключение»
  const top = issues.length ? levelOf(issues[0]) : null;
  const conflict = top === "law" ? "bad" : top === "exception" ? "warn" : null;
  const ch = p.change;
  const gl = ch?.newStart ? Math.max(0, x(ch.newStart)) : 0, gr = ch?.newEnd ? Math.min(W, x(ch.newEnd) + dw) : 0;
  const marks = [
    top && <Mark key="c" cls={LEVEL[top].dot} title={LEVEL[top].label}><span className="text-[10px] font-bold leading-none">!</span></Mark>,
    p.exceptionRequest && <Mark key="x" cls="bg-info" title="Запрос исключения"><ShieldQuestion size={10} strokeWidth={2.5} /></Mark>,
    p.tone === "exception" && <Mark key="e" cls="bg-ok" title="Разрешено исключением РО1"><ShieldCheck size={10} strokeWidth={2.5} /></Mark>,
    ch && <Mark key="m" cls="bg-info" title={changeText(ch)}><ArrowRightLeft size={10} strokeWidth={2.5} /></Mark>,
    status === "returned" && <Mark key="r" cls="bg-muted-2" title="Возвращено сотруднику"><Undo2 size={10} strokeWidth={2.5} /></Mark>,
  ].filter(Boolean);
  const label = width >= 120 + marks.length * 18 ? fmtRange(p.start, p.end) : width >= 48 + marks.length * 18 ? `${p.days} дн.` : "";
  const hatch = conflict === "bad" ? "rgba(224,52,43,.42)" : "rgba(194,106,0,.42)";
  const edge = conflict === "bad" ? "var(--bad)" : "var(--warn)";
  return (
    <>
      {ch && gr > gl && (
        <span aria-hidden className="absolute top-[8px] h-[24px] rounded-full pointer-events-none"
          style={{ left: gl, width: gr - gl, outline: "1.5px dashed var(--info)", outlineOffset: -1.5, background: "rgba(0,122,255,.06)" }} />
      )}
      <Tooltip content={
        <span className="block">
          <span className="font-medium">Часть {p.partNo}: {fmtRange(p.start, p.end)}, {p.days} дн.</span>
          <span className="block opacity-75">{STATUS_LABEL[status]}. {STAGE_LABEL[p.stage]}</span>
          {issues.length > 0 && (
            <span className="flex flex-col gap-1 mt-1.5 max-w-[360px]">
              {issues.slice(0, 3).map((f, i) => (
                <span key={i} className="flex gap-1.5 items-start">
                  <span className={cx("w-2 h-2 rounded-full shrink-0 mt-[5px]", LEVEL[levelOf(f)].dot)} title={LEVEL[levelOf(f)].label} />
                  <span>{issueText(f)}</span>
                </span>
              ))}
              {issues.length > 3 && <span className="opacity-75">Ещё {issues.length - 3}, откройте заявку</span>}
            </span>
          )}
          {p.exceptionRequest && <span className="block opacity-75">Запрос исключения: решает РО1</span>}
          {p.tone === "exception" && <span className="block opacity-75">Разрешено исключением РО1</span>}
          {ch && <span className="block font-medium">{changeText(ch)}</span>}
          {!p.kind.main && <span className="block opacity-75">{p.kind.label}{p.kind.reason ? `: ${p.kind.reason}` : ""}</span>}
          {p.holidays.length > 0 && <span className="block opacity-75">Праздник в отпуск не входит</span>}
        </span>}>
        <button type="button" onClick={onClick} data-part={p.id} data-tour={tour ? "hr.bar" : undefined}
          className={cx("press absolute top-[8px] h-[24px] rounded-full overflow-hidden text-left cursor-pointer hover:brightness-[0.97]", selected && "z-[2]")}
          style={{ left: l, width, ...STATUS_STYLE[status],
            ...(conflict && !p.hot.length ? { boxShadow: `inset 0 0 0 1.5px var(--${conflict})` } : {}),
            ...(selected ? { boxShadow: "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" } : {}) }}>
          {conflict && p.hot.map((h, i) => (
            <span key={i} className="absolute inset-y-0" title="Дни конфликта"
              style={{ left: Math.max(0, x(h.start) - l), width: (dayNo(h.end, h.start) + 1) * dw,
                background: `repeating-linear-gradient(135deg, ${hatch} 0 2.5px, transparent 2.5px 6px)`, boxShadow: `inset 0 0 0 1.5px ${edge}` }} />
          ))}
          {p.holidays.map((h) => <span key={h} className="absolute inset-y-0 bg-white/60" style={{ left: x(h) - l, width: dw }} />)}
          {label && <span className="relative block px-2.5 text-[12px] font-medium leading-[24px] whitespace-nowrap tnum">{label}</span>}
          {marks.length > 0 && <span className="absolute right-1 top-1 flex gap-0.5">{marks}</span>}
        </button>
      </Tooltip>
    </>
  );
}

/** «Перенос на согласовании у РО1: 12–26 июля». */
export function changeText(c: NonNullable<BoardPart["change"]>) {
  const where = c.stage === "manager" ? "у руководителя" : "у РО1";
  if (c.kind === "cancel") return `Отказ от части на согласовании ${where}`;
  return `${c.kindLabel} на согласовании ${where}: ${c.newStart && c.newEnd ? fmtRange(c.newStart, c.newEnd) : ""}`;
}

/** Легенда в одну строку над Гантом: цвет — статус, знаки — конфликт и заявки, лента — загрузка. */
/** Легенда; column — в две колонки для поповера. */
export function Legend({ column }: { column?: boolean } = {}) {
  const sw = (s: CSSProperties) => <span className="inline-block w-6 h-3 rounded-full shrink-0" style={s} />;
  return (
    <div className={column ? "grid grid-cols-2 gap-x-5 gap-y-2.5 text-[12.5px] text-text-2" : "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted"}>
      <span className="flex items-center gap-1.5">{sw(STATUS_STYLE.approved)}Согласовано</span>
      <span className="flex items-center gap-1.5">{sw(STATUS_STYLE.pending)}На согласовании</span>
      <span className="flex items-center gap-1.5">{sw(STATUS_STYLE.draft)}Черновик</span>
      <span className="flex items-center gap-1.5">
        {sw({ ...STATUS_STYLE.pending, backgroundImage: "repeating-linear-gradient(135deg, rgba(224,52,43,.42) 0 2.5px, transparent 2.5px 6px)", boxShadow: "inset 0 0 0 1.5px var(--bad)" })}
        дни
      </span>
      {(Object.keys(LEVEL) as Level[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5"><Mark cls={LEVEL[k].dot} title={LEVEL[k].label}><span className="text-[10px] font-bold leading-none">!</span></Mark>{LEVEL[k].label}</span>
      ))}
      <span className="flex items-center gap-1.5"><Mark cls="bg-info" title="Запрос исключения"><ShieldQuestion size={10} strokeWidth={2.5} /></Mark>запрос исключения</span>
      <span className="flex items-center gap-1.5">{sw({ outline: "1.5px dashed var(--info)", outlineOffset: -1.5, background: "rgba(0,122,255,.06)" })}перенос</span>
      {!column && <span className="w-px h-4 bg-line" />}
      <span className={cx("flex items-center gap-1.5", column && "col-span-2 flex-wrap")}>Загрузка
        <span className="inline-block w-4 h-2 rounded-full" style={{ background: HEAT.some.bg }} />места есть
        <span className="inline-block w-4 h-2 rounded-full ml-0.5" style={{ background: HEAT.full.bg }} />лимит
        <span className="inline-block w-4 h-2 rounded-full ml-0.5" style={{ background: HEAT.over.bg }} />превышен
      </span>
    </div>
  );
}
