"use client";

/**
 * Тело раскрытой строки «Нового отпуска» или части: слева «Параметры» (вид, причина, кто замещает),
 * справа «Проверка» (вердикт и советы одним нажатием), внизу действия. Заголовка с датами здесь нет:
 * его роль играет шапка строки, она обновляется вживую.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, CircleCheck, CircleX, Info, Scissors, Sparkles, Trash2, TriangleAlert, UserRound, X } from "lucide-react";
import { Avatar, Button, Checkbox, Field, SegmentedControl, Select, Skeleton, Surface, Textarea, cx, type DateRange } from "@/components/kit";
import { checkMyDraft, getSubstitutes } from "@/server/actions/plan";
import type { VacationType } from "@/server/db/types";
import { LEAVE_REASONS, TYPE_HINT, TYPE_SEGMENT, cap, daysText, plural, rangeText, rank, reasonOf } from "./cal";
import { usePlan, type Also } from "./state";
import type { MyFinding, SubstituteView, TrimView, WindowView } from "./types";

/** Выделение в строке; also — другая часть, которую сократят вместе с ним (совет по норме) */
export interface EditorValue {
  range: DateRange;
  type: VacationType;
  /** За свой счёт: причина (ст. 190) или категория льготы (ст. 189) и комментарий */
  reason?: string | null;
  note?: string | null;
  /** Кто замещает: id и имя — имя нужно шапке строки */
  substituteId?: string | null;
  substituteName?: string | null;
  /** Замещающий сбросился: в новые даты он сам в отпуске — имя для предупреждения */
  lostSub?: string | null;
  /** Нужны отпускные (только у основного, п. 4 регламента) */
  needsPay?: boolean;
  also?: Also;
}

/** Льгота из карточки сотрудника, которая совпадает с категорией ст. 189 */
const benefitReason = (benefit: string | null) => (benefit && /дво|инвалид/i.test(benefit) ? "children" : null);

/**
 * Нарушения уровня плана, которые эта часть создаёт или может исправить: часть от 14 дней (R05),
 * норма (R06), пересечения (R07), число частей (R10). Показываем в проверке строки, чтобы её вердикт
 * не расходился с панелью плана.
 */
const PLAN_BLOCKERS = new Set(["R05", "R06", "R07", "R10"]);

export interface Result { key: string; findings: MyFinding[]; all: MyFinding[]; windows: WindowView[]; trims: TrimView[]; extend?: { start: string; end: string; days: number }[] }

/** Вердикт строки: law — нормы ТК, exception — расхождение с регламентом, warning — пометка */
export type Verdict = "ok" | "warning" | "exception" | "law";
export function verdictOf(findings: MyFinding[]): Verdict {
  const bad = findings.filter((f) => f.level === "block" || f.level === "warn");
  if (bad.some((f) => f.consequence === "law" || (!f.consequence && f.level === "block" && f.global))) return "law";
  if (bad.some((f) => f.consequence === "exception" || (!f.consequence && f.level === "block"))) return "exception";
  return bad.length ? "warning" : "ok";
}

