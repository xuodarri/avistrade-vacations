"use client";

/**
 * График HR на всю ширину и высоту окна: сверху компактная панель (заголовок, статус графика,
 * счётчики-фильтры, заявки на изменение поверх Ганта), под ней Гант со своей прокруткой,
 * ниже — карточки сводки. Разбор заявки — в Sheet справа, ↑ ↓ листают заявки.
 * readOnly — тот же Гант для утверждающего график: без решений по заявкам.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, ArrowRightLeft, ChevronsDownUp, ChevronsUpDown, CircleHelp, Info, Search, SlidersHorizontal, X } from "lucide-react";
import { Avatar, Badge, Button, Card, Field, IconButton, Input, Pill, Popover, SegmentedControl, Select, Surface, Switch, cx, type SelectOption } from "@/components/kit";
import { fmtRange } from "@/lib/dates";
import { GanttChart, Legend, ganttGroups } from "@/components/gantt/GanttChart";
import { periodsOf } from "@/components/gantt/time";
import type { BoardEmployee, BoardPart, GanttBoardData } from "@/components/gantt/types";
import { RequestSheet } from "./RequestSheet";

type Focus = "conflicts" | "requests" | "hr" | "manager" | "exception" | "approved";
const conflicted = (p: BoardPart) => p.tone === "block" || p.tone === "warn";
const SHORT: Record<string, string> = { "may-oct": "Май — окт", h1: "I пол.", h2: "II пол.", summer: "Лето", year: "Год" };
/** Зазор от низа окна и по бокам */
const GAP = 16, SIDE = 24;

/**
 * Блок ровно в окно: высота и ширина меряются от реального положения (шапка, отступы main, полоса
 * прокрутки), нижний отступ main забирается отрицательным полем. Прокрутка страницы на время
 * показа выключена на body (html занят блокировкой у Dialog), прокручивается только Гант.
 */
function useFitWindow() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const el = ref.current, main = el?.parentElement;
    if (!el || !main) return;
    const fit = () => {
      const d = document.documentElement, ms = getComputedStyle(main);
      const top = el.getBoundingClientRect().top + window.scrollY;
      const left = main.getBoundingClientRect().left + parseFloat(ms.paddingLeft);
      setBox({
        width: d.clientWidth - SIDE * 2, marginLeft: SIDE - left,
        height: Math.max(320, Math.floor(window.innerHeight - top - GAP)),
        marginBottom: GAP - parseFloat(ms.paddingBottom),
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(document.documentElement);
    const header = document.querySelector("header");
    if (header) ro.observe(header);
    window.addEventListener("resize", fit);
    const body = document.body.style, prev = body.overflow;
    body.overflow = "hidden";
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); body.overflow = prev; };
  }, []);
  return { ref, box };
}

