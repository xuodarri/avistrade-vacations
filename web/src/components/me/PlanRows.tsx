"use client";

/**
 * Список отпусков под сеткой календаря, в той же карточке: сверху «Новый отпуск», дальше части
 * плана. Строка раскрывается аккордеоном на месте — одновременно открыта одна. Наведение на строку
 * подсвечивает её дни в календаре, наведение на день — строку.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Banknote, CalendarClock, CircleCheck, CircleX, Info, MoreHorizontal, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { Avatar, Button, IconButton, Menu, Pill, Popover, Surface, cx, toast, type Tone } from "@/components/kit";
import { withdrawChange } from "@/server/actions/changes";
import type { MyChange } from "./types";
import { leaveReasonLabel } from "@/server/db/types";
import { MONTHS, PART_STATUS, TYPE_SHORT, cap, daysText, rangeText } from "./cal";
import { verdictOf } from "./PartEditor";
import { usePlan, type Part } from "./state";
import type { VacationType } from "@/server/db/types";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Плавное раскрытие по высоте и прозрачности. Пока сворачивается, показывает прежнее содержимое;
 * onOpened — когда раскрылось (докрутить, если ушло за край окна).
 */
export function Collapse({ open, children, onOpened }: { open: boolean; children: ReactNode; onOpened?: (el: HTMLElement) => void }) {
  const [mounted, setMounted] = useState(open);
  const [kept, setKept] = useState<ReactNode>(children);
  if (open && !mounted) setMounted(true);
  if (open && children !== kept) setKept(children);
  const ref = useRef<HTMLDivElement>(null);
  const opened = useRef(onOpened);
  useEffect(() => { opened.current = onOpened; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dur = reduced() ? 0 : open ? 380 : 240;
    const frames = [{ gridTemplateRows: "0fr", opacity: 0 }, { gridTemplateRows: "1fr", opacity: 1 }];
    const a = el.animate(open ? frames : [...frames].reverse(), { duration: dur, easing: EASE, fill: "both" });
    a.finished.then(() => {
      if (open) { a.cancel(); opened.current?.(el); } else setMounted(false);
    }).catch(() => {});
    return () => a.cancel();
  }, [open, mounted]);
  if (!mounted) return null;
  return (
    <div ref={ref} className="grid" inert={!open}>
      <div className="min-h-0 overflow-hidden">{open ? children : kept}</div>
    </div>
  );
}

/** Порядок строк: сначала черновики и вернувшиеся, потом на согласовании, потом согласованные */
const ORDER: Record<Part["status"], number> = { draft: 0, returned: 0, pending: 1, approved: 2, rejected: 3 };
export const rowOrder = (parts: Part[]) =>
  parts.map((x, i) => ({ x, i })).sort((a, b) => ORDER[a.x.status] - ORDER[b.x.status] || (a.x.start < b.x.start ? -1 : 1));

/** Что показывает шапка строки: у раскрытой — живые значения из выделения */
export interface RowFace { start: string; end: string; type: VacationType; substituteName: string | null; reason: string | null; reasonNote: string | null; needsPay?: boolean }

/** «Петров Сергей» → «Петров С.» */
const initials = (name: string) => {
  const [last, first] = name.split(/\s+/);
  return first ? `${last} ${first.charAt(0)}.` : last;
};

