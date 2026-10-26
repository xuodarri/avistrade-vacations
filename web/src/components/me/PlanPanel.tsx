"use client";

/**
 * Липкая панель «План на 2027»: сколько дней распланировано, правила плана галочками, отправка,
 * маршрут согласования и ссылки на правила группы и историю (открываются шторкой справа).
 */
import { useEffect, useState } from "react";
import { BookOpen, Check, CircleCheck, CircleX, History, Info, Send, TriangleAlert } from "lucide-react";
import { Button, CalendarLegend, Card, Dialog, Divider, Field, Sheet, Skeleton, Textarea, Tooltip, cx, type Tone } from "@/components/kit";
import { getMyHistory } from "@/server/actions/plan";
import { fmtStamp } from "@/lib/dates";
import { daysText, plural, rank, worse } from "./cal";
import { usePlan } from "./state";
import type { HistoryItem, Level, MyCheck, MyRequest } from "./types";

export const REQUEST_LOOK: Record<"none" | MyRequest["status"], { label: string; tone: Tone }> = {
  none: { label: "Не начат", tone: "neutral" },
  draft: { label: "Черновик", tone: "neutral" },
  submitted: { label: "У руководителя", tone: "info" },
  approved: { label: "Утверждён", tone: "ok" },
  returned: { label: "Возвращён", tone: "warn" },
};

export function PlanPanel() {
  const p = usePlan();
  const [sheet, setSheet] = useState<"rules" | "history" | null>(null);

  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-[calc(var(--header-h)+16px)]">
      <Card className="flex flex-col gap-4" data-tour="me.plan">
        <div className="flex items-center gap-2 px-1 pt-1">
          <h2 className="text-[19px] font-semibold tracking-[-0.022em]">План на {p.year}</h2>
        </div>
        <DaysRing />
        <Divider />
        <RulesChecklist check={p.check} dim={p.saving} />
        <SendBlock />
        <Divider />
        <Route />
      </Card>
      <div className="flex gap-2">
        <Button variant="tinted" icon={BookOpen} block onClick={() => setSheet("rules")}>Правила группы</Button>
        <Button variant="tinted" icon={History} block onClick={() => setSheet("history")}>История</Button>
      </div>
      <Sheet open={sheet === "rules"} onClose={() => setSheet(null)} title="Правила вашей группы" description={groupLine(p.plan.group, p.beneficiary)}>
        <RulesSheet />
      </Sheet>
      <Sheet open={sheet === "history"} onClose={() => setSheet(null)} title="История плана" description="Каждое сохранение, отправка и решение — из журнала">
        {sheet === "history" && <HistorySheet />}
      </Sheet>
    </div>
  );
}

function groupLine(g: { label: string; limit: number }, beneficiary: boolean) {
  if (beneficiary) return "Лимиты группы на вас не действуют: льгота ч. 4 ст. 168 ТК";
  return g.limit ? `${g.label}: одновременно в отпуске не больше ${g.limit}` : g.label;
}

