"use client";

/**
 * Сотрудники для HR: список-карточка с поиском и фильтрами, карточка сотрудника в боковой панели.
 * Правки — черновиком: внизу панели плашка «N изменений · конфликтов станет X · Сбросить ·
 * Сохранить», над ней последствия (`previewPerson` пересчитывает график, ничего не сохраняя).
 * Приём — та же панель пустой; увольнение без удаления.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  CircleAlert, CircleCheck, Info, RotateCcw, Search, ShieldCheck, TriangleAlert, UserMinus, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";
import {
  Avatar, Badge, Button, Card, Checkbox, DatePicker, Dialog, EmptyState, Field, IconButton, Input, NumberStepper, PageHeader, Pill,
  SegmentedControl, Select, Sheet, Surface, Switch, cx, toast, useInnerRadius, type Tone,
} from "@/components/kit";
import type { AccessKind, RequestStatus, RoleCode } from "@/server/db/types";
import {
  dismissPerson, previewPerson, restorePerson, savePerson, type Consequence, type Person, type PersonDraft, type PersonPreview,
} from "@/server/actions/people";
import { plural, shortName } from "./meta";
import { DiffLine } from "./DiffLine";

interface Data {
  year: number;
  people: Person[];
  roles: { code: RoleCode; title: string; groupName: string | null }[];
  units: { division: string; department: string | null }[];
  benefits: string[];
  benefits189: { code: string; label: string }[];
  me: string;
}

const ACCESS: Record<AccessKind, { label: string; tone: Tone }> = {
  employee: { label: "Сотрудник", tone: "neutral" },
  manager: { label: "Руководитель", tone: "info" },
  hr: { label: "HR", tone: "accent" },
};
const PLAN: Record<RequestStatus, { label: string; tone: Tone }> = {
  draft: { label: "черновик", tone: "neutral" },
  submitted: { label: "на согласовании", tone: "warn" },
  approved: { label: "согласован", tone: "ok" },
  returned: { label: "возвращён", tone: "info" },
};

type AccessFilter = "all" | AccessKind;
const topAccess = (p: Person): AccessKind => (p.access.includes("hr") ? "hr" : p.access.includes("manager") ? "manager" : "employee");
const unitKey = (u: { division: string; department: string | null }) => `${u.division}|${u.department ?? ""}`;
const unitText = (u: { division: string; department: string | null }) => (u.department ? `${u.department}, ${u.division.toLowerCase()}` : u.division);
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const date = (iso: string) => `${+iso.slice(8, 10)} ${MON_GEN[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY: PersonDraft = {
  fullName: "", position: "", division: "", department: null, managerId: null, roleCode: "СП", isHr: false,
  benefit: null, benefit189: null, under18: false, hiredOn: "", baseDays: 24, extraDays: 0,
};
const draftOf = (p: Person): PersonDraft => ({
  id: p.id, fullName: p.fullName, position: p.position, division: p.division, department: p.department, managerId: p.managerId,
  roleCode: p.roleCode, isHr: p.isHr, benefit: p.benefit, benefit189: p.benefit189, under18: p.under18,
  hiredOn: p.hiredOn, baseDays: p.baseDays, extraDays: p.extraDays,
});

export function PeopleView(props: Data) {
  const router = useRouter();
  const [data, setData] = useState(props);
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("");
  const [access, setAccess] = useState<AccessFilter>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [open, setOpen] = useState<Person | "new" | null>(null);

  const working = data.people.filter((p) => !p.dismissedOn);
  const dismissed = data.people.length - working.length;
  const shown = data.people.filter((p) => {
    if (!showDismissed && p.dismissedOn) return false;
    if (unit && unitKey(p) !== unit) return false;
    if (access !== "all" && (access === "employee" ? topAccess(p) !== "employee" : !p.access.includes(access))) return false;
    const s = q.trim().toLowerCase();
    return !s || `${p.fullName} ${p.position} ${p.department ?? ""} ${p.division}`.toLowerCase().includes(s);
  });
  // «Сотрудники» — без руководящего и HR-доступа; руководители и HR — по наличию доступа
  const count = (a: AccessFilter) => working.filter((p) => a === "all" || (a === "employee" ? topAccess(p) === "employee" : p.access.includes(a))).length;

  const onSaved = (next: Data, title: string, description?: string) => {
    setData((d) => ({ ...d, ...next }));
    setOpen(null);
    toast(title, { description, action: { label: "Журнал", onClick: () => router.push("/hr/log?type=people") }, duration: 6000 });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Сотрудники"
        subtitle={`${working.length} ${plural(working.length, ["работает", "работают", "работают"])}${dismissed ? `, ${dismissed} ${plural(dismissed, ["уволен", "уволены", "уволены"])}` : ""}. Карточка открывается по клику, изменения попадают в журнал.`}
        actions={<Button variant="primary" icon={UserPlus} onClick={() => setOpen("new")}>Добавить сотрудника</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <Input icon={Search} placeholder="Поиск: имя, должность, отдел" value={q} onChange={(e) => setQ(e.target.value)} className="w-[300px]"
          trailing={q ? <IconButton icon={X} label="Очистить поиск" size="sm" onClick={() => setQ("")} /> : undefined} />
        <div className="w-[300px]">
          <Select value={unit} onChange={setUnit} placeholder="Все отделы" searchable
            options={[{ value: "", label: "Все отделы" }, ...data.units.map((u) => ({ value: unitKey(u), label: unitText(u), group: u.division }))]} />
        </div>
        <SegmentedControl value={access} onChange={setAccess} aria-label="Доступ" options={[
          { value: "all", label: `Все ${count("all")}` },
          { value: "employee", label: `Сотрудники ${count("employee")}` },
          { value: "manager", label: `Руководители ${count("manager")}` },
          { value: "hr", label: `HR ${count("hr")}` },
        ]} />
        {dismissed > 0 && <Checkbox className="ml-1" checked={showDismissed} onChange={setShowDismissed} label="Показать уволенных" />}
      </div>

      <Card pad={8}>
        {shown.length === 0 ? (
          <EmptyState icon={Users} title="Никого не нашлось" description="Попробуйте убрать часть фильтров." />
        ) : (
          <div className="flex flex-col">
            <div className="hidden xl:grid xl:grid-cols-[minmax(240px,1.7fr)_minmax(150px,1.2fr)_118px_118px_minmax(130px,1fr)_118px_128px] gap-x-4 px-3 pt-1.5 pb-2 text-[12px] text-muted-2">
              <span>Сотрудник</span><span>Отдел и отделение</span><span>Руководитель</span><span>Доступ</span>
              <span>Группа лимита</span><span>Принят</span><span>План {data.year}</span>
            </div>
            <div className="flex flex-col divide-y-[0.5px] divide-line">
              {shown.map((p) => <Row key={p.id} p={p} onOpen={() => setOpen(p)} />)}
            </div>
          </div>
        )}
      </Card>

      {open && (
        <PersonSheet key={open === "new" ? "new" : open.id} person={open === "new" ? null : open} data={data}
          onClose={() => setOpen(null)} onSaved={onSaved} />
      )}
    </div>
  );
}

/* ---------------- строка списка ---------------- */