export function PartEditor({ index, value, from, onChange, onDone }: {
  /** Какую часть правим; null — новая */
  index: number | null;
  /** Прежние значения изменяемой части — чтобы «Сохранить» ждала изменений */
  from?: EditorValue;
  value: EditorValue;
  onChange: (v: EditorValue) => void;
  /** Сбросить выделение и свернуть строку */
  onDone: () => void;
}) {
  const p = usePlan();
  const { range, type } = value;
  const ready = !!range.start && !!range.end;
  const draft = ready
    ? { type, start: range.start!, end: range.end!, substituteId: value.substituteId ?? null, reason: value.reason ?? null, reasonNote: value.note ?? null, needsPay: type === "main" && !!value.needsPay }
    : null;
  const { list, no, origin } = draft ? p.withPart(index, draft, value.also) : { list: [], no: 0, origin: [] };
  const key = draft ? JSON.stringify([list, no]) : "";

  const [res, setRes] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!key) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await checkMyDraft(list.map((x) => ({
          type: x.type, startDate: x.start, endDate: x.end, substituteId: x.substituteId ?? null, reason: x.reason ?? null, reasonNote: x.reasonNote ?? null,
          needsPay: !!x.needsPay,
        })), no);
        if (id !== seq.current) return;
        const findings = r.check.findings.filter((f) => f.partNo === no || (!f.partNo && PLAN_BLOCKERS.has(f.ruleCode) && (f.level === "block" || f.level === "warn")));
        setRes({ key, findings, all: r.check.findings.filter((f) => f.partNo === no || !f.partNo), windows: r.windowsFor === no ? r.windows : [], trims: r.trims, extend: r.extend });
        setFailed(false);
      } catch {
        if (id === seq.current) setFailed(true);
      }
    }, 200);
    return () => clearTimeout(t);
    // list и no входят в key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // кого можно указать замещающим на эти даты: свободен ли он — пометка в списке
  const subsKey = ready ? `${range.start}|${range.end}` : "";
  const [subs, setSubs] = useState<{ key: string; list: SubstituteView[] } | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });
  useEffect(() => {
    if (!subsKey) return;
    let live = true;
    const [a, b] = subsKey.split("|");
    getSubstitutes(a, b).then((list) => {
      if (!live) return;
      setSubs({ key: subsKey, list });
      // выбранный замещающий в новые даты сам в отпуске — сбрасываем, в проверке остаётся предупреждение с именем
      const { value: v, onChange: change } = latest.current;
      const was = v.substituteId ? list.find((c) => c.id === v.substituteId) : null;
      if (was && !was.free) change({ ...v, substituteId: null, substituteName: null, lostSub: was.name });
    }).catch(() => {});
    return () => { live = false; };
  }, [subsKey]);
  const candidates = subs?.key === subsKey ? subs.list : [];
  // в списке только свободные во все дни части: занятого замещающим выбрать нельзя
  const free = candidates.filter((c) => c.free);
  const pickSub = (id: string) => onChange({ ...value, substituteId: id, substituteName: candidates.find((c) => c.id === id)?.name ?? null, lostSub: null });

  const checking = ready && res?.key !== key && !failed;
  const verdict: Verdict = res && !checking ? verdictOf(res.findings) : "ok";
  const editing = index !== null;
  const changed = !from || (["range", "type", "reason", "note", "substituteId", "needsPay", "also"] as const).some((k) =>
    JSON.stringify(value[k] ?? null) !== JSON.stringify(from[k] ?? null));

  // перебор нормы: советы движка — сократить само выделение или другую часть до конкретных дат
  const trims: Advice[] = (res && !checking ? res.trims : []).map((t) => {
    const other = t.draft ? null : origin[t.partNo - 1] ?? null;
    return {
      key: `${t.partNo}${t.to.start}${t.to.end}`, freed: t.freedDays,
      label: t.draft
        ? `Сократить выделение до ${rangeText(t.to.start, t.to.end)}`
        : `${rangeText(t.from.start, t.from.end)} → ${rangeText(t.to.start, t.to.end)}`,
      apply: () => onChange(t.draft
        ? { ...value, range: { start: t.to.start, end: t.to.end } }
        : { ...value, also: other !== null ? { index: other, start: t.to.start, end: t.to.end } : value.also }),
    };
  });
  const also = value.also ? p.parts[value.also.index] : null;
  // за свой счёт без причины (или без описания «другой») — не добавляем
  const reason = reasonOf(type, value.reason);
  // причины есть не у всех видов: у «Планового лечения» их нет
  const reasons = type === "main" ? [] : LEAVE_REASONS[type];
  const reasonMissing = reasons.length > 0 && (!reason || (!!reason.needsNote && !value.note?.trim()));
  const sub = candidates.find((c) => c.id === value.substituteId);

  return (
    <div className="flex flex-col gap-4">
      <div className="@container">
        <div className="grid gap-6 @min-[720px]:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
          {/* Параметры */}
          <div className="order-2 @min-[720px]:order-1 flex flex-col gap-4 min-w-0">
            {also && value.also && (
              <div className="text-[12.5px] text-text-2 tnum flex items-start gap-1.5 px-0.5">
                <Scissors size={13} className="shrink-0 mt-0.5 text-muted" />
                <span className="min-w-0">
                  Вместе с этим часть {value.also.index + 1}: было {rangeText(also.start, also.end)}, станет <b className="font-semibold">{rangeText(value.also.start, value.also.end)}</b>
                </span>
                <button type="button" aria-label="Не сокращать эту часть" className="press shrink-0 text-muted hover:text-text cursor-pointer"
                  onClick={() => onChange({ ...value, also: undefined })}><X size={14} /></button>
              </div>
            )}
            <Field label="Вид отпуска" hint={type === "treatment" ? (
              TYPE_HINT[type]
            ) : TYPE_HINT[type]}>
              <SegmentedControl size="sm" block value={type}
                onChange={(t) => onChange({ ...value, type: t, reason: t === "unpaid189" ? benefitReason(p.plan.employee.benefit) : null, note: null })}
                options={(["main", "unpaid190", "unpaid189", "treatment"] as const).map((v) => ({ value: v, label: TYPE_SEGMENT[v] }))} />
            </Field>
            {reasons.length > 0 && (
              <Field label={type === "unpaid190" ? "Причина" : "Категория по ст. 189"}
                hint={reason?.paidHint ? "Если это предусмотрено коллективным договором, до 3 дней могут оплатить — уточните в отделе кадров."
                  : type === "unpaid189" ? "Нужен подтверждающий документ — отдел кадров попросит его при оформлении." : undefined}>
                <Select size="sm" value={value.reason ?? null} placeholder={type === "unpaid190" ? "Выберите причину" : "Выберите категорию"}
                  aria-label={type === "unpaid190" ? "Причина отпуска за свой счёт" : "Категория льготы по ст. 189"}
                  options={reasons.map((r) => ({ value: r.code, label: r.label }))}
                  onChange={(code) => onChange({ ...value, reason: code, note: reasonOf(type, code)?.needsNote ? value.note : null })} />
                {reason?.needsNote && (
                  <Textarea rows={2} placeholder="Коротко опишите" aria-label="Коротко опишите причину" value={value.note ?? ""}
                    onChange={(e) => onChange({ ...value, note: e.target.value })} />
                )}
              </Field>
            )}
            {type === "main" && (
              <Checkbox checked={!!value.needsPay} onChange={(v) => onChange({ ...value, needsPay: v })} label="Нужны отпускные"
                description="Сумма — не больше оклада" />
            )}
            <Field label="Кто замещает" hint={subs?.key === subsKey && !free.length
              ? "В эти даты свободных коллег нет — сдвиньте даты или обратитесь к руководителю" : undefined}>
              <Select size="sm" searchable value={value.substituteId ?? null} aria-label="Кто замещает"
                placeholder={subs?.key === subsKey && !free.length ? "Свободных коллег нет" : "Выберите коллегу"}
                disabled={subs?.key === subsKey && !free.length}
                options={free.map((c) => ({
                  value: c.id, label: c.name, group: c.group, description: c.position,
                  leading: <Avatar name={c.name} size={22} />,
                }))}
                onChange={pickSub} />
            </Field>
          </div>

          {/* Проверка */}
          <Surface nested tone="tinted" pad={16} className="order-1 @min-[720px]:order-2 min-w-0" aria-live="polite">
            {ready && <Check lostSub={value.lostSub ?? null} onRange={(r) => onChange({ ...value, range: r })} verdict={verdict} checking={checking} failed={failed} res={res} trims={trims} range={{ start: range.start!, end: range.end! }}
              subFree={sub?.free ?? null}
              subs={candidates.filter((c) => c.free).slice(0, 2).map((c) => ({ key: c.id, label: c.name, apply: () => pickSub(c.id) }))}
              onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }}
              onWindow={(w) => onChange({ ...value, range: { start: w.start, end: w.end } })} />}
          </Surface>
        </div>
      </div>

      {/* Действия */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t-[0.5px] border-line">
        {editing && (
          <Button variant="ghost" size="sm" icon={Trash2} className="text-bad" onClick={() => { p.remove(index); onDone(); }}>Удалить часть</Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>{editing ? "Отменить" : "Сбросить"}</Button>
          <Button variant="primary" disabled={!ready || checking || verdict === "law" || failed || reasonMissing || !changed}
            title={reasonMissing ? (type === "unpaid190" ? "Выберите причину" : "Выберите категорию") : !changed ? "Ничего не изменилось" : undefined}
            onClick={() => {
              p.upsert(index, { ...draft!, substituteName: value.substituteName ?? null }, value.also);
              onDone();
            }}>
            {editing ? "Сохранить изменения" : "Добавить в план"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Совет, готовый к применению одним нажатием */
export interface Advice { key: string; label: string; apply: () => void; freed?: number }

const LOOK: Record<Verdict, { fg: string; Icon: typeof CircleCheck; title: string; note?: string }> = {
  ok: { fg: "text-ok", Icon: CircleCheck, title: "Можно добавлять" },
  warning: { fg: "text-warn", Icon: TriangleAlert, title: "Можно добавить — руководитель увидит пометку" },
  exception: {
    fg: "text-warn", Icon: TriangleAlert, title: "Нужно согласовать исключение",
    note: "Даты расходятся с правилами компании. Подать можно — решение примут руководитель и РО1.",
  },
  law: { fg: "text-bad", Icon: CircleX, title: "Так подать нельзя" },
};

const clean = (m: string) => cap(m.replace(/^Част[ьи] [\d, и]+: /, ""));

type Group = "law" | "exception" | "warning" | "note";
const GROUPS: Group[] = ["law", "exception", "warning", "note"];
const GROUP_LOOK: Record<Exclude<Group, "note">, { title: string; fg: string }> = {
  law: { title: "Нарушает Трудовой кодекс", fg: "text-bad" },
  exception: { title: "Расходится с регламентом", fg: "text-warn" },
  warning: { title: "Предупреждение", fg: "text-muted" },
};

/** «Бондарь Ирина Николаевна» → «Бондарь И. Н.» */
const shortFio = (name: string) => {
  const [last, ...rest] = name.split(/\s+/);
  return [last, ...rest.map((x) => `${x.charAt(0)}.`)].join(" ");
};

/**
 * «Проверка» в строке: заголовок тоном вердикта, причины и советы. Сначала причины, которые от дат
 * не зависят (норма, число частей): к ним — действие, которое их чинит, а не другие даты. Когда всё
 * хорошо — короткая справка (места в группе, замещающий) и свёрнутый список проверенных правил.
 */
export function Check({ verdict, checking, failed, res, trims, subs, subFree, range, onWindow, onRetry, okTitle, onRange, lostSub }: {
  /** Замещающий сброшен: в эти даты он в отпуске */
  lostSub?: string | null;
  /** Применить другие даты выделения (совет «продлить до 14 дней») */
  onRange?: (r: { start: string; end: string }) => void;
  verdict: Verdict; checking: boolean; failed: boolean; res: Result | null; trims: Advice[];
  /** Заголовок, когда всё хорошо (у заявки на перенос — «Можно отправить») */
  okTitle?: string;
  /** Свободные в эти даты коллеги — совет, когда замещающий не указан или сам в отпуске */
  subs: Advice[]; subFree: boolean | null; range: { start: string; end: string };
  onWindow: (w: WindowView) => void; onRetry: () => void;
}) {
  const p = usePlan();
  const [more, setMore] = useState(false);
  const [rules, setRules] = useState(false);
  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        Нет связи с сервером — проверка не выполнена.
        <Button size="sm" variant="tinted" pill onClick={onRetry}>Повторить</Button>
      </div>
    );
  }
  if (checking || !res) {
    return (
      <div className="flex gap-2.5" aria-busy>
        <Skeleton w={20} h={20} round />
        <div className="flex-1 flex flex-col gap-2 pt-0.5"><Skeleton w="60%" /><Skeleton w="80%" h={12} /><Skeleton w="45%" h={12} /></div>
      </div>
    );
  }
  const look = LOOK[verdict];
  const bad = res.findings.filter((f) => f.level === "block" || f.level === "warn")
    .sort((a, b) => Number(b.global) - Number(a.global) || rank(b.level) - rank(a.level));
  const notes = res.findings.filter((f) => f.level === "info" || f.level === "exception");
  const global = bad.some((f) => f.global);
  const norm = bad.some((f) => f.ruleCode === "R06");
  const noSub = bad.some((f) => f.ruleCode === "R15");
  // свободные окна помогают, только когда мешают сами даты, а не, скажем, неуказанный замещающий
  const datesMatter = bad.some((f) => !f.global && f.ruleCode !== "R15");
  // причины по уровню: нарушения ТК, расхождения с регламентом, предупреждения, справка
  const group = (f: MyFinding): Group => f.level === "info" || f.level === "exception" ? "note"
    : f.consequence === "law" || (!f.consequence && f.level === "block" && f.global) ? "law"
    : f.consequence === "exception" || (!f.consequence && f.level === "block") ? "exception" : "warning";
  const lines = [...bad, ...notes]
    .map((f) => ({
      key: f.ruleCode + f.message, group: group(f),
      text: lostSub && f.ruleCode === "R15" ? `${shortFio(lostSub)} в эти даты в отпуске — выберите другого` : clean(f.message),
    }))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  const groups = new Set(lines.map((l) => l.group));
  // строка не должна вытолкнуть кнопки за край экрана: больше трёх причин — остальные по клику
  const visible = more || lines.length <= 3 ? lines : lines.slice(0, 2);
  const passed = res.all.filter((f) => f.level === "ok");

  // справка, когда всё хорошо: самый тесный день выделения по загрузке группы
  let tight: { busy: number; limit: number } | null = null;
  for (let t = Date.parse(range.start); t <= Date.parse(range.end); t += 86_400_000) {
    const l = p.load[new Date(t).toISOString().slice(0, 10)];
    if (l && l.limit && (!tight || l.limit - l.busy < tight.limit - tight.busy)) tight = l;
  }
  const free = tight ? Math.max(0, tight.limit - tight.busy) : 0;
  const facts = [
    p.beneficiary ? "Лимиты группы на вас не действуют"
      : tight ? `В группе в эти дни свободно ${free} ${plural(free, "место", "места", "мест")} из ${tight.limit}` : null,
    subFree ? "Замещающий свободен" : null,
  ].filter((x): x is string => !!x);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex gap-2.5">
        <look.Icon size={20} strokeWidth={2.25} className={cx("shrink-0 mt-px", look.fg)} />
        <div className="min-w-0 flex-1">
          <div className={cx("text-[15px] font-semibold leading-snug", look.fg)}>{verdict === "ok" && okTitle ? okTitle : look.title}</div>
          {look.note && <p className="text-[12.5px] text-text-2 mt-1 leading-snug">{look.note}</p>}
          {visible.map((l, i) => (
            <div key={l.key}>
              {/* подзаголовок группы — когда групп больше одной, чтобы пометка не читалась как часть запрета */}
              {groups.size > 1 && l.group !== "note" && visible[i - 1]?.group !== l.group && (
                <div className={cx("mt-2.5 text-[11.5px] font-semibold flex items-center gap-1", GROUP_LOOK[l.group].fg)}>
                  {GROUP_LOOK[l.group].title}
                </div>
              )}
              {l.group === "note" ? (
                <p className="text-[12.5px] text-muted mt-1 leading-snug flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />{l.text}</p>
              ) : (
                <p className="text-[13px] text-text-2 mt-1 leading-snug">{l.text}</p>
              )}
            </div>
          ))}
          {visible.length < lines.length && (
            <button type="button" className="press mt-1 text-[12.5px] font-medium text-accent-strong cursor-pointer" onClick={() => setMore(true)}>
              Ещё {lines.length - visible.length} {plural(lines.length - visible.length, "причина", "причины", "причин")}
            </button>
          )}
          {verdict === "ok" && facts.map((f) => <p key={f} className="text-[13px] text-text-2 mt-1 leading-snug">{f}</p>)}
        </div>
      </div>
      {onRange && res.extend && res.extend.length > 0 && (
        <AdviceRow icon={Sparkles} title="Чтобы была часть от 14 дней (ст. 174 ТК) — одним нажатием:">
          {res.extend.map((x) => (
            <Button key={x.start + x.end} size="sm" variant="tinted" pill onClick={() => onRange({ start: x.start, end: x.end })}>
              Продлить до {daysText(x.days)}: {rangeText(x.start, x.end)}
            </Button>
          ))}
        </AdviceRow>
      )}
      {noSub && subs.length > 0 && (
        <AdviceRow icon={UserRound} title="Свободны в эти даты — одним нажатием:">
          {subs.map((t) => (
            <Button key={t.key} size="sm" variant="tinted" pill onClick={t.apply} aria-label={`Замещает ${t.label}`}>
              <Avatar name={t.label} size={18} />{shortFio(t.label)}
            </Button>
          ))}
        </AdviceRow>
      )}
      {norm && (trims.length ? (
        <AdviceRow icon={Scissors} title={`Чтобы уложиться в норму, освободите ${daysText(trims[0].freed ?? 0)} — одним нажатием:`}>
          {trims.map((t) => <Button key={t.key} size="sm" variant="tinted" pill onClick={t.apply}>{t.label}</Button>)}
        </AdviceRow>
      ) : (
        <p className="text-[12.5px] text-muted">Чтобы добавить эти дни, сократите другие части — подходящего варианта, который проходит все правила, нет.</p>
      ))}
      {verdict !== "ok" && !global && datesMatter && res.windows.length > 0 && (
        <AdviceRow icon={Sparkles} title="Свободно рядом, той же длины — одним нажатием:">
          {res.windows.map((w) => (
            <Button key={w.start} size="sm" variant="tinted" pill onClick={() => onWindow(w)}>
              {rangeText(w.start, w.end)}<span className="opacity-70 font-normal">{daysText(w.days)}</span>
            </Button>
          ))}
        </AdviceRow>
      )}
      {verdict === "ok" && passed.length > 0 && (
        <div>
          <button type="button" aria-expanded={rules} onClick={() => setRules(!rules)}
            className="press inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-text-2 cursor-pointer">
            Проверено {passed.length} {plural(passed.length, "правило", "правила", "правил")}
            <ChevronDown size={14} className={cx("transition-transform duration-[var(--dur-1)]", rules && "rotate-180")} />
          </button>
          {rules && (
            <ul className="mt-1.5 flex flex-col gap-1 kit-fade">
              {passed.map((f) => (
                <li key={f.ruleCode} className="text-[12.5px] text-text-2 flex gap-1.5 leading-snug">
                  <CircleCheck size={13} className="shrink-0 mt-0.5 text-ok" />{f.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AdviceRow({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12.5px] text-muted flex items-center gap-1.5"><Icon size={13} />{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