/** Шапка строки — единственный заголовок: дата-плашка, даты, «11 дней · основной · замещает Петров С.» */
function RowHead({ face, badge, children }: { face: RowFace; badge?: string; children?: ReactNode }) {
  const p = usePlan();
  const reason = leaveReasonLabel(face.type, face.reason, face.reasonNote);
  const meta = [
    daysText(p.days(face)),
    TYPE_SHORT[face.type].toLowerCase() + (reason ? ` — ${reason.toLowerCase()}` : ""),
  ];
  return (
    <div className="relative flex items-center gap-3 min-h-11">
      <DateTile date={face.start} />
      <div className="min-w-0 flex-1 pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-semibold tracking-[-0.02em] tnum">{cap(rangeText(face.start, face.end))}</span>
          {badge && <Pill tone="accent">{badge}</Pill>}
        </div>
        <div className="text-[13px] text-muted mt-0.5 tnum flex flex-wrap items-center gap-x-1.5">
          <span>{meta.join(" · ")}</span>
          {face.needsPay && <span className="inline-flex items-center gap-1 text-text-2"><Banknote size={14} className="text-ok" />отпускные</span>}
          {face.substituteName ? (
            <span className="inline-flex items-center gap-1">
              · замещает <Avatar name={face.substituteName} size={16} /><span className="text-text-2">{initials(face.substituteName)}</span>
            </span>
          ) : <span>· замещает —</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Строка «Новый отпуск»: свёрнута в подсказку, после выбора дат раскрывается */
export function NewRow({ face, hint, children, onOpened }: { face: RowFace | null; hint: ReactNode; children: ReactNode; onOpened?: (el: HTMLElement) => void }) {
  const open = !!face;
  return (
    <Surface nested pad={open ? 16 : 12} tone={open ? "raised" : "flat"} className="transition-shadow" data-tour="me.footer">
      {face ? <RowHead face={face}><Pill tone="accent" className="shrink-0">Новый</Pill></RowHead> : <div className="px-1 py-0.5 kit-fade">{hint}</div>}
      <Collapse open={open} onOpened={onOpened}><div className="pt-4">{children}</div></Collapse>
    </Surface>
  );
}

/** Строка части: дата-плашка, даты, дни, вид, замещающий, статус и проверка; раскрывается на месте */
export function PartRow({ part, index, face, badge, open, hot, onToggle, onHot, children, onOpened }: {
  part: Part; index: number; open: boolean; hot: boolean;
  /** Своя пилюля у дат вместо «Изменение» — например, «Заявка на изменение» */
  badge?: string;
  /** Живые значения раскрытой строки (пока тянут края или меняют вид); иначе — сама часть */
  face?: RowFace;
  onToggle: () => void; onHot: (on: boolean) => void; children: ReactNode; onOpened?: (el: HTMLElement) => void;
}) {
  const p = usePlan();
  const no = index + 1;
  const st = PART_STATUS[part.status];
  const editable = !p.locked && part.status !== "approved";
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <Surface nested pad={open ? 16 : 12} tone={open ? "raised" : "flat"} data-part={String(no)}
      className={cx("transition-shadow", hot && !open && "shadow-[inset_0_0_0_1.5px_var(--vacation-strong)]")}
      onMouseEnter={() => onHot(true)} onMouseLeave={() => onHot(false)}>
      <RowHead face={open && face ? face : part} badge={open ? badge ?? (editable ? "Изменение" : undefined) : undefined}>
        <div role="button" tabIndex={0} aria-expanded={open} aria-label={`Часть ${no}: ${rangeText(part.start, part.end)}${open ? ", свернуть" : ", раскрыть"}`}
          className="absolute inset-0 cursor-pointer outline-none focus-visible:shadow-[var(--ring)] r-in" onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }} />
        <div className="relative flex items-center gap-1.5 shrink-0" onClick={stop}>
          {part.change && <ChangePill change={part.change} />}
          <Pill tone={st.tone} dot>{st.label}</Pill>
          {/* у раскрытой строки проверка — в её теле, здесь не повторяем */}
          {!open && <CheckPill no={no} />}
          {editable && (
            <Menu items={[{ label: "Удалить", icon: Trash2, destructive: true, onSelect: () => p.remove(index) }]}>
              <IconButton icon={MoreHorizontal} label="Действия с частью" size="sm" />
            </Menu>
          )}
        </div>
      </RowHead>
      <Collapse open={open} onOpened={onOpened}><div className="pt-4">{children}</div></Collapse>
    </Surface>
  );
}

/** «Перенос на согласовании: 12–26 июля» — открытая заявка; «Заявку вернули» — на доработку */
function changeText(c: MyChange) {
  const what = c.kind === "cancel" ? "Отмена части" : c.kind === "shorten" ? "Сокращение" : "Перенос";
  const dates = c.newStart && c.newEnd ? `: ${rangeText(c.newStart, c.newEnd)}` : "";
  return c.status === "returned" ? `${what} — заявку вернули` : `${what} на согласовании${dates}`;
}
function ChangePill({ change }: { change: MyChange }) {
  return <Pill tone={change.status === "returned" ? "bad" : "warn"} icon={CalendarClock}>{changeText(change)}</Pill>;
}

/**
 * Согласованная часть: только просмотр — кто согласовал, замещающий, причина. Изменить — через
 * «Запросить перенос» (заявка уходит руководителю и РО1). Начавшийся отпуск не меняется.
 */