export function HrGantt({ data, today, readOnly, actions, title }: {
  data: GanttBoardData; today: string; readOnly?: boolean; actions?: ReactNode; title?: string;
}) {
  const periods = useMemo(() => periodsOf(data.year), [data.year]);
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const [scale, setScale] = useState<"day" | "week">("day");
  const [unit, setUnit] = useState("all");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const partsBy = useMemo(() => {
    const m = new Map<string, BoardPart[]>();
    for (const p of data.parts) m.set(p.employeeId, [...(m.get(p.employeeId) ?? []), p]);
    return m;
  }, [data.parts]);

  const unitOptions = useMemo<SelectOption[]>(() => {
    const map = new Map<string, Set<string>>();
    for (const e of Object.values(data.employees)) {
      if (!map.has(e.division)) map.set(e.division, new Set());
      if (e.department) map.get(e.division)!.add(e.department);
    }
    const out: SelectOption[] = [{ value: "all", label: "Вся компания", description: `${Object.keys(data.employees).length} человек` }];
    for (const [d, deps] of [...map].sort((a, b) => a[0].localeCompare(b[0], "ru"))) {
      out.push({ value: d, label: `${d} целиком`, group: d });
      for (const dep of [...deps].sort()) out.push({ value: `${d}|${dep}`, label: dep[0].toUpperCase() + dep.slice(1), group: d });
    }
    return out;
  }, [data.employees]);

  const matchFocus = useCallback((e: BoardEmployee) => {
    const list = partsBy.get(e.id) ?? [];
    switch (focus) {
      case "conflicts": return e.open > 0;
      case "requests": return list.some((p) => p.exceptionRequest);
      case "hr": return list.some((p) => (p.status === "pending" && (p.stage === "hr" || conflicted(p))) || p.change?.stage === "hr");
      case "manager": return list.some((p) => p.status === "pending" && p.stage === "manager" && !conflicted(p));
      case "exception": return e.findings.some((f) => f.level === "exception" && f.actionable);
      case "approved": return list.some((p) => p.status === "approved");
      default: return true;
    }
  }, [focus, partsBy]);

  const visible = useCallback((e: BoardEmployee) => {
    if (!matchFocus(e)) return false;
    const q = query.trim().toLowerCase();
    if (q && !e.fullName.toLowerCase().includes(q)) return false;
    if (unit === "all") return true;
    const [division, department] = unit.split("|");
    return e.division === division && (!department || e.department === department);
  }, [matchFocus, query, unit]);

  // порядок заявок для ↑ ↓: как строки на графике, внутри человека — по датам
  const groups = useMemo(() => ganttGroups(data), [data]);
  const order = useMemo(() => groups.filter((g) => !collapsed.has(g.key))
    .flatMap((g) => g.ids)
    .filter((id) => visible(data.employees[id]))
    .flatMap((id) => [...(partsBy.get(id) ?? [])].sort((a, b) => a.start.localeCompare(b.start)).map((p) => p.id)), [groups, collapsed, visible, partsBy, data.employees]);

  const step = useCallback((d: 1 | -1) => setSelectedPartId((cur) => {
    if (cur === null || !order.length) return cur;
    const i = order.indexOf(cur);
    return order[(i < 0 ? 0 : i + d + order.length) % order.length];
  }), [order]);

  const focusDate = data.parts.filter((p) => conflicted(p) && p.end >= period.from && p.start <= period.to)
    .map((p) => (p.start < period.from ? period.from : p.start)).sort()[0];
  const s = data.summary;
  const toggle = (f: Focus) => setFocus((cur) => (cur === f ? null : f));
  const allShut = groups.every((g) => collapsed.has(g.key));
  const changesCount = data.parts.filter((p) => p.change).length;
  const { ref: fitRef, box: fitBox } = useFitWindow();

  // фильтры, отличные от умолчания: пилюлями под строкой, число — на кнопке «Фильтры»
  const unitLabel = unitOptions.find((o) => o.value === unit)?.label;
  const chips: { key: string; text: string; reset: () => void }[] = [
    ...(periodKey !== periods[0].key ? [{ key: "period", text: `Период: ${period.label}`, reset: () => setPeriodKey(periods[0].key) }] : []),
    ...(scale !== "day" ? [{ key: "scale", text: "Масштаб: недели", reset: () => setScale("day") }] : []),
    ...(unit !== "all" ? [{ key: "unit", text: `Отдел: ${unitLabel}`, reset: () => setUnit("all") }] : []),
    ...(focus ? [{ key: "focus", text: `Показаны: ${FOCUS_TEXT[focus]}`, reset: () => setFocus(null) }] : []),
  ];
  const filterCount = chips.filter((c) => c.key !== "focus").length + (focus === "conflicts" ? 1 : 0);
  const resetAll = () => { setPeriodKey(periods[0].key); setScale("day"); setUnit("all"); setFocus(null); };

  return (
    // Гант — во всю ширину окна: выходим из контейнера main (max-w) с отступом 24 по краям.
    // До замера (первый кадр с сервера) — через calc от высоты шапки: + pt-8 main + зазор снизу
    <div ref={fitRef} className="flex flex-col gap-3" style={fitBox ?? { width: "calc(100vw - 48px)", marginLeft: "calc(50% - 50vw + 24px)",
      height: "calc(100dvh - var(--header-h) - 48px)", marginBottom: -48 }}>
      <Card pad={0} className="overflow-hidden flex flex-col flex-1 min-h-0">
        <div data-tour="hr.filters" className="flex flex-wrap items-center gap-2 px-4 py-3">
          <h1 className="text-[20px] font-semibold tracking-[-0.025em] mr-1 whitespace-nowrap">{title ?? `График отпусков ${data.year}`}</h1>
          {schedulePills(data.schedule.halves).map(({ h, both }) => <SchedulePill key={h.half} h={h} both={both} approver={data.schedule.approver} />)}
          {data.notices.length > 0 && <TkNote notices={data.notices} />}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Input size="sm" icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фамилия" className="w-[150px]" aria-label="Поиск по фамилии" />
            <FiltersButton count={filterCount} onReset={resetAll}>
              <Field label="Период">
                <SegmentedControl size="sm" block aria-label="Период" value={periodKey} onChange={setPeriodKey}
                  options={periods.map((p) => ({ value: p.key, label: SHORT[p.key] ?? p.label }))} />
              </Field>
              <Field label="Масштаб">
                <SegmentedControl size="sm" block aria-label="Масштаб" value={scale} onChange={setScale}
                  options={[{ value: "day", label: "Дни" }, { value: "week", label: "Недели" }]} />
              </Field>
              <Field label="Отдел">
                <Select size="sm" options={unitOptions} value={unit} onChange={setUnit} menuWidth={300} header="Отделение или отдел" />
              </Field>
              <Switch checked={focus === "conflicts"} onChange={(v) => setFocus(v ? "conflicts" : null)} label="Только конфликты" />
            </FiltersButton>
            <Popover width={460} placement="bottom-end" content={<Legend column />}>
              <IconButton icon={CircleHelp} label="Легенда" size="sm" />
            </Popover>
            <span className="w-px h-5 bg-line mx-0.5" />
            <Counter on={focus === "conflicts"} onClick={() => toggle("conflicts")} tone="bad" label="Конфликты" n={s.open} />
            <Counter on={focus === "requests"} onClick={() => toggle("requests")} tone="info" label="Исключения" n={s.exceptionRequests} />
            {!readOnly && <Counter on={focus === "hr"} onClick={() => toggle("hr")} tone="warn" label="Ждут РО1" n={s.waitingHr + s.changesHr} />}
            {!readOnly && changesCount > 0 && <ChangesButton data={data} count={changesCount} onOpen={setSelectedPartId} />}
            {actions}
          </div>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 -mt-1 pb-2.5">
            {chips.map((c) => (
              <button key={c.key} type="button" onClick={c.reset} aria-label={`Сбросить: ${c.text}`}
                className="press h-6 pl-2.5 pr-1.5 rounded-full bg-fill-2 text-[12px] text-text-2 inline-flex items-center gap-1 cursor-pointer hover:bg-fill-1">
                {c.text}<X size={13} className="text-muted" />
              </button>
            ))}
            {chips.length > 1 && <Button size="sm" variant="ghost" onClick={resetAll}>Сбросить всё</Button>}
          </div>
        )}

        <div data-tour="hr.gantt" className="flex-1 min-h-0 shadow-[0_-0.5px_0_var(--line)]">
          <GanttChart fill
            data={data} from={period.from} to={period.to} dw={scale === "day" ? 18 : 5} visible={visible} collapsed={collapsed}
            onToggleTier={(k) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
            selectedPartId={selectedPartId} onSelectPart={readOnly ? () => {} : setSelectedPartId} focusDate={focusDate} today={today}
            corner={<IconButton icon={allShut ? ChevronsUpDown : ChevronsDownUp} label={allShut ? "Развернуть все группы" : "Свернуть все группы"} size="sm"
              onClick={() => setCollapsed(allShut ? new Set() : new Set(groups.map((g) => g.key)))} />}
          />
        </div>
      </Card>

      <div data-tour="hr.stats" className="shrink-0 grid grid-cols-6 gap-3 overflow-x-auto">
        <StatCard on={focus === "conflicts"} onClick={() => toggle("conflicts")} label="Открытых конфликтов" value={s.open} tone="bad"
          hint={`${s.blocks} серьёзных, ${s.warns} ${plural(s.warns, "предупреждение", "предупреждения", "предупреждений")}`} />
        <StatCard on={focus === "requests"} onClick={() => toggle("requests")} label="Запросы исключений" value={s.exceptionRequests} tone="info" hint="сотрудник объяснил, почему эти даты" />
        <StatCard on={focus === "hr"} onClick={() => toggle("hr")} label={`Ждут решения РО1`} value={s.waitingHr + s.changesHr} tone="warn"
          hint={`${data.ro1}${s.changesHr ? `, переносов: ${s.changesHr}` : ", после руководителя"}`} />
        <StatCard on={focus === "manager"} onClick={() => toggle("manager")} label="У руководителей" value={s.atManager} hint="ещё не согласовали" />
        <StatCard on={focus === "exception"} onClick={() => toggle("exception")} label="Исключения РО1" value={s.resolved} hint="с причиной в журнале" />
        <StatCard on={focus === "approved"} onClick={() => toggle("approved")} label="Согласовано" tone="ok"
          value={<>{s.approved}<span className="text-[14px] text-muted font-medium"> из {s.parts}</span></>} hint="частей отпуска в графике" />
      </div>

      {!readOnly && (
        <RequestSheet data={data} partId={selectedPartId} onClose={() => setSelectedPartId(null)} onSelect={setSelectedPartId} onStep={step}
          position={selectedPartId !== null && order.includes(selectedPartId) ? `${order.indexOf(selectedPartId) + 1} из ${order.length}` : undefined} />
      )}
    </div>
  );
}

