"use client";

/**
 * Очередь руководителя в стиле «входящих»: слева заявки команды, справа выбранная — проверка,
 * мини-Гант команды на эти даты и решение. j / k листают, массово согласуются заявки без
 * конфликтов, после каждого решения — уведомление с «Отменить».
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, ArrowRightLeft, Check, CheckCheck, CircleAlert, CircleCheck, Inbox as InboxIcon, ShieldCheck, ShieldQuestion, TriangleAlert, Undo2 } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, Pill, Surface, Textarea, cx, toast } from "@/components/kit";
import { fmtDate, fmtRange, fmtStamp } from "@/lib/dates";
import { hrApproveChange, hrApproveChangeWithException, hrApprovePart, hrApproveWithException, hrRejectChange, hrReturnPart } from "@/server/actions/hr";
import { managerApprove, managerApproveChange, managerApproveClean, managerReturn, managerReturnChange, managerUndo, type LaneRow, type QueueItem, type QueuePerson } from "@/server/actions/team";
import { MiniLane, type MiniLaneRow } from "@/components/gantt/MiniLane";
import { LeaveKindLine, SubstituteLine } from "@/components/gantt/Substitute";
import { ExceptionCallout, deciderLabel, sentence } from "@/components/gantt/ExceptionCallout";
import { STAGE_LABEL } from "@/components/gantt/tones";
import { isoAt } from "@/components/gantt/time";
import type { BoardFinding, UndoToken } from "@/components/gantt/types";

type Entry = { p: QueuePerson; i: QueueItem; asRo1?: boolean };
const isOpen = (f: BoardFinding) => f.level === "block" || f.level === "warn";
const clean = (e: Entry) => !e.i.change && !e.i.findings.some(isOpen);
/** Шаг маршрута записи: у заявки на перенос — свой шаг. */
const stageOf = (e: Entry) => (e.i.change ? (e.i.change.stage === "manager" ? "manager" : "hr") : e.i.stage);

const ICON = {
  block: { icon: CircleAlert, cls: "text-bad", bg: "bg-bad-bg!" },
  warn: { icon: TriangleAlert, cls: "text-warn", bg: "bg-warn-bg!" },
  exception: { icon: ShieldCheck, cls: "text-ok", bg: "bg-ok-bg!" },
} as const;

