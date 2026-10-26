"use client";

/**
 * Правила проверки. HR правит черновик — лимиты групп, связи ролей, правила регламента. Внизу
 * всплывает плашка: сколько изменений и сколько конфликтов станет (`previewRules` пересчитывает
 * график с черновиком, ничего не сохраняя). «Что изменится» раскрывает последствия по людям,
 * «Сохранить» пишет только разницу — по строке журнала на изменение (`saveRules`). Настройка
 * приватности (видят ли сотрудники имена коллег) сохраняется той же плашкой.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, EyeOff, Eye, Link2, Lock, Plus, RotateCcw, ShieldAlert, Users, X } from "lucide-react";
import {
  Avatar, Badge, Button, Checkbox, Field, IconButton, NumberStepper, PageHeader, Pill, Popover, Section, SegmentedControl, Select,
  Sheet, Surface, Switch, Tooltip, cx, toast,
} from "@/components/kit";
import type { LimitGroup, Role, RoleCode, RoleDependency, Rule, Scope, Severity, Stage } from "@/server/db/types";
import { previewRules, saveRules, type CheckSummary, type ConflictItem, type Privacy, type Route, type RulesDraft, type RulesPreview } from "@/server/actions/rules";
import {
  CONTRADICTS_TK, LAW_LABEL, LAW_MODE, MAIN_SEVERITIES, PARAM_META, PENALTY_NOTE, SCOPES, SCOPE_TEXT, SEVERITY_LABEL, STAGE_LABEL,
  legalRisks, plural, ruleChanges, ruleTitle, shortName, stageSeverity, type FieldChange,
} from "./meta";
import { DiffLine } from "./DiffLine";

type Dep = Omit<RoleDependency, "id"> & { id?: number; tmp?: number };
type Counts = { block: number; warn: number; exception: number };

interface Props {
  rules: Rule[];
  groups: LimitGroup[];
  dependencies: RoleDependency[];
  roles: Role[];
  privacy: Privacy;
  route: Route;
  /** Работающие — для выбора людей в маршруте */
  people: { id: string; fullName: string; position: string }[];
  summary: CheckSummary;
  headcount: Record<string, number>;
  /** Роль каждого сотрудника — чтобы разложить конфликты лимита по группам */
  roleOf: Record<string, RoleCode>;
}

interface Live { now: CheckSummary; next: CheckSummary | null }