function Row({ p, onOpen }: { p: Person; onOpen: () => void }) {
  const a = ACCESS[topAccess(p)];
  const radius = useInnerRadius(); // строка у края карточки — концентрично ей
  return (
    <button type="button" onClick={onOpen} style={{ borderRadius: radius }}
      className={cx("grid grid-cols-1 xl:grid-cols-[minmax(240px,1.7fr)_minmax(150px,1.2fr)_118px_118px_minmax(130px,1fr)_118px_128px] gap-x-4 gap-y-1.5 items-center px-3 py-3 text-left cursor-pointer hover:bg-fill-3 transition-colors",
        p.dismissedOn && "opacity-60")}>
      <span className="flex items-center gap-3 min-w-0">
        <Avatar name={p.fullName} size={36} />
        <span className="min-w-0">
          <span className="block text-[14.5px] font-semibold tracking-[-0.01em] truncate">{p.fullName}</span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted min-w-0">
            <span className="truncate">{p.position}</span>
            {p.benefit && <Pill size="sm" tone="vacation" title={`Льгота ч. 4 ст. 168: ${p.benefit}`}>льгота</Pill>}
            {p.dismissedOn && <Pill size="sm" tone="neutral">уволен {date(p.dismissedOn)}</Pill>}
          </span>
        </span>
      </span>
      <span className="text-[13px] text-text-2 truncate max-xl:hidden">
        {p.department ? <>{p.department}<span className="block text-muted text-[12.5px]">{p.division}</span></> : p.division}
      </span>
      <span className="text-[13px] text-text-2 truncate max-xl:hidden">{p.managerName ? shortName(p.managerName) : "—"}</span>
      <span className="max-xl:hidden"><Pill size="sm" tone={a.tone}>{a.label}</Pill></span>
      <span className="text-[13px] text-text-2 truncate max-xl:hidden">{p.groupName ?? <span className="text-muted-2">без группы</span>}</span>
      <span className="text-[13px] text-muted tnum max-xl:hidden">{date(p.hiredOn)}</span>
      <span className="max-xl:hidden">
        {p.planStatus ? <Pill size="sm" tone={PLAN[p.planStatus].tone}>{PLAN[p.planStatus].label}</Pill>
          : <span className="text-[13px] text-muted-2">не начат</span>}
      </span>
    </button>
  );
}