export function Inbox({ people, lane, holidays, managerId, review = [], hrName }: {
  people: QueuePerson[]; lane: LaneRow[]; holidays: string[]; managerId: string; review?: QueuePerson[]; hrName: string;
}) {
  const ro1List = useMemo<Entry[]>(() => review.flatMap((p) => p.items.map((i) => ({ p, i, asRo1: true }))), [review]);
  const all = useMemo<Entry[]>(() => people.flatMap((p) => p.items.filter((i) => i.stage !== "draft" || i.change).map((i) => ({ p, i }))), [people]);
  const { waiting, atHr, done, order } = useMemo(() => {
    const by = (a: Entry, b: Entry) => a.i.start.localeCompare(b.i.start);
    const waiting = all.filter((e) => stageOf(e) === "manager").sort(by);
    const atHr = all.filter((e) => stageOf(e) === "hr").sort(by);
    const done = all.filter((e) => stageOf(e) !== "manager" && stageOf(e) !== "hr").sort(by);
    return { waiting, atHr, done, order: [...ro1List, ...waiting, ...atHr, ...done] };
  }, [all, ro1List]);
  const cleanOnes = waiting.filter(clean);
  const notSent = people.filter((p) => !p.items.length || p.requestStatus === "draft");

  const [sel, setSel] = useState<number | null>(waiting[0]?.i.partId ?? null);
  const [returning, setReturning] = useState(false);
  const [busy, start] = useTransition();
  // выбранная заявка могла исчезнуть (сотрудник пересоздал план) — тогда первая из ждущих
  const current = order.find((e) => e.i.partId === sel) ?? waiting[0] ?? null;

  // j / k — следующая и предыдущая заявка, как в почте
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (returning || ev.metaKey || ev.ctrlKey || (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT"))) return;
      if (ev.key !== "j" && ev.key !== "k" && ev.key !== "о" && ev.key !== "л") return;
      const d = ev.key === "j" || ev.key === "о" ? 1 : -1;
      const i = order.findIndex((e) => e.i.partId === sel);
      const next = order[Math.min(order.length - 1, Math.max(0, (i < 0 ? 0 : i + d)))];
      if (next) { ev.preventDefault(); setSel(next.i.partId); document.querySelector(`[data-entry="${next.i.partId}"]`)?.scrollIntoView({ block: "nearest" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, sel, returning]);

  /** После решения — к следующей заявке, которая ждёт, и уведомление с «Отменить». */
  const after = (ids: number[], title: string, description: string, tokens: UndoToken[]) => {
    const rest = waiting.filter((e) => !ids.includes(e.i.partId));
    const idx = waiting.findIndex((e) => e.i.partId === ids[0]);
    setSel(rest.length ? rest[Math.min(Math.max(idx, 0), rest.length - 1)].i.partId : null);
    toast(title, {
      description, duration: 12000,
      action: { label: "Отменить", onClick: () => { void managerUndo(tokens).then((u) => { toast(u.ok ? "Решение отменено" : u.error, { tone: u.ok ? "info" : "bad" }); if (u.ok) setSel(ids[0]); }); } },
    });
  };

  /** Решение по заявке на перенос: без отмены, к следующей ждущей. */
  const afterChange = (e: Entry, title: string) => {
    const rest = waiting.filter((x) => x.i.partId !== e.i.partId);
    setSel(rest[0]?.i.partId ?? null);
    toast(title, { description: `${e.p.name}: ${e.i.change?.kindLabel.toLowerCase()}. Запись в журнале` });
  };
  const approve = (e: Entry) => start(async () => {
    if (e.i.change) {
      const r = await managerApproveChange(e.i.change.id);
      if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
      afterChange(e, "Согласовано, перенос ушёл к РО1");
      return;
    }
    const r = await managerApprove(e.i.partId);
    if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
    after([e.i.partId], "Согласовано, заявка ушла к РО1", `${e.p.name}, ${fmtRange(e.i.start, e.i.end)}`, [r.undo]);
  });
  const approveClean = () => start(async () => {
    const r = await managerApproveClean(cleanOnes.map((e) => e.i.partId));
    if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
    after(r.undo.map((t) => t.partId), `Согласовано ${r.undo.length} ${r.undo.length === 1 ? "заявка" : r.undo.length < 5 ? "заявки" : "заявок"}`, "Без конфликтов, ушли к РО1", r.undo);
  });
  const sendBack = (e: Entry, comment: string, substituteId: string | null) => start(async () => {
    if (e.i.change) {
      const r = await managerReturnChange(e.i.change.id, comment);
      if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
      setReturning(false);
      afterChange(e, "Заявка на перенос возвращена сотруднику");
      return;
    }
    const r = await managerReturn(e.i.partId, comment, substituteId);
    if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
    setReturning(false);
    after([e.i.partId], "Возвращено сотруднику", `${e.p.name}, ${fmtRange(e.i.start, e.i.end)}`, [r.undo]);
  });

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div data-tour="team.keys" className="text-[13px] text-muted">
          {waiting.length ? <>Ждут вашего решения: <span className="text-text font-medium">{waiting.length}</span>. Листать — клавиши j и k.</> : "Новых заявок нет."}
        </div>
        <Button data-tour="team.bulk" className="ml-auto" variant="primary" icon={CheckCheck} loading={busy && !returning} disabled={!cleanOnes.length} onClick={approveClean}>
          Согласовать все без конфликтов ({cleanOnes.length})
        </Button>
      </div>

      <div className="grid grid-cols-[380px_minmax(0,1fr)] gap-5 items-start">
        <Surface level="inset" data-tour="team.queue" className="sticky top-[calc(var(--header-h)+16px)] max-h-[calc(100vh-var(--header-h)-32px)] overflow-y-auto">
          <Group title="Проверка как РО1" count={ro1List.length} list={ro1List} sel={sel} onSel={setSel} tone="accent" />
          <Group title="Ждут вас" count={waiting.length} list={waiting} sel={sel} onSel={setSel} tone="accent" />
          <Group title="У РО1" count={atHr.length} list={atHr} sel={sel} onSel={setSel} />
          <Group title="Решено" count={done.length} list={done} sel={sel} onSel={setSel} />
          {notSent.length > 0 && <div className="px-3 pt-3 pb-2 text-[12.5px] text-muted-2">Ещё не отправили план: {notSent.map((p) => p.name).join(", ")}</div>}
        </Surface>

        {current ? (
          <Detail e={current} lane={lane} holidays={holidays} managerId={managerId} busy={busy} hrName={hrName}
            onApprove={() => approve(current)} onReturn={() => setReturning(true)}
            override={current.asRo1 ? <Ro1Actions e={current} busy={busy} start={start} onDone={() => setSel(null)} /> : undefined} />
        ) : !waiting.length ? (
          <Card><EmptyState icon={CheckCheck} title="Всё разобрано" description="Новые заявки команды появятся здесь. Согласованные вами уже у РО1." /></Card>
        ) : (
          <Card><EmptyState icon={InboxIcon} title="Выберите заявку" description="Слева заявки вашей команды." /></Card>
        )}
      </div>

      {current && (
        <ReturnDialog key={current.i.partId} open={returning} onClose={() => setReturning(false)} busy={busy} entry={current} lane={lane}
          onSubmit={(c, sub) => sendBack(current, c, sub)} />
      )}
    </>
  );
}

function Group({ title, count, list, sel, onSel, tone }: { title: string; count: number; list: Entry[]; sel: number | null; onSel: (id: number) => void; tone?: "accent" }) {
  if (!list.length) return null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">{title}</span>
        <Badge tone={tone ?? "neutral"}>{count}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        {list.map((e) => <Row key={e.i.partId} e={e} on={e.i.partId === sel} onClick={() => onSel(e.i.partId)} />)}
      </div>
    </div>
  );
}

function Verdict({ e }: { e: Entry }) {
  if (e.i.change && stageOf(e) !== "approved") return <Pill tone="info" size="sm" icon={ArrowRightLeft} title={`Заявка: ${e.i.change.kindLabel.toLowerCase()}`}>{e.i.change.kindLabel}</Pill>;
  if (e.i.stage === "approved") return <Pill tone="ok" size="sm" icon={Check}>Согласовано</Pill>;
  if (e.i.stage === "returned") return <Pill tone="neutral" size="sm" icon={Undo2}>Возвращено</Pill>;
  if (e.i.exceptionRequest) return <Pill tone="info" size="sm" icon={ShieldQuestion} title="Нарушение регламента: исключение разрешает РО1">Запрос исключения</Pill>;
  if (e.i.verdict === "block") return <Pill tone="bad" size="sm" dot>Запрет</Pill>;
  if (e.i.verdict === "warn") return <Pill tone="warn" size="sm" dot>Внимание</Pill>;
  return <Pill tone="ok" size="sm" dot>Без конфликтов</Pill>;
}

function Row({ e, on, onClick }: { e: Entry; on: boolean; onClick: () => void }) {
  return (
    <Surface nested pad={0} tone="flat" className={cx("transition-colors", on ? "bg-accent-bg!" : "bg-transparent! hover:bg-fill-3!")}>
      <button type="button" data-entry={e.i.partId} onClick={onClick} aria-current={on || undefined}
        className="press r-in w-full flex items-center gap-3 p-2.5 text-left cursor-pointer">
        <Avatar name={e.p.fullName} size={38} />
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="text-[14px] font-medium truncate tracking-[-0.01em]">{e.p.name}</span>
            <span className="text-[11.5px] text-muted-2 shrink-0">часть {e.i.partNo}</span>
          </span>
          <span className="block text-[13px] text-muted tnum mt-0.5">{fmtRange(e.i.start, e.i.end)}, {e.i.days} дн.</span>
        </span>
        <Verdict e={e} />
      </button>
    </Surface>
  );
}

function Detail({ e, lane, holidays, managerId, busy, onApprove, onReturn, hrName, override }: {
  e: Entry; lane: LaneRow[]; holidays: string[]; managerId: string; busy: boolean; onApprove: () => void; onReturn: () => void;
  hrName: string; override?: React.ReactNode;
}) {
  const ch = e.i.change;
  const stg = stageOf(e);
  const open = (ch ? ch.findings : e.i.findings).filter(isOpen);
  const resolved = ch ? [] : e.i.findings.filter((f) => f.level === "exception");
  const regulation = open.some((f) => f.consequence === "exception");
  // запрос исключения — отдельной плашкой над кнопками; его правила из общего списка убираем
  const exRules = (ch ? ch.needsException && !ch.law : e.i.exceptionRequest) ? open.filter((f) => f.consequence === "exception") : [];
  const listed = exRules.length ? open.filter((f) => f.consequence !== "exception") : open;
  const ro1 = deciderLabel(hrName);
  // у переноса окно ленты — от старых до новых дат, в фокусе новые
  const focus = ch?.newStart && ch.newEnd ? { start: ch.newStart, end: ch.newEnd } : { start: e.i.start, end: e.i.end };
  const from = isoAt(ch && ch.newStart && ch.newStart < e.i.start ? ch.newStart : e.i.start, -10);
  const to = isoAt(ch && ch.newEnd && ch.newEnd > e.i.end ? ch.newEnd : e.i.end, 10);
  const sub = e.i.substitute;
  // замещающий может быть не из команды — тогда отдельной строкой
  const people = sub && !lane.some((r) => r.employeeId === sub.id)
    ? [...lane, { employeeId: sub.id, name: sub.name, fullName: sub.fullName, role: "", me: false, parts: sub.parts.map((x) => ({ ...x, days: 0 })) }]
    : lane;
  const rows: MiniLaneRow[] = people.map((r) => {
    const own = r.employeeId === e.p.employeeId;
    const parts: MiniLaneRow["parts"] = own
      ? ch ? [...r.parts.filter((x) => x.start === e.i.start).map((x) => ({ ...x, style: "old" as const })),
        ...(ch.newStart && ch.newEnd ? [{ start: ch.newStart, end: ch.newEnd, tone: "pending" as const, style: "new" as const }] : [])]
        : r.parts.filter((x) => x.start === e.i.start)
      : r.parts.filter((x) => x.tone !== "returned");
    return {
      key: r.employeeId, name: own ? e.p.name : r.name, fullName: r.fullName, candidate: own, note: "на месте",
      near: parts.some((x) => x.tone !== "draft" && x.start <= focus.end && x.end >= focus.start), parts,
      ...(sub?.id === r.employeeId ? { tag: "замещает", clash: sub.away } : {}),
    };
  }).sort((a, b) => Number(b.candidate) - Number(a.candidate) || Number(!!b.tag) - Number(!!a.tag) || Number(b.near) - Number(a.near) || Number(a.key === managerId) - Number(b.key === managerId));
  const away = rows.filter((r) => !r.candidate && r.near);

  return (
    <Card pad={24} className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <Avatar name={e.p.fullName} size={52} />
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-semibold tracking-[-0.025em] leading-tight">{e.p.fullName}</div>
          <div className="text-[13.5px] text-muted mt-0.5">{e.p.position}{e.p.department ? `, ${e.p.department}` : ""}{e.p.submittedAt ? `. Подал ${fmtStamp(e.p.submittedAt)}` : ""}</div>
        </div>
        <Pill tone={stg === "manager" ? "accent" : stg === "approved" ? "ok" : "neutral"}>{stg === "manager" ? "Ждёт вас" : STAGE_LABEL[stg]}</Pill>
      </div>

      {ch ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Pill tone="info" icon={ArrowRightLeft}>{ch.kindLabel}</Pill>
            <span className="text-[13px] text-muted">часть {e.i.partNo}, подана {fmtDate(ch.requestedOn)}, основание: {ch.reason}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-muted">было</span>
            <span className="text-[22px] font-semibold tnum line-through decoration-muted-2/60 text-muted">{fmtRange(ch.oldStart, ch.oldEnd)}</span>
            <ArrowRight size={18} className="text-muted-2" />
            {ch.kind === "cancel" ? <span className="text-[22px] font-semibold text-bad">отказ от части</span> : (
              <>
                <span className="text-[13px] text-muted">станет</span>
                <span className="text-[28px] font-semibold tracking-[-0.03em] tnum">{ch.newStart && ch.newEnd ? fmtRange(ch.newStart, ch.newEnd) : "—"}</span>
              </>
            )}
          </div>
          {ch.note && (
            <Surface nested tone="flat" className="bg-info-bg!">
              <div className="flex gap-3">
                <span aria-hidden className="w-[3px] self-stretch rounded-full bg-info shrink-0" />
                <div><div className="text-[12px] font-medium text-info mb-0.5">Причина сотрудника</div><blockquote className="text-[14px] leading-snug">«{ch.note}»</blockquote></div>
              </div>
            </Surface>
          )}
        </div>
      ) : (
        <div className="flex items-baseline gap-3">
          <span className="text-[32px] font-semibold tracking-[-0.035em] tnum leading-none">{fmtRange(e.i.start, e.i.end)}</span>
          <span className="text-[15px] text-muted tnum">часть {e.i.partNo}, {e.i.days} дн.</span>
        </div>
      )}
      <div className="-mt-3 flex flex-col gap-2"><LeaveKindLine kind={e.i.kind} /><SubstituteLine s={sub} /></div>

      <section data-tour="team.findings" className="flex flex-col gap-2">
        {ch && <div className="text-[13px] font-medium">Проверка новых дат</div>}
        {!listed.length && !exRules.length && (
          <Surface nested tone="flat" className="bg-ok-bg!">
            <div className="flex items-center gap-2.5 text-[14px] text-ok"><CircleCheck size={18} />Регламент и ТК выполнены, конфликтов нет.</div>
          </Surface>
        )}
        {[...listed, ...resolved].map((f, k) => {
          const l = ICON[f.level as keyof typeof ICON];
          const Icon = l.icon;
          return (
            <Surface key={k} nested tone="flat" className={l.bg}>
              <div className="flex gap-2.5">
                <Icon size={18} className={cx("shrink-0 mt-px", l.cls)} />
                <div className="min-w-0">
                  <div className="text-[14px] font-medium">{f.title}</div>
                  <div className="text-[13.5px] text-text-2">{f.message.replace(/\. Разрешено исключением HR:.*$/, "")}</div>
                  {f.people.length > 0 && <div className="text-[13px] mt-0.5"><span className="text-muted">{f.ruleCode === "R02" ? "Нет на месте" : f.ruleCode === "R15" ? "Замещающий" : "Одновременно"}:</span> {f.people.join(", ")}</div>}
                  {f.exceptionReason && <div className="text-[13px] text-ok mt-0.5">Исключение РО1: {f.exceptionReason}</div>}
                </div>
              </div>
            </Surface>
          );
        })}
      </section>

      <section data-tour="team.lane">
        <div className="flex items-baseline gap-2 mb-2">
          <h3 className="text-[15px] font-semibold tracking-[-0.015em]">Команда в эти даты</h3>
          <span className="text-[13px] text-muted">{away.length ? `в отпуске: ${away.map((r) => r.name).join(", ")}` : "все на месте"}</span>
        </div>
        <MiniLane from={from} to={to} rows={rows} focus={focus} holidays={holidays} nameWidth={200} />
      </section>

      {exRules.length > 0 && (
        <ExceptionCallout rules={exRules} note={ch ? ch.note : e.p.exceptionNote}
          footer={e.asRo1 ? "Вы проверяете за РО1: исключение разрешаете вы, с обязательной причиной."
            : stg === "manager" ? `Вы согласуете со стороны отдела. Окончательно исключение разрешает ${sentence(ro1)}`
            : `Окончательно исключение разрешает ${sentence(ro1)}`} />
      )}

      {override ?? (stg === "manager" ? (
        <div data-tour="team.decision" className="flex items-center gap-2 pt-1">
          <Button size="lg" icon={Undo2} onClick={onReturn}>Вернуть с комментарием</Button>
          <Button size="lg" variant="primary" icon={Check} loading={busy} onClick={onApprove}>
            {ch ? `Согласовать ${ch.kindLabel.toLowerCase()}` : "Согласовать"}
          </Button>
          <span className="text-[12.5px] text-muted ml-2 max-w-[34ch]">
            {ch?.law ? `Новые даты нарушают норму ТК: ${ro1} перенос отклонит, лучше вернуть`
              : exRules.length ? null
              : regulation ? `Отступление от регламента решает ${ro1}: после вас заявка уйдёт в отдел кадров` : `После вас окончательно решает ${ro1}`}
          </span>
        </div>
      ) : (
        <div className="text-[13px] text-muted">
          {stg === "hr" ? `Вы согласовали, решение за ${sentence(ro1)}` : stg === "approved" ? "Часть в графике." : "Часть у сотрудника: ждём новые даты."}
        </div>
      ))}
    </Card>
  );
}

