"use client";

/**
 * Разбор заявки в Sheet справа: части, итог движка по правилам с причинами, кто ещё из группы
 * в это время и решение HR. «Разрешить исключением» и «Вернуть» — в Dialog; после решения —
 * уведомление с «Отменить». ↑ ↓ листают заявки, пока панель открыта и не открыт диалог.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowRight, ArrowRightLeft, ArrowUp, CalendarRange, Check, CircleAlert, CircleCheck, HeartPulse, Info, LogOut, ShieldCheck, ShieldQuestion, TriangleAlert, Undo2, X } from "lucide-react";
import {
  Button, Checkbox, DateCalendar, Dialog, Field, Input, Pill, RangeCalendar, RangeSummary, SegmentedControl, Sheet, Surface, Textarea, Tooltip, cx, toast,
  type DateRange, type DayTone,
} from "@/components/kit";
import { fmtDate, fmtRange, fmtStamp } from "@/lib/dates";
import {
  hrApproveChange, hrApproveChangeWithException, hrApprovePart, hrApproveWithException, hrExtend, hrPreviewExtension, hrPreviewRecall,
  hrRecall, hrRejectChange, hrReturnPart, hrUndo,
} from "@/server/actions/hr";
import { MiniLane, type MiniLaneRow } from "@/components/gantt/MiniLane";
import { LeaveKindLine, SubstituteLine } from "@/components/gantt/Substitute";
import { ExceptionCallout, deciderLabel, sentence } from "@/components/gantt/ExceptionCallout";
import { STAGE_LABEL, TONE_LABEL, TONE_PILL } from "@/components/gantt/tones";
import { dayNo, isoAt } from "@/components/gantt/time";
import type { BoardChange, BoardFinding, BoardPart, Decision, GanttBoardData, Range } from "@/components/gantt/types";

const LEVEL = {
  block: { icon: CircleAlert, cls: "text-bad", bg: "bg-bad-bg!" },
  warn: { icon: TriangleAlert, cls: "text-warn", bg: "bg-warn-bg!" },
  exception: { icon: ShieldCheck, cls: "text-ok", bg: "bg-ok-bg!" },
  info: { icon: Info, cls: "text-muted", bg: "bg-fill-3!" },
  ok: { icon: CircleCheck, cls: "text-ok", bg: "bg-fill-3!" },
} as const;

export function RequestSheet({ data, partId, onClose, onSelect, onStep, position }: {
  data: GanttBoardData; partId: number | null; onClose: () => void; onSelect: (id: number) => void; onStep: (d: 1 | -1) => void; position?: string;
}) {
  const part = partId !== null ? data.parts.find((p) => p.id === partId) ?? null : null;
  const [dialog, setDialog] = useState<"exception" | "return" | "changeException" | "reject" | "extend" | "recall" | null>(null);
  const [busy, start] = useTransition();
  // клик по уведомлению («Отменить») для панели — клик мимо; такой клик панель не закрывает
  const fromToast = useRef(false);
  useEffect(() => {
    const mark = (e: PointerEvent) => { fromToast.current = !!(e.target as HTMLElement | null)?.closest?.("[aria-live]"); };
    window.addEventListener("pointerdown", mark, true);
    return () => window.removeEventListener("pointerdown", mark, true);
  }, []);
  const close = () => { if (fromToast.current) { fromToast.current = false; return; } onClose(); };

  useEffect(() => {
    if (!part || dialog) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); onStep(e.key === "ArrowDown" ? 1 : -1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [part, dialog, onStep]);

  if (!part) return <Sheet open={false} onClose={onClose} />;
  const e = data.employees[part.employeeId];
  const own = data.parts.filter((p) => p.employeeId === e.id).sort((a, b) => a.start.localeCompare(b.start));
  const rel = e.findings.filter((f) => f.partIds.length === 0 || f.partIds.includes(part.id));
  const open = rel.filter((f) => f.level === "block" || f.level === "warn");
  const resolved = rel.filter((f) => f.level === "exception");
  const passed = rel.filter((f) => f.level === "ok" || f.level === "info");
  // что делать, решает движок: law — только вернуть, exception — разрешить исключением, warning — можно согласовать
  const regOpen = open.filter((f) => f.consequence === "exception");
  const lawBlock = open.filter((f) => f.consequence === "law");
  const decidable = part.status === "pending" || part.status === "approved";
  const canApprove = part.status === "pending" && !regOpen.length && !lawBlock.length;
  const canException = decidable && regOpen.length > 0 && !lawBlock.length;
  // части другого года (заявка на изменение текущего отпуска) подписываем с годом
  const yearNote = (iso: string) => (iso.slice(0, 4) !== String(data.year) ? ` ${iso.slice(0, 4)}` : "");
  const who = `${e.name}, ${fmtRange(part.start, part.end)}`;

  /** Решение → уведомление с «Отменить». */
  const decide = (fn: () => Promise<Decision>, title: string, after?: () => void) => start(async () => {
    try {
      const r = await fn();
      if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
      after?.();
      toast(title, {
        description: who, duration: 12000,
        action: { label: "Отменить", onClick: () => { void hrUndo(r.undo).then((u) => toast(u.ok ? "Решение отменено" : u.error, { tone: u.ok ? "info" : "bad", description: u.ok ? who : undefined })); } },
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Не получилось сохранить", { tone: "bad" });
    }
  });

  /** Решение без отмены (перенос, продление, отзыв): уведомление и запись в журнале. */
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, title: string) => start(async () => {
    try {
      const r = await fn();
      if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
      setDialog(null);
      toast(title, { description: `${who}. Запись в журнале` });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Не получилось сохранить", { tone: "bad" });
    }
  });
  const ch = part.change;
  // решение на шаге HR — только у РО1 (по отпуску РО1 — у проверяющего); остальные HR смотрят
  const canDecide = data.viewerId === e.hrDecider.id;
  const decider = deciderLabel(e.hrDecider.name, e.hrDecider.asReviewer);
  // исключение решается отдельно, в плашке: по заявке на изменение — правила новых дат
  const exRules = ch ? (ch.needsException && !ch.law ? ch.findings.filter((f) => f.consequence === "exception") : []) : canException ? regOpen : [];
  const exOpen = exRules.length > 0;
  // регламент: РО1 проверяет после руководителя; у ИД шаг руководителя пропускается
  const waitMgr = ch ? ch.stage === "manager" : part.stage === "manager";
  const waitText = `Ждёт руководителя: ${sentence(e.managerName ?? "руководитель")} РО1 проверяет после согласования руководителем.`;
  const exAction = canDecide && exOpen && !waitMgr ? (
    <Button variant="primary" icon={ShieldCheck} onClick={() => setDialog(ch ? "changeException" : "exception")}>Разрешить исключением</Button>
  ) : undefined;

  const footer = !canDecide ? (
    <div className="text-[13px] text-muted px-2 pb-1">
      {e.hrDecider.asReviewer ? `Отпуск РО1 проверяет ${e.hrDecider.name}: решение — в разделе «Согласование» у проверяющего.` : `Решение принимает ${sentence(decider)}`}
    </div>
  ) : waitMgr && (ch || decidable) ? (
    <div data-tour="hr.decision" className="flex items-center gap-3 w-full">
      <span className="flex-1 text-[13px] text-muted px-2">{waitText} {ch ? "Отклонить" : "Вернуть сотруднику"} можно и сейчас.</span>
      {ch
        ? <Button size="lg" icon={X} onClick={() => setDialog("reject")}>Отклонить</Button>
        : <Button size="lg" icon={Undo2} onClick={() => setDialog("return")}>Вернуть</Button>}
    </div>
  ) : ch ? (
    <div data-tour="hr.decision" className="flex gap-2 w-full">
      <Button size="lg" block icon={X} onClick={() => setDialog("reject")}>Отклонить</Button>
      {ch.law ? (
        <Button size="lg" block variant="tinted" disabled title="Новые даты нарушают норму ТК">Только отклонить</Button>
      ) : (
        <Gate on={exOpen}>
          <Button size="lg" block variant="primary" icon={Check} loading={busy} disabled={exOpen}
            onClick={() => act(() => hrApproveChange(ch.id), ch.kind === "cancel" ? "Отказ от части согласован" : "Перенос согласован")}>
            {ch.kind === "cancel" ? "Согласовать отказ" : `Согласовать ${ch.kindLabel.toLowerCase()}`}
          </Button>
        </Gate>
      )}
    </div>
  ) : !decidable ? (
    <div className="text-[13px] text-muted px-2 pb-1">
      {part.status === "draft" ? "Черновик: сотрудник ещё не отправил план." : "Часть у сотрудника: ждём новые даты."}
    </div>
  ) : (
    <div data-tour="hr.decision" className="flex gap-2 w-full">
      <Button size="lg" block icon={Undo2} onClick={() => setDialog("return")}>Вернуть</Button>
      {part.status === "approved" && !exOpen ? (
        <Button size="lg" block variant="tinted" icon={Check} disabled>Уже в графике</Button>
      ) : (
        <Gate on={exOpen}>
          <Button size="lg" block variant="primary" icon={Check} loading={busy} disabled={!canApprove}
            title={lawBlock.length ? "Нарушена норма ТК — только вернуть" : undefined}
            onClick={() => decide(() => hrApprovePart(part.id), "Согласовано")}>Согласовать</Button>
        </Gate>
      )}
    </div>
  );

  return (
    <>
      <Sheet open onClose={close} width={540} title={e.fullName}
        description={<>{e.position}, {e.department ?? e.division}{e.managerName ? `. Руководитель: ${e.managerName}` : ""}</>}
        footer={footer}>
        <div data-tour="hr.sheet" className="flex flex-col gap-6 pb-2">
          {own.length > 1 && (
            <SegmentedControl block size="sm" aria-label="Часть плана" value={String(part.id)} onChange={(v) => onSelect(Number(v))}
              options={own.map((p) => ({ value: String(p.id), label: `${p.partNo}. ${fmtRange(p.start, p.end)}${yearNote(p.start)}` }))} />
          )}

          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-[26px] font-semibold tracking-[-0.03em] tnum">{fmtRange(part.start, part.end)}{yearNote(part.start)}</span>
              <span className="text-[15px] text-muted tnum">{part.days} дн.</span>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Pill tone={TONE_PILL[part.tone]} dot>{TONE_LABEL[part.tone]}</Pill>
              <Pill tone="neutral">{STAGE_LABEL[part.stage]}</Pill>
              {part.exceptionRequest && <Pill tone="info" icon={ShieldQuestion}>Запрос исключения</Pill>}
              {part.holidays.length > 0 && <Pill tone="neutral">праздник {part.holidays.map((h) => fmtDate(h)).join(", ")} не входит</Pill>}
              <span className="text-[12.5px] text-muted ml-auto tnum">в плане {e.totalDays} из {e.normDays} дн.</span>
            </div>
            <Route part={part} e={e} />
            <div className="mt-4 flex flex-col gap-2"><LeaveKindLine kind={part.kind} /><SubstituteLine s={part.substitute} /></div>
          </div>

          {ch && <ChangeBlock c={ch} data={data} part={part} />}

          {exOpen && (
            <ExceptionCallout title={part.exceptionRequest || ch ? "Запрос исключения" : "Нужно исключение из регламента"}
              rules={exRules} note={!ch && part.exceptionRequest ? e.exceptionNote : ch ? ch.note : undefined} action={exAction}
              footer={waitMgr ? <>{waitText} Исключение — тоже после этого.</> : canDecide
                ? <>Окончательно исключение разрешает {decider}: с обязательной причиной, запись в журнале. Обычное «Согласовать» — после решения.</>
                : <>Окончательно исключение разрешает {sentence(decider)}</>} />
          )}

          {!ch && canDecide && part.status === "approved" && (
            <section>
              <h3 className="text-[15px] font-semibold tracking-[-0.015em] mb-1">Оформить изменение</h3>
              <p className="text-[12.5px] text-muted mb-2.5">Для согласованных и идущих отпусков: оформляет РО1, запись — в журнал с основанием</p>
              <div className="flex gap-2">
                <Button icon={HeartPulse} onClick={() => setDialog("extend")}>Продлить по больничному</Button>
                <Button icon={LogOut} onClick={() => setDialog("recall")}>Отозвать из отпуска</Button>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] mb-2.5">Проверка по правилам</h3>
            {!open.length && !resolved.length && (
              <Surface nested tone="flat" className="bg-ok-bg!"><div className="flex gap-2.5 text-[14px] text-ok"><CircleCheck size={18} />Конфликтов нет: все правила выполнены.</div></Surface>
            )}
            <div className="flex flex-col gap-2">
              {[...open, ...resolved].map((f, i) => <Verdict key={`${f.ruleCode}-${i}`} f={f} />)}
            </div>
            {passed.length > 0 && <Passed list={passed} />}
          </section>

          <section>
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] mb-1">Кто ещё из группы в это время</h3>
            <p className="text-[12.5px] text-muted mb-2">Коллеги с тем же лимитом, те, без кого уходить нельзя, и замещающий</p>
            <GroupLane data={data} part={part} />
          </section>

          {position && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-2">
              <ArrowUp size={13} /><ArrowDown size={13} /> другие заявки, {position}
            </div>
          )}
        </div>
      </Sheet>

      <ExceptionDialog open={dialog === "exception"} onClose={() => setDialog(null)} rules={regOpen} busy={busy}
        onSubmit={(reason) => decide(() => hrApproveWithException(part.id, reason), "Разрешено исключением", () => setDialog(null))} />
      {ch && (
        <>
          <ExceptionDialog open={dialog === "changeException"} onClose={() => setDialog(null)} busy={busy}
            rules={ch.findings.filter((f) => f.consequence === "exception")}
            onSubmit={(reason) => act(() => hrApproveChangeWithException(ch.id, reason), "Перенос разрешён исключением")} />
          <RejectDialog key={`r-${ch.id}`} open={dialog === "reject"} onClose={() => setDialog(null)} busy={busy} change={ch}
            onSubmit={(reason) => act(() => hrRejectChange(ch.id, reason), "Перенос отклонён")} />
        </>
      )}
      <ExtendDialog key={`e-${part.id}`} open={dialog === "extend"} onClose={() => setDialog(null)} busy={busy} part={part}
        onSubmit={(s, en, basis) => act(() => hrExtend(part.id, s, en, basis), "Отпуск продлён")} />
      <RecallDialog key={`c-${part.id}`} open={dialog === "recall"} onClose={() => setDialog(null)} busy={busy} part={part}
        onSubmit={(d, consent, basis) => act(() => hrRecall(part.id, d, consent, basis), "Работник отозван из отпуска")} />
      <ReturnDialog key={part.id} open={dialog === "return"} onClose={() => setDialog(null)} data={data} part={part} open_={open} busy={busy}
        onSubmit={(comment, windows) => decide(() => hrReturnPart(part.id, comment, windows), "Возвращено сотруднику", () => setDialog(null))} />
    </>
  );
}