const FOCUS_TEXT: Record<Focus, string> = {
  conflicts: "сотрудники с открытым конфликтом",
  requests: "заявки с запросом исключения",
  hr: "заявки, которые ждут решения РО1",
  manager: "заявки у руководителей",
  exception: "конфликты, разрешённые исключением",
  approved: "сотрудники с согласованными частями",
};

/**
 * «Фильтры» с числом активных: поповер с периодом, масштабом, отделом и «Только конфликты».
 * Список отделов (Select) открывается в своём портале, и клик по нему Popover счёл бы кликом
 * снаружи — такое закрытие пропускаем.
 */
function FiltersButton({ count, onReset, children }: { count: number; onReset: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const inList = useRef(false);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { inList.current = !!(e.target as Element).closest?.('[role="listbox"]'); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);
  return (
    <Popover width={384} placement="bottom-end" open={open} onOpenChange={(o) => { if (!o && inList.current) { inList.current = false; return; } setOpen(o); }}
      content={(
        <div className="flex flex-col gap-3.5">
          {children}
          <div className="flex justify-end -mx-4 px-4 pt-3 -mb-1 shadow-[0_-0.5px_0_var(--line)]">
            <Button size="sm" variant="ghost" disabled={!count} onClick={onReset}>Сбросить</Button>
          </div>
        </div>
      )}>
      <Button size="sm" icon={SlidersHorizontal}>Фильтры{count > 0 && <Badge tone="accent">{count}</Badge>}</Button>
    </Popover>
  );
}

/** Счётчик-фильтр в панели: «Конфликты 16». Главное видно, не прокручивая к сводке. */
function Counter({ label, n, tone, on, onClick }: { label: string; n: number; tone: "bad" | "warn" | "info"; on: boolean; onClick: () => void }) {
  const cls = { bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", info: "bg-info-bg text-info" }[tone];
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cx("press h-7 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer tnum", cls,
        on && "shadow-[0_0_0_2px_var(--accent)]")}>
      {label}<span className="font-semibold">{n}</span>
    </button>
  );
}