function ReturnDialog({ open, onClose, busy, entry, lane, onSubmit }: {
  open: boolean; onClose: () => void; busy: boolean; entry: Entry; lane: LaneRow[]; onSubmit: (c: string, substituteId: string | null) => void;
}) {
  const [comment, setComment] = useState("");
  const [sub, setSub] = useState("keep");
  const short = comment.trim().length < 5;
  const current = entry.i.substitute;
  const forChange = !!entry.i.change;
  // кого можно предложить: команда и вы сами; свободные в эти даты — выше
  const free = (r: LaneRow) => !r.parts.some((x) => x.tone !== "draft" && x.tone !== "returned" && x.start <= entry.i.end && x.end >= entry.i.start);
  const options = [
    { value: "keep", label: current ? `Оставить: ${current.name}` : "Не предлагать", description: undefined as string | undefined, leading: undefined as React.ReactNode },
    ...lane.filter((r) => r.employeeId !== entry.p.employeeId && r.employeeId !== current?.id)
      .sort((a, b) => Number(free(b)) - Number(free(a)))
      .map((r) => ({ value: r.employeeId, label: r.me ? `${r.name} (руководитель)` : r.name, description: free(r) ? "на месте в эти даты" : "в отпуске в эти даты",
        leading: <Avatar name={r.fullName} size={20} /> })),
  ];
  return (
    <Dialog open={open} onClose={onClose} persistent={busy} title="Вернуть сотруднику"
      description={`${entry.p.fullName}, часть ${entry.i.partNo}: ${fmtRange(entry.i.start, entry.i.end)}.`}
      footer={<>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" icon={Undo2} loading={busy} disabled={short} onClick={() => onSubmit(comment, sub === "keep" ? null : sub)}>Вернуть</Button>
      </>}>
      <Field label="Комментарий" hint={short ? "Обязательно: сотрудник увидит, что поменять" : undefined}>
        <Textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={4} autoFocus
          placeholder="Например: в сентябре закрываем квартал, перенесите на октябрь" />
      </Field>
      {!forChange && <div className="mt-4">
        <div className="text-[13px] font-medium text-text-2 px-0.5">Предложить другого замещающего</div>
        <div className="text-[12px] text-muted px-0.5 mb-2">Необязательно. Сотрудник увидит предложение и сам поправит заявку</div>
        <div role="radiogroup" aria-label="Замещающий" className="flex flex-col gap-1">
          {options.map((o) => (
            <Surface key={o.value} nested pad={0} tone="flat" className={cx(sub === o.value && "bg-accent-bg!")}>
              <button type="button" role="radio" aria-checked={sub === o.value} aria-label={o.description ? `${o.label}, ${o.description}` : o.label} onClick={() => setSub(o.value)}
                className="press r-in w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer">
                {o.leading ?? <span className="w-5" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px]">{o.label}</span>
                  {o.description && <span className={cx("block text-[12px]", o.description.startsWith("в отпуске") ? "text-bad" : "text-muted")}>{o.description}</span>}
                </span>
                {sub === o.value && <Check size={16} className="text-accent-strong shrink-0" />}
              </button>
            </Surface>
          ))}
        </div>
      </div>}
    </Dialog>
  );
}