/* ---------------- карточка ---------------- */

function PersonSheet({ person, data, onClose, onSaved }: {
  person: Person | null; data: Data; onClose: () => void; onSaved: (d: Data, title: string, description?: string) => void;
}) {
  const base = useMemo(() => (person ? draftOf(person) : EMPTY), [person]);
  const [d, setD] = useState<PersonDraft>(base);
  const [previewState, setPreview] = useState<PersonPreview | null>(null);
  const [errorState, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [dismissOpen, setDismissOpen] = useState(false);

  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const preview = dirty ? previewState : null;
  const error = dirty ? errorState : null;
  const set = <K extends keyof PersonDraft>(k: K, v: PersonDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const ready = !!(d.fullName.trim() && d.position.trim() && d.division && d.hiredOn);

  useEffect(() => {
    if (!dirty || !ready) return;
    const t = setTimeout(() => start(async () => {
      try { setPreview(await previewPerson(d)); setError(null); }
      catch (e) { setError(errorText(e)); }
    }), 250);
    return () => clearTimeout(t);
  }, [d, dirty, ready]);

  const save = () => startSave(async () => {
    try {
      const res = await savePerson(d);
      const n = preview?.changes.length ?? 0;
      onSaved(res as unknown as Data, person ? "Карточка сохранена" : "Сотрудник добавлен",
        person ? `${n} ${plural(n, ["изменение записано", "изменения записаны", "изменений записано"])} в журнал` : `${d.fullName.trim()} — записано в журнал`);
    } catch (e) {
      toast("Не удалось сохранить", { tone: "bad", description: errorText(e) });
    }
  });
  const restore = () => startSave(async () => {
    try { onSaved(await restorePerson(person!.id) as unknown as Data, "Сотрудник снова в списках"); }
    catch (e) { toast("Не удалось вернуть", { tone: "bad", description: errorText(e) }); }
  });

  const isMe = person?.id === data.me;
  const managers = data.people.filter((p) => !p.dismissedOn && p.id !== person?.id);
  const role = data.roles.find((r) => r.code === d.roleCode);
  const unitOptions = data.units.map((u) => ({ value: unitKey(u), label: unitText(u), group: u.division }));

  return (
    <Sheet open onClose={onClose} width={560}
      title={person ? person.fullName : "Новый сотрудник"}
      description={person ? `${person.position}, ${person.email}` : "Заполните карточку — после сохранения сотрудник появится в списках и графике"}
      footer={
        <div className="w-full flex items-center gap-2">
          {dirty ? (
            <>
              <span className="inline-flex items-center gap-2 text-[14px] font-medium pl-1">
                <Badge>{preview?.changes.length ?? "…"}</Badge>{plural(preview?.changes.length ?? 0, ["изменение", "изменения", "изменений"])}
              </span>
              {preview && <span className="text-[13px] text-muted tnum">конфликтов {preview.now} → {preview.next}</span>}
              <span className="ml-auto" />
              <Button variant="ghost" icon={RotateCcw} onClick={() => setD(base)} disabled={saving}>Сбросить</Button>
              <Button variant="primary" onClick={save} loading={saving} disabled={!ready || pending || !!error}>Сохранить</Button>
            </>
          ) : (
            <>
              {person && !person.dismissedOn && !isMe && (
                <Button variant="ghost" icon={UserMinus} className="text-bad" onClick={() => setDismissOpen(true)}>Уволить</Button>
              )}
              {person?.dismissedOn && <Button variant="secondary" onClick={restore} loading={saving}>Вернуть на работу</Button>}
              <span className="ml-auto text-[13px] text-muted">{person ? "Изменений нет" : "Заполните ФИО, должность, отдел и дату приёма"}</span>
            </>
          )}
        </div>
      }>
      <div className="flex flex-col gap-5 pb-2">
        {person?.dismissedOn && (
          <Surface nested pad={12} tone="flat" className="text-[13px] text-text-2">
            Уволен {date(person.dismissedOn)}. В списках выбора его нет, история и журнал сохранены.
          </Surface>
        )}

        <Group title="Должность и место">
          <Field label="ФИО"><Input value={d.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Фамилия Имя Отчество" /></Field>
          <Field label="Должность"><Input value={d.position} onChange={(e) => set("position", e.target.value)} placeholder="Как в штатном расписании" /></Field>
          <Field label="Отдел и отделение">
            <Select value={d.division ? unitKey(d) : null} searchable placeholder="Выберите отдел" options={unitOptions}
              onChange={(k) => { const u = data.units.find((x) => unitKey(x) === k)!; setD((x) => ({ ...x, division: u.division, department: u.department })); }} />
          </Field>
          <Field label="Непосредственный руководитель" hint={!d.managerId ? "Без руководителя заявки идут сразу к РО1" : undefined}>
            <Select value={d.managerId ?? ""} searchable placeholder="Без руководителя" onChange={(v) => set("managerId", v || null)}
              options={[{ value: "", label: "Без руководителя" }, ...managers.map((m) => ({
                value: m.id, label: m.fullName, description: m.position, leading: <Avatar name={m.fullName} size={22} />,
              }))]} />
          </Field>
        </Group>

        <Group title="Роль и доступ">
          <Field label="Роль" hint={`Группа лимита: ${role?.groupName ?? "без группы — лимит регламента не действует"}`}>
            <Select value={d.roleCode} onChange={(v) => set("roleCode", v)}
              options={data.roles.map((r) => ({ value: r.code, label: r.title, description: r.groupName ? `группа «${r.groupName}»` : "без группы" }))} />
          </Field>
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
              Доступ:
              <Pill size="sm" tone={ACCESS.employee.tone}>Сотрудник</Pill>
              {(person?.reports ?? 0) > 0 && <Pill size="sm" tone={ACCESS.manager.tone}>Руководитель</Pill>}
              {d.isHr && <Pill size="sm" tone={ACCESS.hr.tone}>HR</Pill>}
            </div>
            <Switch checked={d.isHr} onChange={(v) => set("isHr", v)} disabled={isMe && d.isHr}
              label="Доступ HR: график, правила, журнал, сотрудники"
              description={isMe && d.isHr ? "Себе доступ HR снять нельзя — иначе можно остаться без HR"
                : `«Руководитель» — автоматически, пока есть подчинённые${person ? ` (сейчас ${person.reports})` : ""}`} />
          </div>
        </Group>

        <Group title="Отпуск">
          <Field label="Дата приёма">
            <DatePicker value={d.hiredOn || null} onChange={(v) => set("hiredOn", v)} max={today()} placeholder="Выберите дату" />
          </Field>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[14px] text-text-2 w-[150px]">Основной</span>
            <NumberStepper aria-label="Основной отпуск" value={d.baseDays} min={24} max={60} onChange={(v) => set("baseDays", v)} suffix={plural(d.baseDays, ["день", "дня", "дней"])} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[14px] text-text-2 w-[150px]">Дополнительный</span>
            <NumberStepper aria-label="Дополнительный отпуск" value={d.extraDays} min={0} max={30} onChange={(v) => set("extraDays", v)} suffix={plural(d.extraDays, ["день", "дня", "дней"])} />
            <span className="text-[13px] text-muted">всего {d.baseDays + d.extraDays} в году</span>
          </div>
          <Field label="Льгота ч. 4 ст. 168" hint="Отпуск в удобное время, лимиты регламента не действуют">
            <Select value={d.benefit ?? ""} onChange={(v) => set("benefit", (v || null) as PersonDraft["benefit"])}
              options={[{ value: "", label: "Нет" }, ...data.benefits.map((b) => ({ value: b, label: b }))]} />
          </Field>
          <Field label="Категория по ст. 189" hint="Обязательный отпуск без сохранения зарплаты">
            <Select value={d.benefit189 ?? ""} onChange={(v) => set("benefit189", v || null)}
              options={[{ value: "", label: "Нет" }, ...data.benefits189.map((b) => ({ value: b.code, label: b.label }))]} />
          </Field>
          <Checkbox checked={d.under18} onChange={(v) => set("under18", v)} label="Младше 18 лет" description="Отпуск летом или в удобное время (ч. 4 ст. 168)" />
        </Group>

        {dirty && <Consequences preview={preview} busy={pending} error={error} ready={ready} isNew={!person} />}
      </div>

      {person && <DismissDialog open={dismissOpen} onClose={() => setDismissOpen(false)} person={person}
        onDone={(res) => onSaved(res as unknown as Data, "Сотрудник уволен", `${shortName(person.fullName)} убран из списков выбора — записано в журнал`)} />}
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] px-0.5">{title}</h3>
      <Surface nested pad={14} tone="flat" className="flex flex-col gap-3.5">{children}</Surface>
    </section>
  );
}

const TONE_ICON: Record<Consequence["tone"], { icon: LucideIcon; cls: string }> = {
  info: { icon: Info, cls: "text-info" },
  ok: { icon: CircleCheck, cls: "text-ok" },
  warn: { icon: TriangleAlert, cls: "text-warn" },
  bad: { icon: CircleAlert, cls: "text-bad" },
};

function Consequences({ preview, busy, error, ready, isNew }: {
  preview: PersonPreview | null; busy: boolean; error: string | null; ready: boolean; isNew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] px-0.5 flex items-center gap-2">
        Последствия{busy && <span className="text-[12.5px] font-normal text-muted">пересчитываю…</span>}
      </h3>
      <Surface nested pad={14} tone="tinted" className="flex flex-col gap-3">
        {!ready ? <p className="text-[13px] text-muted">Заполните обязательные поля — тогда посчитаю.</p>
          : error ? <p className="text-[13px] text-bad flex gap-2"><CircleAlert size={16} className="shrink-0 mt-0.5" />{error}</p>
          : !preview ? <p className="text-[13px] text-muted">Считаю…</p> : (
            <>
              {preview.consequences.length === 0 && <p className="text-[13px] text-muted">На график и очереди не влияет.</p>}
              {preview.consequences.map((c, i) => {
                const t = TONE_ICON[c.tone];
                return <p key={i} className="flex gap-2 text-[14px] leading-snug"><t.icon size={16} className={cx("shrink-0 mt-0.5", t.cls)} />{c.text}</p>;
              })}
              <People title="Появятся конфликты" items={preview.added} tone="bad" />
              <People title="Снимутся конфликты" items={preview.gone} tone="ok" />
              {!isNew && preview.changes.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1 border-t-[0.5px] border-line">
                  <span className="text-[12.5px] text-muted pt-2">В журнал запишется</span>
                  {preview.changes.map((c) => <DiffLine key={c.label} d={c} />)}
                </div>
              )}
            </>
          )}
      </Surface>
    </section>
  );
}