export function RulesEditor(props: Props) {
  const router = useRouter();
  const [base, setBase] = useState({ rules: props.rules, groups: props.groups, deps: props.dependencies as Dep[], privacy: props.privacy, route: props.route });
  const [rules, setRules] = useState(props.rules);
  const [groups, setGroups] = useState(props.groups);
  const [deps, setDeps] = useState<Dep[]>(props.dependencies);
  const [privacy, setPrivacy] = useState(props.privacy);
  const [route, setRoute] = useState(props.route);
  const [summary, setSummary] = useState(props.summary);
  const [previewState, setPreview] = useState<RulesPreview | null>(null);
  const [errorState, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();

  const roleTitle = useMemo(() => new Map(props.roles.map((r) => [r.code, r.title])), [props.roles]);
  const draft: RulesDraft = useMemo(() => ({
    rules: rules.filter((r) => r.source !== "ТК").map(({ code, enabled, severity, params }) => ({ code, enabled, severity, params })),
    groups: groups.map(({ id, maxConcurrent, scope }) => ({ id, maxConcurrent, scope })),
    dependencies: deps.map(({ id, roleCode, requiresRole, scope, regClause }) => ({ id, roleCode, requiresRole, scope, regClause })),
    privacy, route,
  }), [rules, groups, deps, privacy, route]);

  const personName = useMemo(() => new Map(props.people.map((p) => [p.id, p.fullName])), [props.people]);
  const changes = useMemo(() => describe(base, rules, groups, deps, privacy, route, roleTitle, personName),
    [base, rules, groups, deps, privacy, route, roleTitle, personName]);
  const dirty = changes.length > 0;
  // без изменений прошлый пересчёт не показываем
  const preview = dirty ? previewState : null;
  const error = dirty ? errorState : null;

  // пересчёт графика с черновиком — с короткой задержкой после последней правки
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => start(async () => {
      try { setPreview(await previewRules(draft)); setError(null); }
      catch (e) { setError(errorText(e)); }
    }), 200);
    return () => clearTimeout(t);
  }, [draft, dirty]);

  const reset = () => { setRules(base.rules); setGroups(base.groups); setDeps(base.deps); setPrivacy(base.privacy); setRoute(base.route); setDetails(false); };
  const save = () => startSave(async () => {
    try {
      const before = summary.block + summary.warn;
      const res = await saveRules(draft);
      setBase({ rules: res.rules, groups: res.groups, deps: res.dependencies, privacy: res.privacy, route: res.route });
      setRules(res.rules); setGroups(res.groups); setDeps(res.dependencies); setPrivacy(res.privacy); setRoute(res.route);
      setSummary(res.summary); setPreview(null); setDetails(false);
      const after = res.summary.block + res.summary.warn;
      toast("Правила сохранены", {
        description: `${res.changed} ${plural(res.changed, ["изменение записано", "изменения записаны", "изменений записано"])} в журнал.${before === after ? "" : ` Конфликтов в графике: ${before} → ${after}.`}`,
        action: { label: "Журнал", onClick: () => router.push("/hr/log?type=rule") },
        duration: 6000,
      });
      router.refresh();
    } catch (e) {
      toast("Не удалось сохранить", { tone: "bad", description: errorText(e) });
    }
  });

  const setRule = (code: string, f: (r: Rule) => Rule) => setRules((l) => l.map((r) => (r.code === code ? f(r) : r)));
  const live: Live = { now: summary, next: preview?.next ?? null };
  const regulation = rules.filter((r) => r.source !== "ТК");
  const law = rules.filter((r) => r.source === "ТК");

  return (
    <div className={cx("flex flex-col gap-10 transition-[padding] duration-[var(--dur-2)]", dirty && "pb-24")}>
      <PageHeader
        title="Правила"
        subtitle="Регламент компании и нормы ТК РБ. После сохранения изменения сразу действуют в проверке."
        actions={<NowBadge summary={summary} />}
      />

      {/* data-tour — якоря тура «Помощь» (src/components/tour/steps.ts) */}
      <div data-tour="rules.route"><RouteSection route={route} base={base.route} people={props.people} onChange={setRoute} /></div>

      <div data-tour="rules.groups"><GroupsSection groups={groups} base={base.groups} roleTitle={roleTitle} headcount={props.headcount} roleOf={props.roleOf} live={live}
        onChange={(id, patch) => setGroups((l) => l.map((g) => (g.id === id ? { ...g, ...patch } : g)))} /></div>

      <div data-tour="rules.deps"><DepsSection deps={deps} base={base.deps} roles={props.roles} roleTitle={roleTitle} live={live} onChange={setDeps} /></div>

      <div data-tour="rules.regulation"><Section title="Регламент компании"
        description="Правила работодателя. Режим задаёт, что будет при нарушении: «Нужно исключение» — сотрудник отправит план только вместе с запросом исключения, решает РО1; «Предупреждение» — план уйдёт с пометкой.">
        <div className="flex flex-col divide-y-[0.5px] divide-line">
          {regulation.map((r) => (
            <RuleRow key={r.code} rule={r} base={base.rules.find((x) => x.code === r.code)!} live={live} onChange={(f) => setRule(r.code, f)} />
          ))}
        </div>
      </Section></div>

      <Section title="ТК РБ" description="Нормы закона проверяются всегда и для всех, выключить или ослабить их нельзя. «Нельзя нарушить» — план с таким нарушением не отправится, исключение его не снимет.">
        <div className="flex flex-col divide-y-[0.5px] divide-line">
          {law.map((r) => <LawRow key={r.code} rule={r} live={live} />)}
        </div>
      </Section>

      <div data-tour="rules.privacy"><PrivacySection privacy={privacy} changed={privacy.showColleagueNames !== base.privacy.showColleagueNames} onChange={setPrivacy} /></div>

      {/* пока строк R18–R20 нет в базе, пункты висят здесь; с ними — обычные карточки регламента с пометкой риска */}
      {CONTRADICTS_TK.some((x) => !rules.some((r) => r.code === x.code)) && (
      <Section title="Не проверяется: противоречит ТК" description="Эти пункты регламента система не применяет. Их стоит исправить в самом регламенте.">
        <div className="flex flex-col divide-y-[0.5px] divide-line">
          {CONTRADICTS_TK.filter((x) => !rules.some((r) => r.code === x.code)).map((x) => (
            <div key={x.clause} className="flex gap-3 py-3 first:pt-1 last:pb-1 px-1">
              <Pill tone="neutral" size="sm" className="mt-0.5">{x.clause}</Pill>
              <div className="min-w-0">
                <div className="text-[14px] text-muted line-through decoration-muted-2">{x.title}</div>
                <div className="text-[13px] text-text-2 mt-1 leading-relaxed">{x.why}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      )}

      <ChangesBar open={dirty} count={changes.length} summary={summary} preview={preview} busy={pending} saving={saving} error={error}
        onDetails={() => setDetails(true)} onReset={reset} onSave={save} />

      <ChangesSheet open={details && dirty} onClose={() => setDetails(false)} changes={changes} summary={summary} preview={preview}
        busy={pending} saving={saving} error={error} onReset={reset} onSave={save} />
    </div>
  );
}

/** Ошибка проверки — как есть; сбой связи с сервером — по-русски. */
function errorText(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return /unexpected response|fetch|network/i.test(m) ? "Сервер не ответил, повторите через пару секунд" : m;
}

/* ---------------- что изменилось ---------------- */

interface ChangeLine { what: string; diff: FieldChange[] }

const NAMES_TEXT = (on: boolean) => (on ? "видят" : "скрыты");

function describe(
  base: { rules: Rule[]; groups: LimitGroup[]; deps: Dep[]; privacy: Privacy; route: Route }, rules: Rule[], groups: LimitGroup[], deps: Dep[],
  privacy: Privacy, route: Route, roleTitle: Map<RoleCode, string>, personName: Map<string, string>,
): ChangeLine[] {
  const out: ChangeLine[] = [];
  const who = (id: string) => shortName(personName.get(id) ?? id);
  const routeDiff: FieldChange[] = [];
  for (const [k, label] of [["ro1Id", "РО1"], ["ro1ReviewerId", "Отпуск РО1 проверяет"], ["scheduleApproverId", "Утверждает график"]] as const)
    if (route[k] !== base.route[k]) routeDiff.push({ label, before: who(base.route[k]), after: who(route[k]) });
  if (route.unionRequired !== base.route.unionRequired)
    routeDiff.push({ label: "Профсоюз", before: base.route.unionRequired ? "согласует" : "не участвует", after: route.unionRequired ? "согласует" : "не участвует" });
  if (routeDiff.length) out.push({ what: "Маршрут согласования", diff: routeDiff });
  for (const g of groups) {
    const b = base.groups.find((x) => x.id === g.id)!;
    const diff: FieldChange[] = [];
    if (b.maxConcurrent !== g.maxConcurrent) diff.push({ label: "Лимит", before: String(b.maxConcurrent), after: String(g.maxConcurrent) });
    if (b.scope !== g.scope) diff.push({ label: "В пределах", before: b.scope, after: g.scope });
    if (diff.length) out.push({ what: g.name, diff });
  }
  const depName = (d: Dep) => `${roleTitle.get(d.roleCode)} ждёт: ${roleTitle.get(d.requiresRole)?.toLowerCase()}`;
  for (const b of base.deps) {
    const d = deps.find((x) => x.id === b.id);
    if (!d) out.push({ what: depName(b), diff: [{ label: "Связь", before: b.scope, after: "удалена" }] });
    else if (d.scope !== b.scope) out.push({ what: depName(d), diff: [{ label: "В пределах", before: b.scope, after: d.scope }] });
  }
  for (const d of deps.filter((x) => x.id == null)) out.push({ what: depName(d), diff: [{ label: "Связь", before: "нет", after: d.scope }] });
  for (const r of rules) {
    const b = base.rules.find((x) => x.code === r.code)!;
    const diff = ruleChanges(b, r);
    if (diff.length) out.push({ what: `${r.code}. ${ruleTitle(b)}`, diff });
  }
  if (privacy.showColleagueNames !== base.privacy.showColleagueNames)
    out.push({ what: "Имена коллег в календаре сотрудника", diff: [{ label: "Имена", before: NAMES_TEXT(base.privacy.showColleagueNames), after: NAMES_TEXT(privacy.showColleagueNames) }] });
  return out;
}

/* ---------------- счётчики ---------------- */

const norm = (c?: Counts): Counts => ({ block: c?.block ?? 0, warn: c?.warn ?? 0, exception: c?.exception ?? 0 });
const same = (a?: Counts, b?: Counts) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

function CountPills({ c, size = "sm" }: { c?: Counts; size?: "sm" | "md" }) {
  const n = norm(c);
  if (!n.block && !n.warn && !n.exception) return <Pill tone="ok" size={size}>нет нарушений</Pill>;
  return (
    <>
      {n.block > 0 && <Pill tone="bad" size={size}>{n.block} {plural(n.block, ["запрет", "запрета", "запретов"])}</Pill>}
      {n.warn > 0 && <Pill tone="warn" size={size}>{n.warn} {plural(n.warn, ["предупреждение", "предупреждения", "предупреждений"])}</Pill>}
      {n.exception > 0 && <Pill tone="info" size={size}>{n.exception} {plural(n.exception, ["исключение", "исключения", "исключений"])}</Pill>}
    </>
  );
}

/** Нарушения сейчас; если черновик их меняет — «сейчас → после сохранения». */
function NowNext({ now, next }: { now?: Counts; next?: Counts | null }) {
  const differs = next !== undefined && next !== null && !same(now, next);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <CountPills c={now} />
      {differs && <><span className="text-muted-2 text-[13px] px-0.5" aria-label="после сохранения">→</span><CountPills c={next} /></>}
    </span>
  );
}

function NowBadge({ summary }: { summary: CheckSummary }) {
  return (
    <Tooltip content={`Проверка графика ${new Date().getFullYear() + 1} сейчас: у ${summary.people} ${plural(summary.people, ["сотрудника", "сотрудников", "сотрудников"])}. Разрешено исключением РО1: ${summary.exception}.`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[13px] text-muted mr-1">В графике сейчас</span>
        <Pill tone="bad" dot>{summary.block} {plural(summary.block, ["запрет", "запрета", "запретов"])}</Pill>
        <Pill tone="warn" dot>{summary.warn} {plural(summary.warn, ["предупреждение", "предупреждения", "предупреждений"])}</Pill>
      </span>
    </Tooltip>
  );
}

/* ---------------- лимиты групп ---------------- */

function groupCounts(s: CheckSummary | null, roleOf: Record<string, RoleCode>, role: RoleCode): Counts | undefined {
  if (!s) return undefined;
  const c: Counts = { block: 0, warn: 0, exception: 0 };
  for (const i of s.items) if (i.ruleCode === "R01" && roleOf[i.employeeId] === role) c[i.level]++;
  return c;
}

function GroupsSection({ groups, base, roleTitle, headcount, roleOf, live, onChange }: {
  groups: LimitGroup[]; base: LimitGroup[]; roleTitle: Map<RoleCode, string>; headcount: Record<string, number>;
  roleOf: Record<string, RoleCode>; live: Live; onChange: (id: number, patch: Partial<LimitGroup>) => void;
}) {
  return (
    <Section title="Сколько человек может отдыхать одновременно" pad={8}
      description="Лимиты групп — параметр правила R01 (регламент). Считается и сам сотрудник.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {groups.map((g) => {
          const b = base.find((x) => x.id === g.id)!;
          const changed = b.maxConcurrent !== g.maxConcurrent || b.scope !== g.scope;
          const people = headcount[g.roleCode] ?? 0;
          return (
            <Surface key={g.id} nested pad={16} tone={changed ? "tinted" : "flat"} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-surface shadow-1 inline-flex items-center justify-center text-text-2 shrink-0"><Users size={17} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold tracking-[-0.01em] flex items-center gap-2">
                    {g.name}{changed && <Pill tone="accent" size="sm">изменено</Pill>}
                  </div>
                  <div className="text-[13px] text-muted mt-0.5">{roleTitle.get(g.roleCode)}: {people} {plural(people, ["человек", "человека", "человек"])} в компании. Регламент: {g.regClause}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[14px] text-text-2">Не больше</span>
                <NumberStepper aria-label={`${g.name}: лимит`} value={g.maxConcurrent} min={1} max={20}
                  suffix={plural(g.maxConcurrent, ["человека", "человек", "человек"])} onChange={(maxConcurrent) => onChange(g.id, { maxConcurrent })} />
                <div className="w-[200px]">
                  <Select size="sm" value={g.scope} onChange={(scope) => onChange(g.id, { scope })}
                    options={SCOPES.map((s) => ({ value: s, label: SCOPE_TEXT[s] }))} />
                </div>
              </div>
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <span>Сейчас:</span>
                <NowNext now={groupCounts(live.now, roleOf, g.roleCode)} next={live.next ? groupCounts(live.next, roleOf, g.roleCode) : null} />
              </div>
            </Surface>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------------- маршрут согласования ---------------- */

function RouteSection({ route, base, people, onChange }: { route: Route; base: Route; people: Props["people"]; onChange: (r: Route) => void }) {
  const name = (id: string) => people.find((p) => p.id === id)?.fullName ?? id;
  const opts = (exclude: string[] = []) => people.map((p) => ({
    value: p.id, label: p.fullName, description: p.position, leading: <Avatar name={p.fullName} size={22} />,
    disabled: exclude.includes(p.id),
  }));
  const changed = (k: keyof Route) => route[k] !== base[k];
  return (
    <Section title="Маршрут согласования" pad={8}
      description="Заявление пишется на имя РО1 через непосредственного руководителя (регламент). График утверждает наниматель, с профсоюзом — если это есть в коллективном договоре, затем его доводят до всех работников (ч. 1–2 ст. 168 ТК).">
      <div className="flex flex-col gap-2">
        <Surface nested pad={14} tone="flat" className="flex flex-wrap items-center gap-1.5">
          <RouteStep label="Сотрудник" /><RouteArrow />
          <RouteStep label="Руководитель" /><RouteArrow />
          <RouteStep label="РО1" who={name(route.ro1Id)} /><RouteArrow />
          {/* профсоюз согласует до утверждения: протокол прикладывают при отправке (ч. 1 ст. 168 ТК) */}
          {route.unionRequired && <><RouteStep label="Профсоюз" /><RouteArrow /></>}
          <RouteStep label="Утверждает" who={name(route.scheduleApproverId)} /><RouteArrow />
          <RouteStep label="Все работники" />
        </Surface>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Surface nested pad={16} tone={changed("ro1Id") ? "tinted" : "flat"}>
            <Field label="РО1 — проверяет заявки и ведёт график"
              hint="После непосредственного руководителя заявка приходит к нему. Руководитель каждого сотрудника — в его карточке на экране «Сотрудники».">
              <Select searchable value={route.ro1Id} onChange={(v) => onChange({ ...route, ro1Id: v })} options={opts([route.ro1ReviewerId, route.scheduleApproverId])} />
            </Field>
          </Surface>
          <Surface nested pad={16} tone={changed("ro1ReviewerId") ? "tinted" : "flat"}>
            <Field label="Кто проверяет отпуск самого РО1" hint="Свой отпуск РО1 не согласует.">
              <Select searchable value={route.ro1ReviewerId} onChange={(v) => onChange({ ...route, ro1ReviewerId: v })} options={opts([route.ro1Id])} />
            </Field>
          </Surface>
          <Surface nested pad={16} tone={changed("scheduleApproverId") ? "tinted" : "flat"}>
            <Field label="Кто утверждает график" hint="Наниматель или уполномоченный им руководитель (ч. 1 ст. 168 ТК). Не РО1: он график составляет.">
              <Select searchable value={route.scheduleApproverId} onChange={(v) => onChange({ ...route, scheduleApproverId: v })} options={opts([route.ro1Id])} />
            </Field>
          </Surface>
          <Surface nested pad={16} tone={changed("unionRequired") ? "tinted" : "flat"} className="flex flex-col justify-center">
            <Switch checked={route.unionRequired} onChange={(v) => onChange({ ...route, unionRequired: v })}
              label="Согласование с профсоюзом"
              description="Если это предусмотрено коллективным договором (ч. 1 ст. 168 ТК): перед утверждением РО1 вносит дату и номер протокола." />
          </Surface>
        </div>
      </div>
    </Section>
  );
}

/** Шаг маршрута — пилюля с аватаром (или значком группы людей). */
function RouteStep({ who, label }: { who?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-8 pl-1 pr-3 rounded-full bg-surface shadow-1 text-[13px] whitespace-nowrap">
      {who ? <Avatar name={who} size={24} />
        : <span className="w-6 h-6 rounded-full bg-fill inline-flex items-center justify-center text-muted"><Users size={13} /></span>}
      <span><span className="text-muted">{label}</span>{who ? ` ${shortName(who)}` : ""}</span>
    </span>
  );
}
const RouteArrow = () => <ChevronRight size={14} className="text-muted-2 shrink-0" />;

/* ---------------- приватность ---------------- */

function PrivacySection({ privacy, changed, onChange }: { privacy: Privacy; changed: boolean; onChange: (p: Privacy) => void }) {
  const on = privacy.showColleagueNames;
  return (
    <Section title="Приватность" pad={8}
      description="Что сотрудник видит о коллегах, когда выбирает даты отпуска.">
      <Surface nested pad={16} tone={changed ? "tinted" : "flat"} className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-surface shadow-1 inline-flex items-center justify-center text-text-2 shrink-0">
          {on ? <Eye size={17} /> : <EyeOff size={17} />}
        </span>
        <Switch className="flex-1 min-w-0" checked={on} onChange={(v) => onChange({ showColleagueNames: v })}
          label={<span className="text-[15px] font-semibold tracking-[-0.01em] inline-flex items-center gap-2">
            Сотрудники видят имена коллег{changed && <Pill tone="accent" size="sm">изменено</Pill>}
          </span>}
          description={<span className="block text-[13px] leading-relaxed max-w-[640px]">
            Сотрудник видит, кто из его группы и кого он замещает в отпуске в выбранные даты. Утверждённый график
            по ч. 2 ст. 168 ТК доводится до всех работников. Выключите, если в компании принято не раскрывать.
          </span>} />
      </Surface>
    </Section>
  );
}

/* ---------------- связи ролей ---------------- */

function DepsSection({ deps, base, roles, roleTitle, live, onChange }: {
  deps: Dep[]; base: Dep[]; roles: Role[]; roleTitle: Map<RoleCode, string>; live: Live;
  onChange: (f: (l: Dep[]) => Dep[]) => void;
}) {
  const byRole = roles.map((r) => ({
    role: r,
    list: deps.filter((d) => d.roleCode === r.code),
    removed: base.filter((b) => b.roleCode === r.code && !deps.some((d) => d.id === b.id)),
  })).filter((x) => x.list.length || x.removed.length);

  return (
    <Section title="Кто без кого не уходит" pad={8}
      description={<>Связи ролей — параметр правила R02 «Кто без кого не уходит»: роль уходит в отпуск, только если связанная с ней роль на месте. Сейчас: <span className="inline-flex align-middle"><NowNext now={live.now.byRule.R02} next={live.next ? live.next.byRule.R02 ?? norm() : null} /></span></>}
      action={<AddDependency roles={roles} deps={deps} onAdd={(d) => onChange((l) => [...l, d])} />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {byRole.map(({ role, list, removed }) => (
          <Surface key={role.code} nested pad={16} tone="flat" className="flex flex-col gap-2.5">
            <div>
              <div className="text-[15px] font-semibold tracking-[-0.01em]">{role.title}</div>
              <div className="text-[13px] text-muted">уходит, только если на месте</div>
            </div>
            {list.map((d) => {
              const b = d.id != null ? base.find((x) => x.id === d.id) : undefined;
              return (
                <div key={d.id ?? `n${d.tmp}`} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 inline-flex items-center gap-2 text-[14px]">
                    <Link2 size={14} className="text-muted-2 shrink-0" />
                    <span className="truncate">{roleTitle.get(d.requiresRole)}</span>
                    {!b && <Pill tone="accent" size="sm">новая</Pill>}
                  </span>
                  <div className="w-[200px] shrink-0">
                    <Select size="sm" value={d.scope as Scope}
                      options={SCOPES.map((s) => ({ value: s, label: SCOPE_TEXT[s] }))}
                      onChange={(scope) => onChange((l) => l.map((x) => (x === d ? { ...x, scope } : x)))} />
                  </div>
                  <IconButton icon={X} label="Удалить связь" size="sm" onClick={() => onChange((l) => l.filter((x) => x !== d))} />
                </div>
              );
            })}
            {removed.map((b) => (
              <div key={`del${b.id}`} className="flex items-center gap-2 text-[14px]">
                <span className="flex-1 min-w-0 text-muted line-through truncate">{roleTitle.get(b.requiresRole)}, {SCOPE_TEXT[b.scope as Scope]}</span>
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onChange((l) => [...l, b])}>Вернуть</Button>
              </div>
            ))}
          </Surface>
        ))}
      </div>
    </Section>
  );
}

function AddDependency({ roles, deps, onAdd }: { roles: Role[]; deps: Dep[]; onAdd: (d: Dep) => void }) {
  const [v, setV] = useState<{ roleCode: RoleCode; requiresRole: RoleCode; scope: Scope }>({ roleCode: "МПП", requiresRole: "НО", scope: "отдел" });
  const opts = roles.map((r) => ({ value: r.code, label: r.title }));
  const exists = deps.some((d) => d.roleCode === v.roleCode && d.requiresRole === v.requiresRole);
  const self = v.roleCode === v.requiresRole;
  return (
    <Popover width={340} placement="bottom-end" content={(close) => (
      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-semibold">Новая связь ролей</div>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">Роль
          <Select value={v.roleCode} options={opts} onChange={(roleCode) => setV({ ...v, roleCode })} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">уходит, только если на месте
          <Select value={v.requiresRole} options={opts} onChange={(requiresRole) => setV({ ...v, requiresRole })} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">В пределах
          <Select value={v.scope} options={SCOPES.map((s) => ({ value: s, label: SCOPE_TEXT[s] }))} onChange={(scope) => setV({ ...v, scope })} />
        </label>
        {(exists || self) && <div className="text-[13px] text-bad">{self ? "Роль не может ждать саму себя" : "Такая связь уже есть"}</div>}
        <Button variant="primary" block disabled={exists || self}
          onClick={() => { onAdd({ ...v, regClause: "кто без кого не уходит", tmp: Date.now() }); close(); }}>Добавить</Button>
      </div>
    )}>
      <Button size="sm" variant="tinted" icon={Plus}>Добавить связь</Button>
    </Popover>
  );
}

/* ---------------- правило регламента ---------------- */

const severityOptions = (code: string) => (MAIN_SEVERITIES[code] ?? ["block", "warn", "info"]).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }));
const STAGE_SEVERITY = (["block", "warn", "info", "off"] as Severity[]).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }));