/** Проверка отпуска РО1 вместо отдела кадров: окончательное решение — согласовать, исключением или вернуть. */
function Ro1Actions({ e, busy, start, onDone }: { e: Entry; busy: boolean; start: (fn: () => Promise<void>) => void; onDone: () => void }) {
  const [dialog, setDialog] = useState<"exception" | "return" | null>(null);
  const [text, setText] = useState("");
  const ch = e.i.change;
  const needsException = ch ? ch.needsException : e.i.findings.some((f) => (f.level === "block" || f.level === "warn") && f.consequence === "exception");
  const law = ch ? ch.law : e.i.findings.some((f) => (f.level === "block" || f.level === "warn") && f.consequence === "law");
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string } | { ok: true; undo: unknown }>, title: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast(r.error, { tone: "bad" }); return; }
    setDialog(null); setText(""); onDone();
    toast(title, { description: `${e.p.name}: решение окончательное, запись в журнале` });
  });
  const approve = () => run(() => (ch ? hrApproveChange(ch.id) : hrApprovePart(e.i.partId)), "Согласовано");
  const allow = () => run(() => (ch ? hrApproveChangeWithException(ch.id, text) : hrApproveWithException(e.i.partId, text)), "Разрешено исключением");
  const back = () => run(() => (ch ? hrRejectChange(ch.id, text) : hrReturnPart(e.i.partId, text)), ch ? "Перенос отклонён" : "Возвращено сотруднику");
  const short = text.trim().length < 5;
  return (
    <div data-tour="team.decision" className="flex items-center gap-2 pt-1 flex-wrap">
      <Button size="lg" icon={Undo2} onClick={() => setDialog("return")}>{ch ? "Отклонить" : "Вернуть"}</Button>
      {law ? null : needsException
        ? <Button size="lg" variant="primary" icon={ShieldCheck} onClick={() => setDialog("exception")}>Разрешить исключением</Button>
        : <Button size="lg" variant="primary" icon={Check} loading={busy} onClick={approve}>Согласовать</Button>}
      <span className="text-[12.5px] text-muted ml-2 max-w-[38ch]">Вы проверяете отпуск РО1 вместо отдела кадров: решение окончательное</span>
      <Dialog open={dialog !== null} onClose={() => setDialog(null)} persistent={busy}
        title={dialog === "exception" ? "Разрешить исключением" : ch ? "Отклонить перенос" : "Вернуть сотруднику"}
        description={dialog === "exception" ? "Причина попадёт в журнал исключений" : "Сотрудник увидит комментарий"}
        footer={<>
          <Button onClick={() => setDialog(null)}>Отмена</Button>
          <Button variant="primary" loading={busy} disabled={short} onClick={dialog === "exception" ? allow : back}>{dialog === "exception" ? "Разрешить" : ch ? "Отклонить" : "Вернуть"}</Button>
        </>}>
        <Field label={dialog === "exception" ? "Причина" : "Комментарий"} hint={short ? "Обязательно" : undefined}>
          <Textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={3} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}