function People({ title, items, tone }: { title: string; items: PersonPreview["added"]; tone: "ok" | "bad" }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted">{title}</span>
      {items.map((i) => (
        <div key={i.key} className="flex items-start gap-2 text-[13px]">
          <Pill size="sm" tone={tone}>{i.ruleCode}</Pill>
          <span><b className="font-semibold">{shortName(i.employeeName)}</b>: {i.message}</span>
        </div>
      ))}
    </div>
  );
}

function DismissDialog({ open, onClose, person, onDone }: { open: boolean; onClose: () => void; person: Person; onDone: (res: unknown) => void }) {
  const [on, setOn] = useState(today());
  const [busy, start] = useTransition();
  const go = () => start(async () => {
    try { onDone(await dismissPerson(person.id, on)); onClose(); }
    catch (e) { toast("Не удалось уволить", { tone: "bad", description: errorText(e) }); }
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Уволить ${shortName(person.fullName)}?`}
      description="Карточка не удаляется: сотрудник пропадёт из списков выбора и графика, его история и записи журнала останутся. Вернуть можно в любой момент."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="destructive" icon={UserMinus} onClick={go} loading={busy} disabled={person.reports > 0}>Уволить</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Field label="Дата увольнения"><DatePicker value={on} onChange={setOn} /></Field>
        {person.reports > 0 && (
          <p className="text-[13px] text-bad flex gap-2"><ShieldCheck size={16} className="shrink-0 mt-0.5" />
            У сотрудника {person.reports} {plural(person.reports, ["подчинённый", "подчинённых", "подчинённых"])}. Сначала назначьте им другого руководителя.</p>
        )}
      </div>
    </Dialog>
  );
}

function errorText(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return /unexpected response|fetch|network/i.test(m) ? "Сервер не ответил, повторите через пару секунд" : m;
}