function RuleRow({ rule: r, base: b, live, onChange }: { rule: Rule; base: Rule; live: Live; onChange: (f: (r: Rule) => Rule) => void }) {
  const [open, setOpen] = useState(false);
  const meta = PARAM_META[r.code];
  const risks = legalRisks(r);
  const changed = ruleChanges(b, r).length > 0;
  const setStage = (s: Stage, v: Severity) =>
    onChange((x) => s === "collect"
      ? { ...x, severity: v, params: { ...x.params, stages: { ...x.params.stages, collect: v } } }
      : { ...x, params: { ...x.params, stages: { ...x.params.stages, [s]: v } } });
  const [before, after] = r.title.split(/\bN\b/);
  const value = Number(r.params.value);

  return (
    <div className="py-4 first:pt-2 last:pb-2 px-1">
      <div className="flex items-start gap-4">
        <div className="pt-0.5"><Switch checked={r.enabled} onChange={(enabled) => onChange((x) => ({ ...x, enabled }))} /></div>
        <div className="flex-1 min-w-0">
          <div className={cx("text-[15px] font-semibold tracking-[-0.01em] leading-snug flex flex-wrap items-center gap-x-2 gap-y-1", !r.enabled && "text-muted")}>
            <span className="text-muted-2 font-medium tnum">{r.code}</span>
            {meta && after !== undefined ? (
              <>
                <span>{before.trim()}</span>
                <NumberStepper aria-label={`${r.code}: N`} value={value} min={meta.min} max={meta.max} disabled={!r.enabled}
                  onChange={(v) => onChange((x) => ({ ...x, params: { ...x.params, value: v } }))} />
                {after.trim() && <span>{after.trim()}</span>}
              </>
            ) : <span>{ruleTitle(r)}</span>}
            {changed && <Pill tone="accent" size="sm">изменено</Pill>}
            {risks.length > 0 && (
              <Tooltip content={<div className="max-w-[320px] flex flex-col gap-1.5">{risks.map((x, i) => <p key={i}>{x.text}</p>)}</div>}>
                <span tabIndex={0}><Pill tone="bad" size="sm" icon={ShieldAlert}>юридический риск</Pill></span>
              </Tooltip>
            )}
          </div>
          <div className="text-[13px] text-muted mt-1 leading-relaxed">{r.howChecked}</div>
          {r.enabled && (
            <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[13px] text-muted">
              <span>В графике:</span>
              <NowNext now={live.now.byRule[r.code]} next={live.next ? live.next.byRule[r.code] ?? norm() : null} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {r.enabled ? (
            <SegmentedControl size="sm" aria-label={`${r.code}: строгость при сборе графика`} value={stageSeverity(r, "collect")}
              options={severityOptions(r.code)} onChange={(v) => setStage("collect", v)} />
          ) : <Pill tone="neutral">выключено</Pill>}
          <IconButton icon={ChevronDown} label={open ? "Свернуть" : "Подробнее: этапы, льготники, основание"} size="sm"
            onClick={() => setOpen(!open)} className={cx("transition-transform duration-[var(--dur-2)]", open && "rotate-180")} />
        </div>
      </div>

      {open && (
        <Surface nested pad={16} tone="flat" className="mt-3 ml-[58px] flex flex-col gap-3.5">
          <div className="text-[13px] text-muted">Строгость на других этапах. Сверху — при сборке графика.</div>
          {(["adhoc", "inplan"] as Stage[]).map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-3">
              <span className="w-[170px] text-[14px] text-text-2">{STAGE_LABEL[s]}</span>
              <SegmentedControl size="sm" aria-label={`${r.code}: ${STAGE_LABEL[s]}`} value={stageSeverity(r, s)} options={STAGE_SEVERITY}
                onChange={(v) => setStage(s, v)} />
            </div>
          ))}
          <Checkbox checked={!!r.params.benefitApplies} label="Применять к льготникам ч. 4 ст. 168 и работникам до 18 лет"
            description="Льготники берут отпуск в удобное время; лимиты регламента к ним по закону не применяются."
            onChange={(v) => onChange((x) => ({ ...x, params: { ...x.params, benefitApplies: v } }))} />
          <div className="text-[13px] text-muted">Основание: <span className="text-text-2">{r.basis}</span></div>
          {risks.length > 0 && (
            <div className="flex gap-2.5 text-[13px] leading-relaxed">
              <ShieldAlert size={16} className="text-bad shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1.5">
                {risks.map((x, i) => (
                  <p key={i} className="text-text-2">{x.stage && x.stage !== "benefit" && <b className="font-semibold">{STAGE_LABEL[x.stage]}. </b>}{x.text}</p>
                ))}
                <p className="text-muted">{PENALTY_NOTE}</p>
              </div>
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}

function LawRow({ rule: r, live }: { rule: Rule; live: Live }) {
  const mode = LAW_MODE[r.code]?.replace(/\bN\b/, String(r.params.value));
  return (
    <div className="flex items-start gap-4 py-3.5 first:pt-2 last:pb-2 px-1">
      <Tooltip content="Норма закона: меняется только вместе с ТК, исключением не снимается">
        <span tabIndex={0} className="w-[42px] h-[26px] rounded-full bg-fill-2 inline-flex items-center justify-center text-muted shrink-0">
          <Lock size={14} />
        </span>
      </Tooltip>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold tracking-[-0.01em] leading-snug">
          <span className="text-muted-2 font-medium tnum mr-2">{r.code}</span>{ruleTitle(r)}
        </div>
        <div className="text-[13px] text-muted mt-1 leading-relaxed">{r.howChecked}</div>
        <div className="text-[12.5px] text-muted-2 mt-1">{r.basis}</div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Pill tone={r.severity === "block" ? "bad" : r.severity === "warn" ? "warn" : "info"}>{LAW_LABEL[r.severity]}</Pill>
        {mode && <span className="text-[12px] text-muted text-right max-w-[220px] leading-snug">{mode}</span>}
        <span className="inline-flex gap-1"><NowNext now={live.now.byRule[r.code]} next={live.next ? live.next.byRule[r.code] ?? norm() : null} /></span>
      </div>
    </div>
  );
}

/* ---------------- плашка изменений и предпросмотр ---------------- */

function Delta({ now, next, blockNow, blockNext }: { now: number; next: number; blockNow: number; blockNext: number }) {
  const d = next - now, b = blockNext - blockNow;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tnum">{next}</span>
      <Pill tone={d < 0 ? "ok" : d > 0 ? "bad" : "neutral"} size="sm">{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "столько же"}</Pill>
      {b !== 0 && <Pill tone={b > 0 ? "bad" : "ok"} size="sm">запретов {b > 0 ? `+${b}` : `−${-b}`}</Pill>}
    </span>
  );
}

function ChangesBar({ open, count, summary, preview, busy, saving, error, onDetails, onReset, onSave }: {
  open: boolean; count: number; summary: CheckSummary; preview: RulesPreview | null; busy: boolean; saving: boolean; error: string | null;
  onDetails: () => void; onReset: () => void; onSave: () => void;
}) {
  const now = summary.block + summary.warn;
  const next = preview ? preview.next.block + preview.next.warn : null;
  return (
    <div aria-hidden={!open}
      className={cx("fixed left-1/2 bottom-6 z-40 -translate-x-1/2 transition-all duration-[var(--dur-3)] ease-[var(--ease-spring)]",
        open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6 pointer-events-none")}>
      <Surface data-tour="rules.bar" level="block" pad={8} tone="raised" className="flex items-center gap-3 pl-5"
        style={{ borderRadius: 9999, boxShadow: "var(--shadow-3)" }}>
        <span className="inline-flex items-center gap-2 text-[14px] font-medium whitespace-nowrap">
          <Badge>{count}</Badge>{plural(count, ["изменение", "изменения", "изменений"])}
        </span>
        <span className="w-px h-5 bg-line" />
        <span className={cx("inline-flex items-center gap-2 text-[14px] whitespace-nowrap transition-opacity", busy && "opacity-50")}>
          {error ? <span className="text-bad">{error}</span> : (
            <>
              <span className="text-muted">конфликтов станет</span>
              {next === null || !preview ? <span className="text-muted">…</span> : <Delta now={now} next={next} blockNow={summary.block} blockNext={preview.next.block} />}
            </>
          )}
        </span>
        <Button pill variant="ghost" onClick={onDetails} disabled={!preview}>Что изменится</Button>
        <Button pill variant="secondary" onClick={onReset} disabled={saving}>Сбросить</Button>
        <Button pill variant="primary" onClick={onSave} loading={saving} disabled={!!error}>Сохранить</Button>
      </Surface>
    </div>
  );
}

function ChangesSheet({ open, onClose, changes, summary, preview, busy, saving, error, onReset, onSave }: {
  open: boolean; onClose: () => void; changes: ChangeLine[]; summary: CheckSummary; preview: RulesPreview | null;
  busy: boolean; saving: boolean; error: string | null; onReset: () => void; onSave: () => void;
}) {
  const risky = changes.some((c) => c.diff.some((d) => d.risky));
  return (
    <Sheet open={open} onClose={onClose} width={460} title="Что изменится"
      description="Проверка графика с новыми правилами. Пока ничего не сохранено."
      footer={<><Button variant="secondary" block onClick={onReset} disabled={saving}>Сбросить</Button><Button variant="primary" block onClick={onSave} loading={saving} disabled={!!error}>Сохранить</Button></>}>
      <div className={cx("flex flex-col gap-5 transition-opacity", busy && "opacity-60")}>
        <div className="grid grid-cols-2 gap-2">
          <Surface nested pad={14} tone="flat">
            <div className="text-[13px] text-muted">Запретов</div>
            <div className="text-[24px] font-semibold tnum tracking-[-0.02em]">{summary.block} <span className="text-muted-2">→</span> <span className={preview && preview.next.block < summary.block ? "text-ok" : preview && preview.next.block > summary.block ? "text-bad" : ""}>{preview?.next.block ?? "…"}</span></div>
          </Surface>
          <Surface nested pad={14} tone="flat">
            <div className="text-[13px] text-muted">Предупреждений</div>
            <div className="text-[24px] font-semibold tnum tracking-[-0.02em]">{summary.warn} <span className="text-muted-2">→</span> <span className={preview && preview.next.warn < summary.warn ? "text-ok" : preview && preview.next.warn > summary.warn ? "text-bad" : ""}>{preview?.next.warn ?? "…"}</span></div>
          </Surface>
        </div>

        {preview && <People title="Конфликт снимется" items={preview.gone} tone="ok" />}
        {preview && <People title="Появится конфликт" items={preview.added} tone="bad" />}
        {preview && !preview.gone.length && !preview.added.length && (
          <div className="text-[14px] text-muted">Состав конфликтов не меняется{preview.next.block !== summary.block ? ", меняется только их строгость" : ""}.</div>
        )}

        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-muted">Изменения</div>
          {changes.map((c, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="text-[14px] font-medium">{c.what}</div>
              <div className="flex flex-col gap-1">
                {c.diff.map((d, j) => <DiffLine key={j} d={d} />)}
              </div>
            </div>
          ))}
          {risky && (
            <div className="flex gap-2 text-[13px] text-bad mt-1"><ShieldAlert size={15} className="shrink-0 mt-0.5" />Есть изменения с юридическим риском — пояснение у правила, значок «юридический риск».</div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function People({ title, items, tone }: { title: string; items: ConflictItem[]; tone: "ok" | "bad" }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className={cx("text-[13px] font-semibold", tone === "ok" ? "text-ok" : "text-bad")}>{title}: {items.length}</div>
      {items.map((i) => (
        <div key={i.key} className="flex items-start gap-3">
          <Avatar name={i.employeeName} size={30} />
          <div className="min-w-0">
            <div className="text-[14px] font-medium">{shortName(i.employeeName)}</div>
            <div className="text-[13px] text-muted leading-snug">{i.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
