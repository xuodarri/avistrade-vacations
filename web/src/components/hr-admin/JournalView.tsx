"use client";

/**
 * Журнал HR: лента событий по дням и вкладка исключений. Фильтры — поиск, сотрудник, период,
 * типы событий пилюлями; «было → стало» — пилюлями.
 */
import { useMemo, useState } from "react";
import {
  Bell, CalendarClock, CircleCheck, FileCheck, FilePen, LogIn, Search, Send, ShieldCheck, SlidersHorizontal, Undo2, Users, X, type LucideIcon,
} from "lucide-react";
import {
  Avatar, Badge, Button, Card, DateRangePicker, EmptyState, IconButton, Input, PageHeader, Pill, Select, Surface, Tabs, cx,
  type DateRange,
} from "@/components/kit";
import { plural, shortName, type FieldChange } from "./meta";
import { DiffLine } from "./DiffLine";

type LogKind = "plan" | "submit" | "approve" | "return" | "change" | "exception" | "rule" | "people" | "schedule" | "remind" | "other";

interface Row {
  id: number; at: string; kind: LogKind; actorId: string | null; actorName: string;
  subjectId: string | null; subjectName: string | null; summary: string; changes: FieldChange[];
  exception?: { ruleCode: string; ruleTitle: string; reason: string; decision: "allow" | "return"; approvedBy: string; part: string | null };
}
interface ExceptionEntry {
  id: number; at: string; employeeId: string; employeeName: string; active: boolean;
  ruleCode: string; ruleTitle: string; reason: string; decision: "allow" | "return"; approvedBy: string; part: string | null;
}

const KIND: Record<LogKind, { label: string; icon: LucideIcon; tone: string }> = {
  plan: { label: "Планы", icon: FilePen, tone: "bg-fill text-text-2" },
  submit: { label: "Отправки", icon: Send, tone: "bg-warn-bg text-warn" },
  approve: { label: "Согласования", icon: CircleCheck, tone: "bg-ok-bg text-ok" },
  return: { label: "Возвраты", icon: Undo2, tone: "bg-bad-bg text-bad" },
  change: { label: "Переносы", icon: CalendarClock, tone: "bg-vacation-bg text-vacation-strong" },
  exception: { label: "Исключения", icon: ShieldCheck, tone: "bg-info-bg text-info" },
  rule: { label: "Правила", icon: SlidersHorizontal, tone: "bg-accent-bg text-accent-strong" },
  people: { label: "Сотрудники", icon: Users, tone: "bg-fill text-text-2" },
  schedule: { label: "Утверждение графика", icon: FileCheck, tone: "bg-ok-bg text-ok" },
  remind: { label: "Напоминания", icon: Bell, tone: "bg-fill text-text-2" },
  other: { label: "Вход и система", icon: LogIn, tone: "bg-fill text-muted" },
};
const ORDER: LogKind[] = ["plan", "submit", "approve", "return", "change", "exception", "rule", "people", "schedule", "remind", "other"];
const DEFAULT_KINDS = ORDER.filter((k) => k !== "other");

const TZ = "Europe/Minsk";
const dayKey = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const dayTitle = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long", weekday: "long" }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dateShort = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long" }).format(new Date(iso));