/** Пока исключение не решено, обычное «Согласовать» недоступно: подсказка на обёртке (у disabled нет событий мыши). */
function Gate({ on, children }: { on: boolean; children: React.ReactElement }) {
  if (!on) return children;
  return <Tooltip content="Сначала решите исключение"><span tabIndex={0} className="flex-1 flex">{children}</span></Tooltip>;
}

function Route({ part, e }: { part: BoardPart; e: GanttBoardData["employees"][string] }) {
  type S = { role: string; title: string; state: string; tone: "done" | "now" | "wait" | "back" };
  const manager = e.managerName, d = e.hrDecider;
  const mgr: S = !manager ? { role: "Руководитель", title: "нет — ИД", state: "шаг пропускается", tone: "done" }
    : part.stage === "manager" ? { role: "Руководитель", title: manager, state: "ждёт решения", tone: "now" }
    : part.managerApproval ? { role: "Руководитель", title: manager, state: `согласовано ${fmtStamp(part.managerApproval.at)}`, tone: "done" }
    : { role: "Руководитель", title: manager, state: part.stage === "approved" ? "решение принял РО1" : "—", tone: "wait" };
  const steps: S[] = [
    { role: "Сотрудник", title: e.name, state: part.status !== "draft" && e.submittedAt ? `подано ${fmtStamp(e.submittedAt)}` : "черновик", tone: part.status !== "draft" ? "done" : "now" },
    mgr,
    { role: d.asReviewer ? "Проверяет за РО1" : "РО1", title: d.name, state: STAGE_LABEL[part.stage].replace(/^./, (c) => c.toLowerCase()),
      tone: part.stage === "approved" ? "done" : part.stage === "hr" ? "now" : part.stage === "returned" ? "back" : "wait" },
  ];
  const bar = { done: "bg-ok", now: "bg-warn", wait: "bg-fill", back: "bg-info" };
  const txt = { done: "text-ok", now: "text-warn", wait: "text-muted-2", back: "text-info" };
  return (
    <ol className="grid grid-cols-3 gap-2 mt-4">
      {steps.map((s, i) => (
        <li key={i} className="min-w-0">
          <span className={cx("block h-1 rounded-full mb-2", bar[s.tone])} />
          <div className="text-[11.5px] text-muted truncate">{s.role}</div>
          <div className="text-[12.5px] font-medium truncate">{s.title}</div>
          <div className={cx("text-[12px] truncate", txt[s.tone])}>{s.state}</div>
        </li>
      ))}
    </ol>
  );
}

