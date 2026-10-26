"use client";

/**
 * Заявка на изменение согласованной части: перенести, сократить или отменить. Даты тянутся в
 * календаре (старые видны бледным «было»), здесь — вид изменения, обязательная причина и проверка
 * новых дат движком. Позже чем за 14 дней до начала — исключение: отправка через диалог с обоснованием.
 */
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button, Dialog, Field, SegmentedControl, Surface, Textarea, toast } from "@/components/kit";
import { checkMyChange } from "@/server/actions/plan";
import { requestChange } from "@/server/actions/changes";
import { rangeText } from "./cal";
import { Check, verdictOf, type Result } from "./PartEditor";
import { usePlan, type Part } from "./state";

export type ChangeKind = "move" | "shorten" | "cancel";
const KINDS: { value: ChangeKind; label: string; send: string }[] = [
  { value: "move", label: "Перенести", send: "Отправить заявку на перенос" },
  { value: "shorten", label: "Сократить", send: "Отправить заявку на сокращение" },
  { value: "cancel", label: "Отменить часть", send: "Отправить заявку на отмену" },
];
const HINT: Record<ChangeKind, string> = {
  move: "Потяните края в календаре на новые даты.",
  shorten: "Сдвиньте края внутрь прежних дат — освободившиеся дни вернутся в остаток.",
  cancel: "Часть уйдёт из графика, её дни вернутся в остаток отпуска.",
};

export function ChangeEditor({ part, index, kind, range, onKind, onRange, onBack, onSent }: {
  part: Part; index: number; kind: ChangeKind;
  /** Новые даты из календаря (у отмены не нужны) */
  range: { start: string; end: string } | null;
  onKind: (k: ChangeKind) => void;
  onRange: (r: { start: string; end: string }) => void;
  /** Назад к просмотру части без заявки */
  onBack: () => void;
  onSent: () => void;
}) {
  const p = usePlan();
  const [note, setNote] = useState("");
  const [why, setWhy] = useState("");
  const [ask, setAsk] = useState(false);
  const [sending, setSending] = useState(false);

  const dates = kind === "cancel" ? null : range;
  const same = !!dates && dates.start === part.start && dates.end === part.end;
  const inside = !dates || (dates.start >= part.start && dates.end <= part.end);
  const shorter = !!dates && p.days({ type: part.type, ...dates }) < p.days(part);
  const datesError = kind === "move" && same ? "Выберите новые даты — потяните края в календаре"
    : kind === "shorten" && (!inside || !shorter) ? "Сокращённая часть должна лежать внутри прежних дат и быть короче" : null;

  // проверка новых дат движком (у отмены — план без части)
  const key = part.id && !datesError ? JSON.stringify([kind, dates]) : "";
  const [res, setRes] = useState<(Result & { canSubmit: boolean; needsException: boolean }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!key || !part.id) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await checkMyChange(part.id!, kind, dates?.start ?? null, dates?.end ?? null);
        if (id !== seq.current) return;
        const all = r.check.findings;
        setRes({ key, findings: all.filter((f) => f.level !== "ok"), all, windows: r.windows, trims: [], canSubmit: r.check.canSubmit, needsException: r.check.needsException });
        setFailed(false);
      } catch {
        if (id === seq.current) setFailed(true);
      }
    }, 200);
    return () => clearTimeout(t);
    // kind и dates входят в key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const checking = !!key && res?.key !== key && !failed;
  const verdict = res && !checking ? verdictOf(res.findings) : "ok";
  const label = KINDS.find((k) => k.value === kind)!.send;

  const send = async (justification?: string) => {
    if (!part.id) return;
    setSending(true);
    try {
      const text = justification ? `${note.trim()}\n\nПочему нужны именно эти даты: ${justification}` : note.trim();
      const c = await requestChange({ partId: part.id, kind, newStart: dates?.start ?? null, newEnd: dates?.end ?? null, note: text });
      p.setChange(index, {
        id: c.id, kind: c.kind, newStart: c.newStart, newEnd: c.newEnd, status: c.status, stage: c.stage, note: c.note, decisionNote: c.decisionNote,
      });
      toast(kind === "cancel" ? "Заявка на отмену части отправлена" : `Заявка отправлена: ${rangeText(c.newStart!, c.newEnd!)}`,
        { description: c.stage === "manager" ? `Сначала её посмотрит руководитель, потом РО1 — ${p.plan.ro1}` : `Решение примет РО1 — ${p.plan.ro1}` });
      setAsk(false);
      onSent();
    } catch (e) {
      toast("Заявка не отправлена", { tone: "bad", description: e instanceof Error ? e.message : "Попробуйте ещё раз" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="@container">
        <div className="grid gap-6 @min-[720px]:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
          {/* Параметры заявки */}
          <div className="order-2 @min-[720px]:order-1 flex flex-col gap-4 min-w-0">
            <Field label="Что изменить" hint={datesError ?? HINT[kind]} error={undefined}>
              <SegmentedControl size="sm" block value={kind} onChange={(k) => {
                onKind(k);
                if (k !== "cancel" && kind === "cancel") onRange({ start: part.start, end: part.end });
              }} options={KINDS.map(({ value, label: l }) => ({ value, label: l }))} />
            </Field>
            <Field label="Причина" hint="Обязательно: руководитель и РО1 увидят её в заявке">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Причина изменения"
                placeholder="Например: семейные обстоятельства, в июне не получается" />
            </Field>
          </div>

          {/* Проверка */}
          <Surface nested tone="tinted" pad={16} className="order-1 @min-[720px]:order-2 min-w-0" aria-live="polite">
            {datesError ? (
              <p className="text-[13px] text-text-2">{datesError}</p>
            ) : (
              <Check okTitle="Можно отправить заявку" verdict={verdict} checking={checking} failed={failed} res={res} trims={[]} subs={[]} subFree={null}
                range={dates ?? { start: part.start, end: part.end }}
                onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }}
                onWindow={(w) => onRange({ start: w.start, end: w.end })} />
            )}
          </Surface>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t-[0.5px] border-line">
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onBack}>Отменить</Button>
          <Button variant="primary" icon={Send} loading={sending}
            disabled={!!datesError || checking || failed || !note.trim() || verdict === "law" || (res ? !res.canSubmit : true)}
            title={!note.trim() ? "Укажите причину" : undefined}
            onClick={() => { if (res?.needsException) { setWhy(""); setAsk(true); } else void send(); }}>
            {label}
          </Button>
        </div>
      </div>

      <Dialog open={ask} onClose={() => setAsk(false)} width={520} title="Отправить с отступлением от регламента?"
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(false)}>Вернуться к заявке</Button>
          <Button variant="primary" disabled={!why.trim()} loading={sending} onClick={() => void send(why.trim())}>Отправить на согласование исключения</Button>
        </>}>
        <div className="flex flex-col gap-3 text-[14px] leading-snug">
          <p className="text-text-2">Заявка расходится с правилами компании:</p>
          <ul className="flex flex-col gap-1.5">
            {res?.findings.filter((f) => f.consequence === "exception").map((f) => (
              <li key={f.ruleCode + f.message} className="text-[13.5px]">{f.message.replace(/^Част[ьи] [\d, и]+: /, "")}</li>
            ))}
          </ul>
          <p className="text-text-2">
            Подать можно: решение примет РО1 — {p.plan.ro1}. Нормы Трудового кодекса исключением не меняются.
          </p>
          <Field label="Почему нужны именно эти даты" hint="Например: путёвка куплена заранее, совпадает с отпуском супруга">
            <Textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Почему нужны именно эти даты" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
