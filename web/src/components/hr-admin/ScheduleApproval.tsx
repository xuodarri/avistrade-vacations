"use client";

/**
 * Утверждение графика на «Сборе графика» (ч. 1–2 ст. 168 ТК) — по полугодиям, как в регламенте
 * (юридический риск: по ТК график годовой). Маршрут шагами, чек-лист готовности,
 * отправка утверждающему (`submitSchedule` из actions/route.ts), возврат с комментарием и итог —
 * «утверждён и разослан». Утверждает и возвращает директор на своём экране.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronRight, CircleCheck, Send, ShieldAlert, TriangleAlert, Undo2 } from "lucide-react";
import { Button, Card, DatePicker, Dialog, Field, Input, Pill, SegmentedControl, Surface, Textarea, Tooltip, cx, toast } from "@/components/kit";
import { SCHEDULE_HALF_LABEL, SCHEDULE_STATUS_LABEL, type Schedule, type ScheduleHalf } from "@/server/db/types";
import { submitSchedule } from "@/server/actions/route";
import { plural, shortName } from "./meta";

export interface Readiness {
  notSubmitted: number;
  /** ФИО не подавших — в чек-листе, если их 1–3 */
  notSubmittedNames: string[];
  atManager: number;
  /** Чьи заявки ждут руководителя */
  atManagerNames: string[];
  conflicts: number;
  exceptionRequests: number;
  today: string;
  /** Срок утверждения полугодия по регламенту: 15 января или 15 июля */
  deadline: string;
}