/** Кольцо «X из 24 дней» */
function DaysRing() {
  const p = usePlan();
  const norm = p.plan.norm, total = p.totalMain;
  const over = total > norm, done = total === norm;
  const color = over ? "var(--bad)" : done ? "var(--ok)" : "var(--vacation)";
  const R = 34, C = 2 * Math.PI * R;
  const frac = Math.min(1, total / norm);
  return (
    <div className="flex items-center gap-4 px-1">
      <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0 -rotate-90" aria-hidden>
        <circle cx="42" cy="42" r={R} fill="none" stroke="var(--fill-2)" strokeWidth="9" />
        <circle cx="42" cy="42" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${C * frac} ${C}`} style={{ transition: "stroke-dasharray var(--dur-3) var(--ease-spring), stroke var(--dur-2)" }} />
      </svg>
      <div className="min-w-0">
        <div className="text-[28px] leading-none font-semibold tracking-[-0.03em] tnum">
          {total}<span className="text-[17px] text-muted font-medium"> из {norm}</span>
        </div>
        <div className="text-[13px] text-muted mt-1">{plural(norm, "дня", "дней", "дней")} основного отпуска</div>
        <div className={cx("text-[12.5px] mt-1 font-medium", over ? "text-bad" : done ? "text-ok" : "text-warn")}>
          {over ? `Больше нормы на ${daysText(total - norm)}` : done ? "Все дни распланированы" : `Осталось ${daysText(norm - total)}`}
        </div>
      </div>
    </div>
  );
}

interface RuleRow { code: string; title: string; level: Level; messages: string[]; basis: string }
export function ruleRows(check: MyCheck): RuleRow[] {
  const by = new Map<string, RuleRow>();
  for (const f of check.findings) {
    // запрет регламента — не «нельзя», а «нужно исключение»: значок жёлтый, как у пометки
    const level: Level = f.level === "block" && f.consequence === "exception" ? "warn" : f.level;
    const r = by.get(f.ruleCode);
    if (!r) { by.set(f.ruleCode, { code: f.ruleCode, title: f.title, level, messages: [f.message], basis: f.basis }); continue; }
    r.level = worse(r.level, level);
    if (!r.messages.includes(f.message)) r.messages.push(f.message);
  }
  return [...by.values()].sort((a, b) => rank(b.level) - rank(a.level));
}

const ICON: Record<Level, { Icon: typeof Check; cls: string }> = {
  ok: { Icon: Check, cls: "bg-ok-bg text-ok" },
  exception: { Icon: Check, cls: "bg-info-bg text-info" },
  info: { Icon: Info, cls: "bg-info-bg text-info" },
  warn: { Icon: TriangleAlert, cls: "bg-warn-bg text-warn" },
  block: { Icon: CircleX, cls: "bg-bad-bg text-bad" },
};

function RulesChecklist({ check, dim }: { check: MyCheck; dim: boolean }) {
  const p = usePlan();
  if (!p.parts.length) return <p className="px-1 text-[13px] text-muted">Правила проверим, как только появится первая часть.</p>;
  return (
    <ul className={cx("flex flex-col gap-2.5 px-1 transition-opacity", dim && "opacity-50")} aria-busy={dim}>
      {ruleRows(check).map((r) => {
        const { Icon, cls } = ICON[r.level];
        const showMsg = rank(r.level) >= rank("warn");
        return (
          <li key={r.code}>
            <Tooltip content={<>{r.messages.join(". ")}{r.basis && <div className="opacity-70 mt-0.5">{r.basis}</div>}</>}>
              <div className="flex gap-2.5 items-start">
                <span className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0", cls)}>
                  <Icon size={12} strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] leading-5">{r.title}</div>
                  {showMsg && r.messages.map((m) => <div key={m} className="text-[12.5px] text-muted leading-snug">{m}</div>)}
                </div>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Отправка плана. Нарушения ТК не пускают (кнопка неактивна, рядом — что исправить). Расхождения с
 * регламентом — не запрет: перед отправкой диалог со списком и обязательным обоснованием.
 */
function SendBlock() {
  const p = usePlan();
  const status = p.request?.status;
  const law = p.check.findings.filter((f) => (f.level === "block" || f.level === "warn") && f.consequence === "law");
  const exceptions = p.check.findings.filter((f) => (f.level === "block" || f.level === "warn") && f.consequence === "exception");
  const warns = p.check.findings.filter((f) => f.level === "warn" && f.consequence !== "exception" && f.consequence !== "law");
  const [ask, setAsk] = useState<{ exception: string[] } | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  let note: string, can = false, label = "Отправить на согласование";
  if (p.locked) { label = "План утверждён"; note = "Перенос согласованного отпуска — через РО1: откройте часть и нажмите «Запросить перенос»."; }
  else if (!p.parts.length) note = "Добавьте хотя бы одну часть.";
  else if (status === "submitted") { label = "Отправлен руководителю"; note = p.request?.submittedAt ? `Отправлен ${fmtStamp(p.request.submittedAt)}. Если поменяете даты, отправьте заново.` : ""; }
  else if (!p.check.canSubmit || law.length) note = `Так подать нельзя: ${law[0] ? cleanMsg(law[0].message) : "есть нарушение Трудового кодекса"}. Откройте часть в списке под календарём.`;
  else {
    can = true;
    note = exceptions.length ? `Есть расхождения с регламентом (${exceptions.length}) — уйдут как запрос исключения.`
      : warns.length ? `Пометки (${warns.length}) увидит руководитель — отправить можно.` : "План уйдёт руководителю, потом РО1.";
  }

  const send = async () => {
    setBusy(true);
    try {
      const pre = await p.previewSubmit();
      if (!pre.canSubmit) { setAsk(null); await p.submit(); return; } // сервер скажет, что мешает
      if (pre.needsException) { setWhy(""); setAsk({ exception: pre.exception }); return; }
      await p.submit();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-tour="me.submit">
      <Button variant="primary" size="lg" block icon={status === "submitted" || p.locked ? CircleCheck : Send}
        disabled={!can || p.saving} loading={p.submitting || busy} onClick={send}>{label}</Button>
      {note && <p className="px-1 text-[12.5px] text-muted leading-snug">{note}</p>}
      <Dialog open={!!ask} onClose={() => setAsk(null)} width={520} title="Отправить с отступлением от регламента?"
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Вернуться к плану</Button>
          <Button variant="primary" disabled={!why.trim()} loading={p.submitting}
            onClick={async () => { if (await p.submit(why.trim())) setAsk(null); }}>Отправить на согласование исключения</Button>
        </>}>
        <div className="flex flex-col gap-3 text-[14px] leading-snug">
          <p className="text-text-2">В плане есть пункты, которые расходятся с правилами компании:</p>
          <ul className="flex flex-col gap-1.5">
            {ask?.exception.map((x) => (
              <li key={x} className="flex gap-2 text-[13.5px]"><TriangleAlert size={15} className="shrink-0 mt-0.5 text-warn" />{x}</li>
            ))}
          </ul>
          <p className="text-text-2">
            Подать можно: такие отпуска согласуются как исключение. Решение примут ваш руководитель и РО1 — {p.plan.ro1}.
            Нормы Трудового кодекса исключением не меняются.
          </p>
          <Field label="Почему нужны именно эти даты" hint="Например: путёвка куплена заранее, совпадает с отпуском супруга">
            <Textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Почему нужны именно эти даты" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

const cleanMsg = (m: string) => {
  const t = m.replace(/^Част[ьи] [\d, и]+: /, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
};

/** Маршрут согласования: вы → руководитель → РО1 → утверждение графика */
function Route() {
  const p = usePlan();
  const status = p.request?.status ?? "draft";
  // план согласован — ждёт утверждения графика; график утверждён — пройдены все шаги
  const scheduled = p.plan.schedule.length > 0 && p.plan.schedule.every((h) => h.status === "approved");
  const at = status === "approved" || p.locked ? (scheduled ? 4 : 3) : status === "submitted" ? 1 : 0;
  const steps = [
    { title: "Вы", sub: status === "returned" ? "план вернули на доработку" : "составляете план" },
    { title: "Руководитель", sub: p.plan.manager ?? "непосредственный руководитель" },
    { title: "РО1", sub: p.plan.ro1 },
    { title: "Утверждение графика", sub: "график утверждает директор" },
  ];
  return (
    <ol className="flex flex-col px-1" aria-label="Маршрут согласования">
      {steps.map((s, i) => {
        const done = i < at, now = i === at;
        return (
          <li key={s.title} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0 transition-colors",
                done ? "bg-ok text-white" : now ? "bg-accent text-white shadow-[0_0_0_4px_var(--accent-bg)]" : "bg-fill-2")}>
                {done && <Check size={12} strokeWidth={3} />}
              </span>
              {i < steps.length - 1 && <span className={cx("w-[2px] flex-1 min-h-3 my-0.5 rounded-full", done ? "bg-ok" : "bg-fill-2")} />}
            </div>
            <div className="pb-3 -mt-px">
              <div className={cx("text-[13.5px] leading-5", now ? "font-semibold" : done ? "text-text-2" : "text-muted")}>
                {s.title}{now && <span className="text-accent-strong font-medium"> — сейчас здесь</span>}
              </div>
              <div className="text-[12.5px] text-muted">{s.sub}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RulesSheet() {
  const p = usePlan();
  const rows = ruleRows(p.check);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="text-[15px] font-semibold">Как читать календарь</div>
        <CalendarLegend />
        <p className="text-[13px] text-muted">
          {p.plan.showNames
            ? "Вы видите, кто из вашей группы в отпуске, — график по ст. 168 ТК доводится до всех работников. Отдел кадров может это отключить."
            : "Имена коллег скрыты отделом кадров — видна только загрузка группы: сколько мест свободно в каждый день."}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-semibold">Правила и как ваш план их проходит</div>
        {rows.length ? rows.map((r) => {
          const { Icon, cls } = ICON[r.level];
          return (
            <div key={r.code} className="flex gap-3">
              <span className={cx("w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0", cls)}><Icon size={13} strokeWidth={3} /></span>
              <div className="min-w-0">
                <div className="text-[14px] font-medium leading-snug">{r.title}</div>
                {r.messages.map((m) => <div key={m} className="text-[13px] text-text-2 leading-snug mt-0.5">{m}</div>)}
                {r.basis && <div className="text-[12px] text-muted-2 mt-0.5">{r.basis}</div>}
              </div>
            </div>
          );
        }) : <p className="text-[13px] text-muted">Добавьте отпуск — и здесь появится проверка по каждому правилу.</p>}
      </div>
      <p className="text-[12.5px] text-muted-2">Правила задаёт отдел кадров. Если нужно исключение — обсудите с руководителем.</p>
    </div>
  );
}

function HistorySheet() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getMyHistory().then((r) => { if (live) setItems(r); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (failed) return <p className="text-[13px] text-bad">Не удалось загрузить историю.</p>;
  if (!items) {
    return <div className="flex flex-col gap-4">{[0, 1, 2, 3].map((k) => <div key={k} className="flex flex-col gap-1.5"><Skeleton w="40%" h={12} /><Skeleton w="85%" /></div>)}</div>;
  }
  if (!items.length) return <p className="text-[13px] text-muted">Пока пусто: история появится после первого сохранения.</p>;
  return (
    <ol className="flex flex-col gap-4">
      {items.map((h) => {
        const tone = h.action === "approved" ? "text-ok" : h.action === "returned" || h.action === "rejected" ? "text-warn" : h.action === "submit" ? "text-accent-strong" : "text-text";
        return (
          <li key={h.id} className="flex flex-col gap-0.5">
            <div className="text-[12px] text-muted tnum">{fmtStamp(h.at)} · {h.actor}</div>
            <div className={cx("text-[14px] font-medium", tone)}>{h.label}</div>
            {h.detail && <div className="text-[13px] text-text-2 tnum">{h.detail}</div>}
          </li>
        );
      })}
    </ol>
  );
}