export function JournalView({ rows, exceptions, people, initialKind }: {
  rows: Row[]; exceptions: ExceptionEntry[]; people: { id: string; name: string; position: string }[]; initialKind?: string;
}) {
  const [tab, setTab] = useState<"events" | "exceptions">(initialKind === "exception" ? "exceptions" : "events");
  const [kinds, setKinds] = useState<Set<LogKind>>(() =>
    new Set(ORDER.includes(initialKind as LogKind) && initialKind !== "exception" ? [initialKind as LogKind] : DEFAULT_KINDS));
  const [person, setPerson] = useState<string>("");
  const [period, setPeriod] = useState<DateRange>({ start: null, end: null });
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<LogKind, number>;
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);

  const query = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (!kinds.has(r.kind)) return false;
    if (person && r.actorId !== person && r.subjectId !== person) return false;
    const d = dayKey(r.at);
    if (period.start && d < period.start) return false;
    if (period.end && d > period.end) return false;
    if (query) {
      const text = [r.summary, r.actorName, r.subjectName, r.exception?.reason, r.exception?.ruleTitle,
        ...r.changes.flatMap((c) => [c.label, c.before, c.after])].join(" ").toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
  const days: [string, Row[]][] = [];
  for (const r of shown) {
    const k = dayKey(r.at);
    if (days.at(-1)?.[0] !== k) days.push([k, []]);
    days.at(-1)![1].push(r);
  }

  const toggle = (k: LogKind) => setKinds((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n.size ? n : new Set([k]);
  });
  const filtered = !!person || !!period.start || !!query || kinds.size !== DEFAULT_KINDS.length || kinds.has("other");
  const reset = () => { setKinds(new Set(DEFAULT_KINDS)); setPerson(""); setPeriod({ start: null, end: null }); setQ(""); };
  const personOpts = [
    { value: "", label: "Все сотрудники" },
    ...people.map((p) => ({ value: p.id, label: p.name, description: p.position, leading: <Avatar name={p.name} size={24} /> })),
  ];
  const shownExceptions = exceptions.filter((x) => !person || x.employeeId === person);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Журнал" subtitle="Каждое действие с планами и правилами: кто, когда, что было и что стало. Записи не правятся и не удаляются." />

      {/* data-tour — якоря тура «Помощь» (src/components/tour/steps.ts) */}
      <div data-tour="log.tabs" className="self-start">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: "events", label: "События", count: rows.length },
          { value: "exceptions", label: "Исключения РО1", count: exceptions.length },
        ]} />
      </div>

      <div data-tour="log.filters" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tab === "events" && (
            <Input icon={Search} placeholder="Поиск: имя, правило, комментарий" value={q} onChange={(e) => setQ(e.target.value)}
              className="w-[300px]" trailing={q ? <IconButton icon={X} label="Очистить поиск" size="sm" onClick={() => setQ("")} /> : undefined} />
          )}
          <div className="w-[280px]"><Select value={person} onChange={setPerson} options={personOpts} searchable placeholder="Все сотрудники" /></div>
          {tab === "events" && (
            <>
              <DateRangePicker value={period} onChange={setPeriod} months={1} placeholder="За всё время" />
              {period.start && <IconButton icon={X} label="Сбросить период" size="sm" variant="secondary" onClick={() => setPeriod({ start: null, end: null })} />}
            </>
          )}
          {filtered && <Button variant="ghost" size="sm" onClick={reset}>Сбросить фильтры</Button>}
          {tab === "events" && (
            <span className="ml-auto text-[13px] text-muted tnum">{shown.length} {plural(shown.length, ["событие", "события", "событий"])} из {rows.length}</span>
          )}
        </div>
        {tab === "events" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Типы событий">
            {ORDER.map((k) => {
              const on = kinds.has(k);
              const Icon = KIND[k].icon;
              return (
                <Button key={k} size="sm" pill variant={on ? "tinted" : "secondary"} aria-pressed={on} onClick={() => toggle(k)}
                  className={cx(!on && "text-muted")}>
                  <Icon size={14} strokeWidth={2} />{KIND[k].label}
                  <Badge tone={on ? "accent" : "neutral"}>{counts[k]}</Badge>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {tab === "events" ? (
        days.length === 0 ? (
          <Card><EmptyState icon={Search} title="Ничего не нашлось" description="Попробуйте убрать часть фильтров." action={<Button variant="tinted" size="sm" onClick={reset}>Сбросить фильтры</Button>} /></Card>
        ) : (
          <div data-tour="log.list" className="flex flex-col gap-6">
            {days.map(([d, list]) => (
              <section key={d} className="flex flex-col gap-2">
                <h2 className="px-1 text-[15px] font-semibold tracking-[-0.01em] first-letter:uppercase sticky top-[var(--header-h)] z-10 py-1 bg-bg">
                  {dayTitle(list[0].at)} <span className="text-muted font-normal text-[13px] ml-1 tnum">{list.length}</span>
                </h2>
                <Card pad={8}>
                  <div className="flex flex-col divide-y-[0.5px] divide-line">
                    {list.map((r) => <Entry key={r.id} r={r} onPerson={setPerson} />)}
                  </div>
                </Card>
              </section>
            ))}
          </div>
        )
      ) : (
        <ExceptionsList list={shownExceptions} />
      )}
    </div>
  );
}

/**
 * Аватар с бейджем типа события, как в iOS: кружок 18 px на окружности аватара под 45°,
 * вырезан из него обводкой цвета карточки; фон сплошной — тон события поверх белого, иначе
 * полупрозрачный тон просвечивает цветом аватара.
 */
const AV = 40, BADGE = 18;
// центр бейджа — на окружности под 45°: r + r·cos45; отступ края от угла аватара (отрицательный — наружу)
const BADGE_OFFSET = Math.round(AV - (AV / 2 + (AV / 2) * Math.SQRT1_2) - BADGE / 2);

function KindAvatar({ name, kind }: { name: string; kind: LogKind }) {
  const Icon = KIND[kind].icon;
  return (
    <span className="relative inline-flex self-start shrink-0" style={{ width: AV, height: AV }}>
      {name === "система" ? (
        <span className="w-full h-full rounded-full bg-fill inline-flex items-center justify-center text-muted"><LogIn size={18} /></span>
      ) : <Avatar name={name} size={AV} />}
      <span className="absolute rounded-full bg-surface" aria-hidden
        style={{ width: BADGE, height: BADGE, right: BADGE_OFFSET, bottom: BADGE_OFFSET, boxShadow: "0 0 0 2px var(--surface)" }}>
        <span className={cx("w-full h-full rounded-full flex items-center justify-center", KIND[kind].tone)}>
          <Icon size={11} strokeWidth={2.25} className="block" />
        </span>
      </span>
    </span>
  );
}

function Entry({ r, onPerson }: { r: Row; onPerson: (id: string) => void }) {
  return (
    <div className="flex gap-3.5 px-3 py-3.5">
      <KindAvatar name={r.actorName} kind={r.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{r.summary}</span>
          {r.subjectId && r.subjectId !== r.actorId && (
            <button type="button" onClick={() => onPerson(r.subjectId!)} title="Показать события сотрудника" className="cursor-pointer press">
              <Pill tone="neutral" size="sm">{shortName(r.subjectName ?? r.subjectId)}</Pill>
            </button>
          )}
        </div>
        <div className="text-[13px] text-muted mt-0.5">
          {r.actorId
            ? <button type="button" onClick={() => onPerson(r.actorId!)} className="hover:text-text-2 cursor-pointer">{r.actorName}</button>
            : "система"}
        </div>
        {r.exception && (
          <Surface level="block" tone="tinted" pad={12} className="mt-2.5 flex flex-col gap-1 text-[13px]">
            <div><span className="text-muted">Правило: </span>{r.exception.ruleCode}. {r.exception.ruleTitle}{r.exception.part && <span className="text-muted">, {r.exception.part}</span>}</div>
            <div><span className="text-muted">Причина: </span>{r.exception.reason || "—"}</div>
            <div><span className="text-muted">Одобрено: </span>{r.exception.approvedBy}</div>
          </Surface>
        )}
        {r.changes.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {r.changes.map((c, i) => <DiffLine key={i} d={c} />)}
          </div>
        )}
      </div>
      <div className="text-[13px] text-muted tnum pt-0.5 shrink-0">{time(r.at)}</div>
    </div>
  );
}

function ExceptionsList({ list }: { list: ExceptionEntry[] }) {
  if (!list.length) return <Card><EmptyState icon={ShieldCheck} title="Исключений нет" description="РО1 ещё не разрешал отступлений от регламента." /></Card>;
  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-[13px] text-muted">Отступления от правил регламента, которые разрешил РО1. Нормы ТК исключением не снимаются.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((x) => (
          <Card key={x.id} className={cx("flex flex-col gap-3", !x.active && "opacity-55")}>
            <div className="flex items-start gap-3">
              <Avatar name={x.employeeName} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold tracking-[-0.01em]">{x.employeeName}</div>
                <div className="text-[13px] text-muted">{x.part ?? "весь план"}</div>
              </div>
              <Pill tone={x.decision === "allow" ? "info" : "bad"} icon={ShieldCheck}>{x.decision === "allow" ? "разрешено" : "отказано"}{!x.active && ", отменено"}</Pill>
            </div>
            <Surface nested pad={14} tone="flat" className="flex flex-col gap-1.5">
              <div className="text-[13px] text-muted">{x.ruleCode}. {x.ruleTitle}</div>
              <div className="text-[14.5px] leading-relaxed">«{x.reason}»</div>
            </Surface>
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Avatar name={x.approvedBy} size={22} /><span>Одобрено: <span className="text-text-2">{x.approvedBy}</span>, {dateShort(x.at)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