function Verdict({ f }: { f: BoardFinding }) {
  const l = LEVEL[f.level];
  const Icon = l.icon;
  const who = f.ruleCode === "R01" ? "Одновременно в отпуске" : f.ruleCode === "R02" ? "Нет на месте" : f.ruleCode === "R15" ? "Замещающий" : "Затронуты";
  return (
    <Surface nested tone="flat" className={l.bg}>
      <div className="flex gap-2.5">
        <Icon size={18} className={cx("shrink-0 mt-px", l.cls)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span className="text-[14px] font-medium leading-snug flex-1">{f.title}</span>
            <Pill size="sm" tone="neutral" title={f.source === "ТК" ? "Норма закона: исключением не снимается" : "Правило регламента: РО1 может разрешить исключением"}>{f.ruleCode}, {f.source}</Pill>
          </div>
          <div className="text-[13.5px] text-text-2 mt-0.5">{f.message.replace(/\. Разрешено исключением HR:.*$/, "")}</div>
          {f.people.length > 0 && <div className="text-[13px] mt-1"><span className="text-muted">{who}:</span> {f.people.join(", ")}</div>}
          {f.exceptionReason && <div className="text-[13px] mt-1.5 text-ok">Исключение РО1: {f.exceptionReason}</div>}
          <div className="text-[12px] text-muted-2 mt-1">{f.basis}</div>
        </div>
      </div>
    </Surface>
  );
}

function Passed({ list }: { list: BoardFinding[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Скрыть" : "Показать"} выполненные правила ({list.length})</Button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1.5 px-1">
          {list.map((f, i) => {
            const Icon = LEVEL[f.level].icon;
            return (
              <li key={`${f.ruleCode}-${i}`} className="flex gap-2 text-[13px]">
                <Icon size={15} className={cx("shrink-0 mt-0.5", LEVEL[f.level].cls)} />
                <span className="flex-1">{f.message}</span>
                <span className="text-[11px] text-muted-2 shrink-0 mt-0.5">{f.ruleCode}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Мини-лента группы: коллеги с тем же лимитом и связанные роли на отрезке заявки ± 10 дней. */
function GroupLane({ data, part }: { data: GanttBoardData; part: BoardPart }) {
  const sg = data.tiers.flatMap((t) => t.subgroups).find((g) => g.employeeIds.includes(part.employeeId));
  const sub = part.substitute;
  const ids = [...new Set([part.employeeId, ...(sub ? [sub.id] : []), ...(sg?.employeeIds ?? []), ...(sg?.dependencyIds ?? [])])];
  const from = isoAt(part.start, -10), to = isoAt(part.end, 10);
  const rows: MiniLaneRow[] = ids.map((id) => {
    const e = data.employees[id];
    const list = data.parts.filter((p) => p.employeeId === id && p.status !== "returned" && p.status !== "rejected");
    const near = list.some((p) => p.start <= part.end && p.end >= part.start);
    return {
      key: id, name: e.name, fullName: e.fullName, candidate: id === part.employeeId, near,
      note: sg?.dependencyIds.includes(id) ? `${e.role}: на месте` : "на месте",
      ...(sub?.id === id ? { tag: "замещает", clash: sub.away, near: true } : {}),
      parts: id === part.employeeId ? [{ start: part.start, end: part.end, tone: part.tone }]
        : list.map((p) => ({ start: p.start, end: p.end, tone: p.tone })),
    };
  }).sort((a, b) => Number(b.candidate) - Number(a.candidate) || Number(!!b.tag) - Number(!!a.tag) || Number(b.near) - Number(a.near));
  return <MiniLane from={from} to={to} rows={rows} focus={{ start: part.start, end: part.end }} holidays={data.holidays.map((h) => h.date)} nameWidth={190} />;
}

function ExceptionDialog({ open, onClose, rules, busy, onSubmit }: {
  open: boolean; onClose: () => void; rules: BoardFinding[]; busy: boolean; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const names = [...new Map(rules.map((f) => [f.ruleCode, `${f.ruleCode} «${f.title}»`])).values()];
  const short = reason.trim().length < 5;
  return (
    <Dialog open={open} onClose={onClose} persistent={busy} title="Разрешить исключением"
      description={`Будет разрешено: ${names.join(", ")}. Часть станет согласованной, причина попадёт в журнал.`}
      footer={<>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" icon={ShieldCheck} loading={busy} disabled={short} onClick={() => onSubmit(reason)}>Разрешить</Button>
      </>}>
      <Field label="Причина" hint={short ? "Обязательно: без причины исключение не записывается" : "Её увидят в журнале и в разборе заявки"}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} autoFocus
          placeholder="Например: клиентов на эти дни ведёт Шумская Е. В., замена согласована с начальником отдела" />
      </Field>
    </Dialog>
  );
}

function ReturnDialog({ open, onClose, data, part, open_: conflicts, busy, onSubmit }: {
  open: boolean; onClose: () => void; data: GanttBoardData; part: BoardPart; open_: BoardFinding[]; busy: boolean;
  onSubmit: (comment: string, windows: Range[]) => void;
}) {
  const engine = data.windows[part.id] ?? [];
  const [comment, setComment] = useState(() => returnText(conflicts));
  const [picked, setPicked] = useState<string[]>(() => (engine[0] ? [engine[0].start] : []));
  const [custom, setCustom] = useState<Range[]>([]);
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [calendar, setCalendar] = useState(false);
  const load = useLoadTone(data, part);
  const offered = [...engine.filter((w) => picked.includes(w.start)).map((w) => ({ start: w.start, end: w.end })), ...custom].slice(0, 3);
  const short = comment.trim().length < 5;

  return (
    <Dialog open={open} onClose={onClose} persistent={busy} width={calendar ? 680 : 520} title="Вернуть сотруднику"
      description={`Часть ${part.partNo}: ${fmtRange(part.start, part.end)}. Сотрудник увидит комментарий и предложенные даты.`}
      footer={<>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" icon={Undo2} loading={busy} disabled={short} onClick={() => onSubmit(comment, offered)}>
          {offered.length ? `Вернуть и предложить ${offered.length === 1 ? "даты" : `${offered.length} варианта`}` : "Вернуть"}
        </Button>
      </>}>
      <div className="flex flex-col gap-5">
        <Field label="Комментарий" hint={short ? "Обязательно" : undefined}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Что поменять" />
        </Field>

        <div>
          <div className="text-[13px] font-medium mb-2">Предложить даты <span className="text-muted font-normal">до трёх вариантов</span></div>
          {engine.length === 0 && <div className="text-[13px] text-muted mb-2">Движок не нашёл рядом свободных окон той же длины.</div>}
          <div className="flex flex-col gap-1.5">
            {engine.map((w) => (
              <Surface key={w.start} nested tone="flat" pad={10} className={cx(picked.includes(w.start) && "bg-accent-bg!")}>
                <Checkbox checked={picked.includes(w.start)} onChange={(v) => setPicked((p) => (v ? [...p, w.start] : p.filter((x) => x !== w.start)))}
                  label={<span className="tnum">{fmtRange(w.start, w.end)}, {w.days} дн.</span>} description={`${shiftText(w.shift)}, в группе есть места`} />
              </Surface>
            ))}
            {custom.map((w) => (
              <Surface key={w.start} nested tone="flat" pad={10} className="bg-accent-bg!">
                <Checkbox checked onChange={() => setCustom((c) => c.filter((x) => x.start !== w.start))}
                  label={<span className="tnum">{fmtRange(w.start, w.end)}, {dayNo(w.end, w.start) + 1} календарных</span>} description="свои даты" />
              </Surface>
            ))}
          </div>
          {!calendar ? (
            <Button size="sm" variant="ghost" icon={CalendarRange} className="mt-2" disabled={offered.length >= 3} onClick={() => setCalendar(true)}>Выбрать свои даты</Button>
          ) : (
            <Surface nested tone="flat" className="mt-3">
              <RangeCalendar value={range} onChange={setRange} months={2} min={`${data.year}-01-01`} max={`${data.year}-12-31`} defaultMonth={part.start} dayTone={load} />
              <div className="flex items-center gap-2 mt-2 px-1">
                {range.start && range.end ? <RangeSummary start={range.start} end={range.end} /> : <span className="text-[12.5px] text-muted">Отметьте первый и последний день. Цвет — загрузка группы</span>}
                <Button size="sm" className="ml-auto" onClick={() => { setCalendar(false); setRange({ start: null, end: null }); }}>Отмена</Button>
                <Button size="sm" variant="primary" disabled={!range.start || !range.end}
                  onClick={() => { setCustom((c) => [...c, { start: range.start!, end: range.end! }]); setRange({ start: null, end: null }); setCalendar(false); }}>Добавить</Button>
              </div>
            </Surface>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Подкраска календаря загрузкой группы сотрудника (без него самого — по уровням ленты). */
function useLoadTone(data: GanttBoardData, part: BoardPart) {
  return useMemo(() => {
    const row = data.tiers.flatMap((t) => t.subgroups).find((g) => g.employeeIds.includes(part.employeeId))?.load;
    if (!row) return undefined;
    const base = `${data.year}-01-01`;
    return (iso: string): DayTone | null => {
      const i = dayNo(iso, base);
      const lv = row.level[i] ?? 0, n = row.absent[i] ?? 0;
      if (lv >= 3) return "full";
      if (row.limit !== null && n >= row.limit) return "one";
      return "free";
    };
  }, [data, part.employeeId]);
}

function shiftText(shift: number) {
  const n = Math.abs(shift), w = n % 7 === 0 ? n / 7 : 0;
  const amount = w ? `${w} ${w === 1 ? "неделю" : w < 5 ? "недели" : "недель"}` : `${n} дн.`;
  return `на ${amount} ${shift < 0 ? "раньше" : "позже"}`;
}

/** Черновик комментария при возврате — из первого открытого конфликта. */
function returnText(open: BoardFinding[]) {
  const f = open[0];
  if (!f) return "";
  if (f.ruleCode === "R01") return `В эти даты уже отдыхают ${f.people.join(", ")} — лимит группы превышен. Перенесите, пожалуйста, часть на свободные даты.`;
  if (f.ruleCode === "R02") return `В эти даты в отпуске ${f.people.join(", ")}, а по регламенту без этой роли на месте уходить нельзя. Перенесите, пожалуйста, часть.`;
  return `${f.title}: ${f.message}. Поправьте, пожалуйста, даты.`;
}

/** Заявка на перенос: было → станет, причина сотрудника, маршрут и проверка новых дат. */
function ChangeBlock({ c, data, part }: { c: BoardChange; data: GanttBoardData; part: BoardPart }) {
  const open = c.findings.filter((f) => f.level === "block" || f.level === "warn");
  const from = isoAt(c.newStart && c.newStart < c.oldStart ? c.newStart : c.oldStart, -7);
  const to = isoAt(c.newEnd && c.newEnd > c.oldEnd ? c.newEnd : c.oldEnd, 7);
  const sg = data.tiers.flatMap((t) => t.subgroups).find((g) => g.employeeIds.includes(part.employeeId));
  const ids = [...new Set([part.employeeId, ...(part.substitute ? [part.substitute.id] : []), ...(sg?.employeeIds ?? []), ...(sg?.dependencyIds ?? [])])];
  const rows: MiniLaneRow[] = ids.map((id) => {
    const e = data.employees[id];
    const own = id === part.employeeId;
    const list = data.parts.filter((p) => p.employeeId === id && p.status !== "returned" && p.status !== "rejected");
    return {
      key: id, name: e.name, fullName: e.fullName, candidate: own, note: "на месте",
      near: !own && list.some((p) => !!c.newStart && !!c.newEnd && p.start <= c.newEnd && p.end >= c.newStart),
      ...(part.substitute?.id === id ? { tag: "замещает" } : {}),
      parts: own
        ? [{ start: c.oldStart, end: c.oldEnd, tone: part.tone, style: "old" as const },
          ...(c.newStart && c.newEnd ? [{ start: c.newStart, end: c.newEnd, tone: "pending" as const, style: "new" as const }] : [])]
        : list.map((p) => ({ start: p.start, end: p.end, tone: p.tone })),
    };
  }).sort((a, b) => Number(b.candidate) - Number(a.candidate) || Number(b.near) - Number(a.near));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Pill tone="info" icon={ArrowRightLeft}>{c.kindLabel}</Pill>
        <span className="text-[13px] text-muted">{c.stage === "manager" ? "у руководителя" : c.managerBy ? `руководитель ${c.managerBy} согласовал, решает РО1` : "решает РО1"}</span>
        <span className="ml-auto text-[12px] text-muted-2 tnum">подана {fmtDate(c.requestedOn)}</span>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[13px] text-muted">было</span>
        <span className="text-[17px] font-semibold tnum line-through decoration-muted-2/60 text-muted">{fmtRange(c.oldStart, c.oldEnd)}</span>
        <ArrowRight size={16} className="text-muted-2" />
        {c.kind === "cancel" ? <span className="text-[17px] font-semibold text-bad">отказ от части</span> : (
          <>
            <span className="text-[13px] text-muted">станет</span>
            <span className="text-[17px] font-semibold tnum">{c.newStart && c.newEnd ? fmtRange(c.newStart, c.newEnd) : "—"}</span>
          </>
        )}
      </div>
      <div className="text-[13px]"><span className="text-muted">Основание:</span> {c.reason}</div>
      {c.note && (
        <Surface nested tone="flat" className="bg-info-bg!">
          <div className="flex gap-3">
            <span aria-hidden className="w-[3px] self-stretch rounded-full bg-info shrink-0" />
            <div><div className="text-[12px] font-medium text-info mb-0.5">Причина сотрудника</div><blockquote className="text-[14px] leading-snug">«{c.note}»</blockquote></div>
          </div>
        </Surface>
      )}
      <div>
        <div className="text-[13px] font-medium mb-1.5">Проверка новых дат</div>
        {open.length === 0
          ? <Surface nested tone="flat" className="bg-ok-bg!"><div className="flex gap-2.5 text-[14px] text-ok"><CircleCheck size={18} />Новые даты проходят все правила.</div></Surface>
          : <div className="flex flex-col gap-2">{open.map((f, i) => <Verdict key={`${f.ruleCode}-${i}`} f={f} />)}</div>}
      </div>
      {c.windows.length > 0 && (
        <div className="text-[12.5px] text-muted">Свободные окна той же длины: {c.windows.map((w) => fmtRange(w.start, w.end)).join(", ")}</div>
      )}
      <MiniLane from={from} to={to} rows={rows} focus={{ start: c.newStart ?? c.oldStart, end: c.newEnd ?? c.oldEnd }} holidays={data.holidays.map((h) => h.date)} nameWidth={190} />
    </section>
  );
}

function RejectDialog({ open, onClose, busy, change, onSubmit }: { open: boolean; onClose: () => void; busy: boolean; change: BoardChange; onSubmit: (r: string) => void }) {
  const [reason, setReason] = useState("");
  const short = reason.trim().length < 5;
  return (
    <Dialog open={open} onClose={onClose} persistent={busy} title={`Отклонить: ${change.kindLabel.toLowerCase()}`}
      description={`Часть останется на прежних датах: ${fmtRange(change.oldStart, change.oldEnd)}. Сотрудник увидит причину.`}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="destructive" icon={X} loading={busy} disabled={short} onClick={() => onSubmit(reason)}>Отклонить</Button></>}>
      <Field label="Причина" hint={short ? "Обязательно" : undefined}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus placeholder="Например: в эти даты в отпуске оба менеджера отдела" />
      </Field>
    </Dialog>
  );
}

/** Продление по больничному (ст. 171): даты больничного → новый конец, пересчёт делает движок. */
function ExtendDialog({ open, onClose, busy, part, onSubmit }: {
  open: boolean; onClose: () => void; busy: boolean; part: BoardPart; onSubmit: (start: string, end: string, basis: string) => void;
}) {
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [basis, setBasis] = useState("");
  const [preview, setPreview] = useState<{ end: string; addedDays: number; message: string } | null>(null);
  useEffect(() => {
    if (!range.start || !range.end) return;
    let live = true;
    void hrPreviewExtension(part.id, range.start, range.end).then((p) => { if (live) setPreview(p); });
    return () => { live = false; };
  }, [part.id, range.start, range.end]);
  const ready = !!(range.start && range.end && preview?.addedDays && basis.trim().length >= 3);
  return (
    <Dialog open={open} onClose={onClose} persistent={busy} width={680} title="Продлить по больничному"
      description={`Часть ${part.partNo}: ${fmtRange(part.start, part.end)}. Дни больничного внутри отпуска переносятся в конец (ст. 171 ТК).`}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" icon={HeartPulse} loading={busy} disabled={!ready}
        onClick={() => onSubmit(range.start!, range.end!, basis)}>Продлить</Button></>}>
      <div className="flex flex-col gap-4">
        <Surface nested tone="flat">
          <RangeCalendar value={range} onChange={setRange} months={2} defaultMonth={part.start} />
        </Surface>
        <div className="text-[13.5px] min-h-[20px]">
          {range.start && range.end && preview
            ? preview.addedDays ? <>Новый последний день — <span className="font-semibold">{fmtDate(preview.end)}</span>, отпуск длиннее на {preview.addedDays} дн. <span className="text-muted">{preview.message}</span></>
              : <span className="text-warn">{preview.message}</span>
            : <span className="text-muted">Отметьте первый и последний день больничного.</span>}
        </div>
        <Field label="Основание" hint="Номер листка нетрудоспособности, он попадёт в журнал">
          <Input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Листок нетрудоспособности № …" />
        </Field>
      </div>
    </Dialog>
  );
}

/** Отзыв из отпуска (ст. 174): только с согласия работника; запреты (до 18 лет) проверяет движок. */
function RecallDialog({ open, onClose, busy, part, onSubmit }: {
  open: boolean; onClose: () => void; busy: boolean; part: BoardPart; onSubmit: (returnOn: string, consent: boolean, basis: string) => void;
}) {
  const [day, setDay] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [basis, setBasis] = useState("");
  const [preview, setPreview] = useState<{ allowed: boolean; returnedDays: number; message: string; returnOn: string } | null>(null);
  useEffect(() => {
    if (!day) return;
    let live = true;
    void hrPreviewRecall(part.id, day).then((p) => { if (live) setPreview(p); });
    return () => { live = false; };
  }, [part.id, day]);
  const ready = !!(day && preview?.allowed && consent && basis.trim().length >= 3);
  return (
    <Dialog open={open} onClose={onClose} persistent={busy} width={520} title="Отозвать из отпуска"
      description={`Часть ${part.partNo}: ${fmtRange(part.start, part.end)}. Неиспользованные дни вернутся в остаток (ст. 174 ТК).`}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" icon={LogOut} loading={busy} disabled={!ready}
        onClick={() => onSubmit(day!, consent, basis)}>Отозвать</Button></>}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[13px] font-medium mb-1.5 px-0.5">День выхода на работу</div>
          <Surface nested tone="flat"><DateCalendar value={day} onChange={setDay} min={isoAt(part.start, 1)} max={part.end} defaultMonth={part.start} /></Surface>
        </div>
        <div className="text-[13.5px] min-h-[20px]">
          {day && preview
            ? preview.allowed ? <>Вернутся в остаток: <span className="font-semibold">{preview.returnedDays} дн.</span> <span className="text-muted">{preview.message}</span></>
              : <span className="text-bad">{preview.message}</span>
            : <span className="text-muted">Выберите день выхода.</span>}
        </div>
        <Checkbox checked={consent} onChange={setConsent} label="Согласие работника получено" description="Без согласия отзывать нельзя" />
        <Field label="Основание" hint="Приказ или служебная записка, попадёт в журнал">
          <Input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Приказ № … от …" />
        </Field>
      </div>
    </Dialog>
  );
}