const TZ = "Europe/Minsk";
const dmy = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
const stamp = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dateLong = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)).replace(/\s*г\.$/, "");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function ScheduleApproval({ halves, approver, unionRequired, names, working, ready: base }: {
  halves: Schedule[]; approver: string; unionRequired: boolean; names: Record<string, string>; working: number; ready: Omit<Readiness, "deadline">;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // по умолчанию — первое неутверждённое полугодие
  const [half, setHalf] = useState<ScheduleHalf>(halves.find((h) => h.status !== "approved")?.half ?? 1);
  const s = halves.find((h) => h.half === half) ?? halves[0];
  const ready: Readiness = { ...base, deadline: s.deadline };
  const name = (id: string | null) => (id ? shortName(names[id] ?? id) : "");

  const steps = [
    { key: "collect", label: "Сбор пожеланий" },
    ...(unionRequired ? [{ key: "union", label: "Профсоюз" }] : []),
    { key: "pending", label: `Утверждает ${shortName(approver)}` },
    { key: "approved", label: "Утверждён и разослан" },
  ];
  const current = s.status === "approved" ? "approved" : s.status === "pending" ? "pending" : "collect";
  const at = steps.findIndex((x) => x.key === current);

  const left = daysBetween(ready.today, ready.deadline);
  // пункт — факт, а не цель: выполнено — «Все подали план», нет — «Не подал план: 1 — Лис Н. П.»
  const who = (list: string[]) => (list.length && list.length <= 3 ? ` — ${list.map(shortName).join(", ")}` : "");
  const n = (k: number, f: [string, string, string]) => `${k} ${plural(k, f)}`;
  const checks: { ok: boolean; text: string; link?: { label: string; href: string } }[] = [
    ready.notSubmitted === 0 ? { ok: true, text: "Все подали план" }
      : { ok: false, text: `${plural(ready.notSubmitted, ["Не подал", "Не подали", "Не подали"])} план: ${ready.notSubmitted}${who(ready.notSubmittedNames)}`, link: { label: "Напомнить", href: "#missing" } },
    ready.atManager === 0 ? { ok: true, text: "Заявок у руководителей нет" }
      : { ok: false, text: `${plural(ready.atManager, ["Ждёт", "Ждут", "Ждут"])} руководителя: ${n(ready.atManager, ["заявка", "заявки", "заявок"])}${who(ready.atManagerNames)}`, link: { label: "Поторопить", href: "#pending" } },
    ready.conflicts === 0 ? { ok: true, text: "Открытых конфликтов нет" }
      : { ok: false, text: `Открытых конфликтов: ${ready.conflicts}`, link: { label: "Разобрать в графике", href: "/hr" } },
    ready.exceptionRequests === 0 ? { ok: true, text: "Запросов исключений нет" }
      : { ok: false, text: `Запросов исключений: ${ready.exceptionRequests}`, link: { label: "Решить в графике", href: "/hr" } },
    left >= 0 ? { ok: true, text: `Срок по регламенту — ${dateLong(ready.deadline)}, ${plural(left, ["остался", "осталось", "осталось"])} ${n(left, ["день", "дня", "дней"])}` }
      : { ok: false, text: `Срок по регламенту — ${dateLong(ready.deadline)} — пропущен на ${n(-left, ["день", "дня", "дней"])}` },
  ];

  return (
    <Card pad={24} className="flex flex-col gap-5" data-tour="dash.schedule">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl value={String(half) as "1" | "2"} onChange={(v) => setHalf(Number(v) as ScheduleHalf)} aria-label="Полугодие"
          options={halves.map((h) => ({ value: String(h.half) as "1" | "2", label: `${SCHEDULE_HALF_LABEL[h.half]}: ${SCHEDULE_STATUS_LABEL[h.status].toLowerCase()}` }))} />
        <span className="text-[13px] text-muted">утвердить до {dmy(s.deadline)}</span>
        <Tooltip content="Регламент: график на полугодие — до 15 января и до 15 июля. По ч. 2 ст. 168 ТК график утверждается на календарный год до 5 января; иной срок — только по коллективному договору или с профсоюзом.">
          <span tabIndex={0} className="ml-auto"><Pill size="sm" tone="bad" icon={ShieldAlert}>расходится с ТК</Pill></span>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((x, i) => (
          <span key={x.key} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-muted-2" />}
            <span className={cx("inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium whitespace-nowrap",
              i < at || (i === at && current === "approved") ? "bg-ok-bg text-ok" : i === at ? "bg-accent text-white shadow-1" : "bg-fill-3 text-muted")}>
              {(i < at || (i === at && current === "approved")) && <Check size={14} strokeWidth={2.5} />}{x.label}
            </span>
          </span>
        ))}
      </div>

      {s.status === "approved" && s.decidedAt ? (
        <div className="flex flex-wrap items-center gap-3">
          <CircleCheck size={22} className="text-ok shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-semibold tracking-[-0.015em]">График утверждён {dmy(s.decidedAt)}, разослан {working} {plural(working, ["сотруднику", "сотрудникам", "сотрудникам"])}</div>
            <div className="text-[13px] text-muted mt-0.5">
              Утвердил {name(s.decidedBy)}{s.unionProtocol ? `, профсоюз — протокол № ${s.unionProtocol}${s.unionDate ? ` от ${dmy(s.unionDate)}` : ""}` : ""}; каждый работник получил уведомление (ч. 2 ст. 168 ТК)
            </div>
          </div>
          <Button variant="tinted" onClick={() => router.push("/hr/log?type=schedule")}>Журнал</Button>
        </div>
      ) : s.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Send size={20} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-semibold tracking-[-0.015em]">График на утверждении, утверждает {shortName(approver)}</div>
            <div className="text-[13px] text-muted mt-0.5">
              Отправил {name(s.submittedBy)}{s.submittedAt ? ` ${stamp(s.submittedAt)}` : ""}, уведомление ушло.
              {s.unionProtocol ? ` Профсоюз: протокол № ${s.unionProtocol}${s.unionDate ? ` от ${dmy(s.unionDate)}` : ""}.` : ""}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {s.status === "returned" && (
            <Surface nested pad={14} tone="tinted" className="flex gap-3">
              <Undo2 size={18} className="text-warn shrink-0 mt-0.5" />
              <div className="text-[14px] leading-relaxed">
                <b className="font-semibold">{name(s.decidedBy)} вернул график{s.decidedAt ? ` ${stamp(s.decidedAt)}` : ""}:</b> «{s.comment}»
              </div>
            </Surface>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
            {checks.map((c) => (
              <div key={c.text} className="flex items-start gap-2.5 text-[14px]">
                {c.ok ? <CircleCheck size={18} className="text-ok shrink-0 mt-px" /> : <TriangleAlert size={18} className="text-warn shrink-0 mt-px" />}
                <span>
                  {c.text}
                  {c.link && <> <a href={c.link.href} className="text-accent-strong font-medium hover:underline whitespace-nowrap"
                    onClick={(e) => { if (c.link!.href.startsWith("/")) { e.preventDefault(); router.push(c.link!.href); } }}>{c.link.label}</a></>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={Send} onClick={() => setOpen(true)}>
              {s.status === "returned" ? "Отправить снова" : "Отправить на утверждение"}
            </Button>
            <span className="text-[13px] text-muted">Утверждает {shortName(approver)}{unionRequired ? ", перед этим — согласование с профсоюзом" : ""}</span>
          </div>
        </div>
      )}

      <SubmitDialog open={open} onClose={() => setOpen(false)} approver={approver} unionRequired={unionRequired} half={half}
        notReady={checks.filter((c) => !c.ok).map((c) => c.text)}
        onDone={() => { setOpen(false); router.refresh(); }} />
    </Card>
  );
}

function SubmitDialog({ open, onClose, approver, unionRequired, half, notReady, onDone }: {
  open: boolean; onClose: () => void; approver: string; unionRequired: boolean; half: ScheduleHalf; notReady: string[]; onDone: () => void;
}) {
  const [unionDate, setUnionDate] = useState<string | null>(null);
  const [protocol, setProtocol] = useState("");
  const [comment, setComment] = useState("");
  const [busy, start] = useTransition();
  const canSend = !unionRequired || (!!unionDate && !!protocol.trim());
  const send = () => start(async () => {
    try {
      await submitSchedule({ half, unionDate, unionProtocol: protocol || null, comment: comment || null });
      toast(`${SCHEDULE_HALF_LABEL[half]}: график отправлен на утверждение`, { description: `${shortName(approver)} получил уведомление — записано в журнал` });
      onDone();
    } catch (e) {
      toast("Не удалось отправить", { tone: "bad", description: e instanceof Error ? e.message : undefined });
    }
  });
  return (
    <Dialog open={open} onClose={onClose} width={520} title={`Отправить график на ${SCHEDULE_HALF_LABEL[half]} на утверждение?`}
      description={`Пока график на утверждении, изменения в нём лучше не вносить. Утверждает ${shortName(approver)}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary" icon={Send} onClick={send} loading={busy} disabled={!canSend}>{notReady.length ? "Отправить всё равно" : "Отправить"}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        {notReady.length > 0 && (
          <Surface nested pad={14} tone="tinted" className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold flex items-center gap-2"><TriangleAlert size={16} className="text-warn" />Не всё готово</span>
            {notReady.map((x) => <span key={x} className="text-[13px] text-text-2">{x}</span>)}
          </Surface>
        )}
        {unionRequired && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Дата протокола профсоюза"><DatePicker value={unionDate} onChange={setUnionDate} max={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Номер протокола"><Input value={protocol} onChange={(e) => setProtocol(e.target.value)} placeholder="Например, 14" /></Field>
          </div>
        )}
        <Field label="Комментарий для утверждающего" hint="Необязательно">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Например: два запроса исключений решены в пользу сотрудников" />
        </Field>
      </div>
    </Dialog>
  );
}