/** Статус графика: сбор, на утверждении у кого, возвращён, утверждён — дата. */
type Half = GanttBoardData["schedule"]["halves"][number];
/** Одинаковый статус у обоих полугодий — одна пилюля «I–II пол.», чтобы строка уместилась. */
function schedulePills(halves: Half[]): { h: Half; both: boolean }[] {
  const [a, b] = halves;
  if (a && b && a.status === b.status && a.decidedAt?.slice(0, 10) === b.decidedAt?.slice(0, 10)) return [{ h: a, both: true }];
  return halves.map((h) => ({ h, both: false }));
}

function SchedulePill({ h, both, approver }: { h: Half; both: boolean; approver: string }) {
  const date = h.decidedAt ? new Date(h.decidedAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Minsk" }) : "";
  const half = both ? "I–II пол." : h.half === 1 ? "I пол." : "II пол.";
  if (h.status === "approved") return <Pill tone="ok" dot>{half}: утверждён {date}</Pill>;
  if (h.status === "pending") return <Pill tone="warn" dot>{half}: на утверждении у {approver}</Pill>;
  if (h.status === "returned") return <Pill tone="bad" dot title={h.comment ?? undefined}>{half}: возвращён{h.decidedBy ? ` (${h.decidedBy})` : ""}</Pill>;
  return <Pill tone="neutral" dot>{half}: {h.statusLabel.toLowerCase()}</Pill>;
}

/** Расхождение регламента с ТК по сроку графика — значок с поповером вместо строки на всю ширину. */
function TkNote({ notices }: { notices: string[] }) {
  return (
    <Popover width={420} content={
      <div>
        <div className="text-[14px] font-semibold mb-1">Срок утверждения графика: регламент расходится с ТК</div>
        <div className="text-[13px] text-muted">{notices.join(" ")}</div>
      </div>}>
      <button type="button" className="press h-7 px-2.5 rounded-full bg-info-bg text-info text-[12.5px] font-medium inline-flex items-center gap-1 cursor-pointer" title="Регламент расходится с ТК">
        <Info size={14} />ТК
      </button>
    </Popover>
  );
}

/** «Заявки на изменение» поверх Ганта: список в поповере, клик открывает заявку и прокручивает Гант к полосе. */
function ChangesButton({ data, count, onOpen }: { data: GanttBoardData; count: number; onOpen: (partId: number) => void }) {
  const list = data.parts.filter((p) => p.change).sort((a, b) => Number(b.change!.stage === "hr") - Number(a.change!.stage === "hr") || a.start.localeCompare(b.start));
  return (
    <Popover width={540} placement="bottom-end" pad={8} content={(close) => (
      <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
        <div className="px-2 pt-1 pb-1.5 text-[12.5px] text-muted">Согласованные отпуска: перенос, сокращение, отказ</div>
        {list.map((p) => {
          const c = p.change!, e = data.employees[p.employeeId];
          return (
            <Surface key={c.id} nested pad={0} tone="flat">
              <button type="button" onClick={() => { close(); onOpen(p.id); }} className="press r-in w-full flex items-center gap-2.5 px-2.5 py-2 text-left cursor-pointer hover:bg-fill-3">
                <Avatar name={e.fullName} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-medium truncate">{e.name}</span>
                    <Pill tone="info" size="sm" icon={ArrowRightLeft}>{c.kindLabel}</Pill>
                  </span>
                  <span className="block text-[12.5px] tnum">
                    <span className="text-muted line-through decoration-muted-2/60">{fmtRange(c.oldStart, c.oldEnd)}</span>
                    {c.kind === "cancel" ? <span className="text-bad"> отказ</span> : c.newStart && c.newEnd ? <> <ArrowRight size={12} className="inline text-muted-2 -mt-0.5" /> <span className="font-medium">{fmtRange(c.newStart, c.newEnd)}</span></> : null}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0">
                  <Pill tone={c.stage === "hr" ? "accent" : "neutral"} size="sm">{c.stage === "hr" ? "ждёт РО1" : "у руководителя"}</Pill>
                  {c.law ? <Pill tone="bad" size="sm" dot>нельзя по ТК</Pill>
                    : c.needsException ? <Pill tone="warn" size="sm" dot>{c.findings.some((f) => f.ruleCode === "R14") ? "поздний" : "нужно исключение"}</Pill> : null}
                </span>
              </button>
            </Surface>
          );
        })}
      </div>
    )}>
      <Button size="sm" icon={ArrowRightLeft}>Заявки на изменение <Badge tone="accent">{count}</Badge></Button>
    </Popover>
  );
}

/** Компактная карточка сводки внизу (около 64 px): цифра и подпись в строку, клик — фильтр. */
function StatCard({ label, value, hint, tone, on, onClick }: {
  label: string; value: ReactNode; hint: string; tone?: "ok" | "warn" | "bad" | "info"; on: boolean; onClick: () => void;
}) {
  const color = tone ? { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" }[tone] : "text-text";
  return (
    <Surface level="block" pad={0} tone="raised" className="transition-shadow hover:shadow-2 min-w-[180px]"
      style={on ? { boxShadow: "0 0 0 2px var(--accent), var(--shadow-2)" } : undefined}>
      <button type="button" aria-pressed={on} onClick={onClick} title={hint} className="press r-in w-full h-full px-4 py-2.5 text-left cursor-pointer flex items-center gap-3">
        <span className={cx("text-[24px] leading-none font-semibold tracking-[-0.03em] tnum whitespace-nowrap", color)}>{value}</span>
        <span className="min-w-0 leading-tight">
          <span className="block text-[12.5px] text-text-2 truncate">{label}</span>
          <span className="block text-[11.5px] text-muted-2 truncate">{hint}</span>
        </span>
      </button>
    </Surface>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}