export function ApprovedView({ part, index, onRequest }: { part: Part; index: number; onRequest: () => void }) {
  const p = usePlan();
  const [busy, setBusy] = useState(false);
  const reason = leaveReasonLabel(part.type, part.reason, part.reasonNote);
  const started = part.start <= p.plan.today;
  const c = part.change;
  const withdraw = async () => {
    if (!c) return;
    setBusy(true);
    try {
      await withdrawChange(c.id);
      p.setChange(index, null);
      toast("Заявка отозвана", { description: "Часть остаётся на прежних датах" });
    } catch (e) {
      toast("Не удалось отозвать", { tone: "bad", description: e instanceof Error ? e.message : "Попробуйте ещё раз" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t-[0.5px] border-line pt-3 px-1">
      <div className="flex flex-col gap-1.5 text-[13px] text-text-2">
        <div>Согласована{p.plan.manager ? <> — руководитель <b className="font-semibold text-text">{p.plan.manager}</b>, РО1 — {p.plan.ro1}</> : null}</div>
        {reason && <div>Причина: {reason}</div>}
      </div>
      {c?.status === "open" && (
        <Surface nested tone="tinted" pad={12} className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-[13px] leading-snug">
            <div className="font-semibold text-text">{changeText(c)}</div>
            <div className="text-muted mt-0.5">
              Сейчас у {c.stage === "manager" ? "руководителя" : `РО1 — ${p.plan.ro1}`}. Пока заявку не решат, отпуск стоит на прежних датах.
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={Undo2} loading={busy} onClick={withdraw}>Отозвать заявку</Button>
        </Surface>
      )}
      {c?.status === "returned" && (
        <p className="text-[13px] text-bad leading-snug">Заявку вернули{c.decisionNote ? `: ${c.decisionNote}` : ""}. Можно подать новую.</p>
      )}
      {started ? (
        <p className="text-[13px] text-muted leading-snug">
          Отпуск уже начался или прошёл — менять его здесь нельзя. Если вы заболели во время отпуска — сообщите в отдел кадров,
          отпуск продлят или перенесут (ст. 171 ТК).
        </p>
      ) : c?.status !== "open" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={CalendarClock} onClick={onRequest}>Запросить перенос</Button>
          <p className="text-[12.5px] text-muted leading-snug min-w-0 flex-1">
            Перенос согласованного отпуска — не позднее чем за {p.plan.rescheduleDays ?? 14} дней до начала; позже — как исключение, решает РО1.
          </p>
        </div>
      )}
    </div>
  );
}

/** Листок календаря: месяц и число начала части */
function DateTile({ date }: { date: string }) {
  return (
    <div className="pointer-events-none w-11 h-11 r-in bg-vacation-bg text-vacation flex flex-col items-center justify-center shrink-0 leading-none">
      <span className="text-[10px] font-semibold uppercase tracking-[0.02em]">{MONTHS[+date.slice(5, 7) - 1].slice(0, 3)}</span>
      <span className="text-[18px] font-semibold tnum mt-0.5">{+date.slice(8, 10)}</span>
    </div>
  );
}

const CHECK: Record<"ok" | "warning" | "exception" | "law", { label: string; tone: Tone; icon: typeof CircleCheck }> = {
  ok: { label: "Проверка пройдена", tone: "ok", icon: CircleCheck },
  warning: { label: "Есть пометка", tone: "warn", icon: TriangleAlert },
  exception: { label: "Нужно исключение", tone: "warn", icon: TriangleAlert },
  law: { label: "Так нельзя", tone: "bad", icon: CircleX },
};

/** Пилюля проверки части; причины — по клику */
function CheckPill({ no }: { no: number }) {
  const p = usePlan();
  const list = p.partFindings(no);
  const c = CHECK[verdictOf(list)];
  if (p.saving) return <Pill tone="neutral">Проверяем…</Pill>;
  return (
    <Popover placement="bottom-end" width={340} pad={16} content={<Reasons list={list} />}>
      <button type="button" className="press rounded-full cursor-pointer" aria-label={`${c.label}: подробнее`}>
        <Pill tone={c.tone} icon={c.icon}>{c.label}</Pill>
      </button>
    </Popover>
  );
}

function Reasons({ list }: { list: { level: string; title: string; message: string; basis: string }[] }) {
  const icon = (l: string): ReactNode =>
    l === "block" ? <CircleX size={16} className="text-bad" /> : l === "warn" ? <TriangleAlert size={16} className="text-warn" />
      : l === "info" || l === "exception" ? <Info size={16} className="text-info" /> : <CircleCheck size={16} className="text-ok" />;
  const order = ["block", "warn", "exception", "info", "ok"];
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[15px] font-semibold">Проверка по правилам</div>
      {[...list].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)).map((f) => (
        <div key={f.title + f.message} className="flex gap-2.5">
          <span className="mt-0.5 shrink-0">{icon(f.level)}</span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium leading-snug">{f.title}</div>
            <div className="text-[13px] text-text-2 leading-snug mt-0.5">{cap(f.message.replace(/^Часть \d+: /, ""))}</div>
            {f.basis && <div className="text-[11.5px] text-muted-2 mt-0.5">{f.basis}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
