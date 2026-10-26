"use client";

/**
 * Сбор графика: сводка, путь до сроков, кто не подал (напомнить), где ждут решения,
 * тепловая лента загрузки по месяцам и кто уходит — для бухгалтерии (отпускные за 2 дня, ст. 176).
 * Месяц в ленте и в списке бухгалтерии один: щелчок по месяцу ленты открывает его уходы.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Bell, CalendarClock, Download, Inbox, PartyPopper, ShieldAlert } from "lucide-react";
import {
  Avatar, Button, Card, Divider, EmptyState, PageHeader, Pill, Section, SegmentedControl, Select, Stat, Tooltip, cx, toast,
} from "@/components/kit";
import type { ChangeItem, DashboardRow, Departure, MonthLoad } from "@/server/actions/dashboard";
import { sendReminders } from "@/server/actions/dashboard";
import { plural, shortName } from "./meta";
import { DiffLine } from "./DiffLine";
import { ScheduleApproval } from "./ScheduleApproval";
import { TREATMENT_KIND_LABEL, VACATION_TYPE_LABEL, type Schedule } from "@/server/db/types";

interface Data {
  year: number; today: string; deadline: string; scheduleDeadline: string; collectStart: string;
  rows: DashboardRow[]; departures: Departure[]; load: MonthLoad[]; exceptionRequests: number;
  changes: { hr: ChangeItem[]; manager: ChangeItem[] };
  conflicts: { block: number; warn: number; exceptions: number; people: number };
  schedules: Schedule[]; route: { approver: string; unionRequired: boolean }; names: Record<string, string>; working: number;
  parts: { total: number; approved: number; pending: number; draft: number };
}

const MON = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MON_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const day = (iso: string) => `${+iso.slice(8, 10)} ${MON_GEN[+iso.slice(5, 7) - 1]}`;
const wd = (iso: string) => WD[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const range = (a: string, b: string) => (a.slice(5, 7) === b.slice(5, 7) ? `${+a.slice(8, 10)}–${day(b)}` : `${day(a)} — ${day(b)}`);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const stamp = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function DashboardView(d: Data) {
  const [reminded, setReminded] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.rows.filter((r) => r.remindedAt).map((r) => [r.employee.id, r.remindedAt!])));
  const [busy, start] = useTransition();
  // месяцы для бухгалтерии — от текущего на 14 вперёд, ключ «ГГГГ-ММ»; по регламенту РО1 передаёт тех,
  // кто уходит в ближайшем месяце, — по умолчанию следующий календарный месяц
  const months = useMemo(() => {
    const t = new Date(`${d.today}T00:00:00Z`);
    return Array.from({ length: 15 }, (_, i) => {
      const m = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
      return { key: m, count: d.departures.filter((x) => x.start.slice(0, 7) === m).length };
    });
  }, [d.departures, d.today]);
  const nearest = months[1].key;
  const [month, setMonth] = useState(nearest);

  const none = d.rows.filter((r) => r.lane === "none");
  const total = d.rows.length;
  const plannedDays = d.rows.reduce((s, r) => s + r.planned, 0);
  const approvedDays = d.rows.reduce((s, r) => s + r.approvedDays, 0);
  const share = plannedDays ? Math.round((approvedDays / plannedDays) * 100) : 0;
  const unused = d.rows.map((r) => ({ r, left: Math.max(0, r.norm - r.planned) })).filter((x) => x.left > 0).sort((a, b) => b.left - a.left);
  const unusedTotal = unused.reduce((s, x) => s + x.left, 0);
  const waitingHr = d.rows.filter((r) => r.lane === "hr").length;

  const remind = (kind: "plan" | "decision", list: Addressee[]) => start(async () => {
    try {
      const res = await sendReminders(kind, list.map((r) => r.employee.id));
      setReminded((m) => ({ ...m, ...Object.fromEntries(list.map((r) => [r.employee.id, res.at ?? new Date().toISOString()])) }));
      const who = list.length === 1
        ? kind === "decision" ? `Руководителю: ${shortName(list[0].managerName ?? "")}` : shortName(list[0].employee.fullName)
        : `${list.length} ${plural(list.length, ["адресат", "адресата", "адресатов"])}`;
      toast("Напоминание отправлено", { description: `${who} — записано в журнал` });
    } catch (e) {
      toast("Не удалось отправить", { tone: "bad", description: e instanceof Error ? e.message : undefined });
    }
  });

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={`Сбор графика ${d.year}`}
        subtitle={`По регламенту график на полугодие: I — до ${day(d.deadline)}, II — до ${day(d.scheduleDeadline)} ${d.year}`}
        actions={<Button data-tour="dash.export" icon={Download} onClick={() => downloadCsv(d.departures, `grafik-${d.year}.csv`)}>Выгрузить график CSV</Button>} />

      <ScheduleApproval halves={d.schedules} approver={d.route.approver} unionRequired={d.route.unionRequired} names={d.names} working={d.working}
        ready={{
          notSubmitted: none.length, notSubmittedNames: none.map((r) => r.employee.fullName),
          atManager: d.rows.filter((r) => r.lane === "manager").length + d.changes.manager.length,
          atManagerNames: [...d.rows.filter((r) => r.lane === "manager").map((r) => r.employee.fullName), ...d.changes.manager.map((c) => c.employee.fullName)],
          conflicts: d.conflicts.block + d.conflicts.warn, exceptionRequests: d.exceptionRequests, today: d.today,
        }} />

      {/* data-tour — якоря тура «Помощь» (src/components/tour/steps.ts) */}
      <Card data-tour="dash.summary" pad={24} className="flex flex-col gap-6">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-6">
          <Stat label="Подали план" value={`${total - none.length} из ${total}`} hint={`${Math.round(((total - none.length) / Math.max(1, total)) * 100)}% сотрудников`} />
          <Stat label="Согласовано" value={`${share}%`} tone="ok" hint={`${approvedDays} из ${plannedDays} дней отпуска`} />
          <Stat label="Конфликты" value={d.conflicts.block + d.conflicts.warn} tone={d.conflicts.block ? "bad" : d.conflicts.warn ? "warn" : undefined}
            hint={`${d.conflicts.block} ${plural(d.conflicts.block, ["запрет", "запрета", "запретов"])}, ждут РО1: ${waitingHr}`} />
          <Stat label="Запросы исключений" value={d.exceptionRequests} tone={d.exceptionRequests ? "warn" : undefined}
            hint={d.exceptionRequests ? `${plural(d.exceptionRequests, ["часть ждёт", "части ждут", "частей ждут"])} решения РО1` : "регламент нигде не нарушен"} />
          <Stat label="Не подали" value={none.length} tone={none.length ? "warn" : "ok"} hint={none.length ? none.map((r) => shortName(r.employee.fullName)).join(", ") : "все на месте"} />
          <Tooltip content={unused.length ? unused.map((x) => `${shortName(x.r.employee.fullName)} — ${x.left}`).join(", ") : "Норма распределена у всех"}>
            <div tabIndex={0}><Stat label="Не распределено" value={unusedTotal} hint={`${plural(unusedTotal, ["день", "дня", "дней"])} у ${unused.length} ${plural(unused.length, ["сотрудника", "сотрудников", "сотрудников"])}`} /></div>
          </Tooltip>
        </div>
        <Divider />
        <Timeline start={d.collectStart} today={d.today} deadline={d.deadline} schedule={d.scheduleDeadline} submitted={(total - none.length) / Math.max(1, total)} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div data-tour="dash.missing" id="missing" className="scroll-mt-[calc(var(--header-h)+16px)]"><Section title="Не подали" description={`Заявления на I полугодие — до ${day(d.deadline)}. Напоминание приходит уведомлением в приложении и попадает в журнал.`}
          action={none.length > 1 && <Button size="sm" variant="tinted" icon={Bell} loading={busy} onClick={() => remind("plan", none)}>Напомнить всем</Button>}
          pad={8}>
          {none.length === 0 ? (
            <EmptyState icon={PartyPopper} title="Все подали план" description="Осталось согласовать и разобрать конфликты." />
          ) : (
            <div className="flex flex-col divide-y-[0.5px] divide-line">
              {none.map((r) => (
                <PersonRow key={r.employee.id} r={r}
                  meta={<>
                    <Pill size="sm" tone={r.request?.status === "returned" ? "info" : "neutral"}>
                      {r.request?.status === "returned" ? "возвращён" : r.request?.status === "draft" ? "черновик" : "не начат"}
                    </Pill>
                    {reminded[r.employee.id] && <span className="text-[12.5px] text-muted">напомнили {stamp(reminded[r.employee.id])}</span>}
                  </>}
                  action={<Button size="sm" icon={Bell} disabled={busy} onClick={() => remind("plan", [r])}>Напомнить</Button>} />
              ))}
            </div>
          )}
        </Section></div>

        <div data-tour="dash.pending" id="pending" className="scroll-mt-[calc(var(--header-h)+16px)]"><Waiting rows={d.rows} changes={d.changes} reminded={reminded} busy={busy} onRemind={(list) => remind("decision", list)} /></div>
      </div>

      <Section title="Загрузка по месяцам" pad={16}
        description="Сколько человеко-дней отпуска приходится на месяц (поданные и согласованные части). Нажмите на месяц — ниже откроются его уходы.">
        <Heatmap load={d.load} month={month.startsWith(`${d.year}-`) ? +month.slice(5, 7) - 1 : -1} onPick={(m) => setMonth(`${d.year}-${String(m + 1).padStart(2, "0")}`)} />
      </Section>

      <Payroll departures={d.departures} month={month} nearest={nearest} months={months} onMonth={setMonth} />
    </div>
  );
}

/* ---------------- путь до сроков ---------------- */

function Timeline({ start, today, deadline, schedule, submitted }: { start: string; today: string; deadline: string; schedule: string; submitted: number }) {
  const span = Math.max(1, daysBetween(start, schedule));
  const at = (iso: string) => `${Math.min(100, Math.max(0, (daysBetween(start, iso) / span) * 100))}%`;
  const toDeadline = daysBetween(today, deadline);
  const toSchedule = daysBetween(today, schedule);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="inline-flex items-center gap-2 text-[15px] font-semibold"><CalendarClock size={17} className="text-muted" />
          {toDeadline > 0 ? <>до графика на I полугодие {toDeadline} {plural(toDeadline, ["день", "дня", "дней"])}</> : "срок I полугодия прошёл"}
        </span>
        <span className="text-[14px] text-muted">{toSchedule > 0 ? `до графика на II полугодие ${toSchedule} ${plural(toSchedule, ["день", "дня", "дней"])}` : "срок II полугодия прошёл"}</span>
        <span className="text-[14px] text-muted ml-auto">прошло {Math.round((daysBetween(start, today) / span) * 100)}% времени, подали {Math.round(submitted * 100)}%</span>
      </div>
      <div className="relative h-[60px]">
        <div className="absolute inset-x-0 top-[22px] h-2 rounded-full bg-fill" />
        <div className="absolute left-0 top-[22px] h-2 rounded-full bg-accent" style={{ width: at(today) }} />
        {[
          { iso: start, label: `старт ${day(start)}`, align: "left" },
          { iso: today, label: "сегодня", align: "center", now: true },
          { iso: deadline, label: `I полугодие, ${day(deadline)}`, align: "center" },
          { iso: schedule, label: `II полугодие, ${day(schedule)}`, align: "right" },
        ].map((m) => (
          <div key={m.label} className="absolute top-0" style={{ left: at(m.iso) }}>
            <span className={cx("absolute top-[19px] -translate-x-1/2 w-3.5 h-3.5 rounded-full ring-[3px] ring-surface", m.now ? "bg-accent-strong" : "bg-muted-2")} />
            <span className={cx("absolute whitespace-nowrap text-[12px]", m.now ? "top-0 text-accent-strong font-semibold" : "top-[38px] text-muted",
              m.align === "left" ? "left-[-7px]" : m.align === "right" ? "right-[-7px]" : "-translate-x-1/2")}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- люди ---------------- */

/** Кому напоминать: сотруднику (подать план) или его руководителю (решить). */
type Addressee = Pick<DashboardRow, "employee" | "managerName">;

function PersonRow({ r, meta, action }: { r: Addressee; meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <Avatar name={r.employee.fullName} size={36} />
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold tracking-[-0.01em] truncate">{r.employee.fullName}</div>
        <div className="text-[13px] text-muted truncate">{r.employee.position}{r.employee.department ? `, ${r.employee.department}` : ""}</div>
        {meta && <div className="flex flex-wrap items-center gap-2 mt-1.5">{meta}</div>}
      </div>
      {action}
    </div>
  );
}

const CONSEQUENCE = { law: "нельзя", exception: "нужно исключение", warning: "предупреждение" } as const;
const ISSUE: Record<string, string> = { R00: "даты в прошлом", R01: "лимит группы", R02: "без кого не уходит", R03: "лето", R04: "срок заявки", R05: "часть 14 дн.", R06: "норма дней", R07: "пересечение", R09: "первый отпуск", R10: "число частей", R14: "перенос", R15: "замещающий", R16: "за свой счёт", R17: "за свой счёт по льготе" };

function Waiting({ rows, changes, reminded, busy, onRemind }: {
  rows: DashboardRow[]; changes: Data["changes"]; reminded: Record<string, string>; busy: boolean; onRemind: (list: Addressee[]) => void;
}) {
  const manager = rows.filter((r) => r.lane === "manager");
  const hr = rows.filter((r) => r.lane === "hr");
  const router = useRouter();
  const [lane, setLane] = useState<"hr" | "manager">(hr.length + changes.hr.length ? "hr" : "manager");
  const list = lane === "hr" ? hr : manager;
  const moves = changes[lane];
  return (
    <Section title="Ждут решения" pad={8}
      description={lane === "hr" ? "Конфликты с правилами и запросы на перенос — решает РО1." : "Планы без конфликтов и запросы на перенос — у руководителя."}
      action={<SegmentedControl size="sm" value={lane} onChange={setLane} options={[
        { value: "hr", label: `У РО1 ${hr.length + changes.hr.length}` },
        { value: "manager", label: `У руководителя ${manager.length + changes.manager.length}` },
      ]} />}>
      {list.length + moves.length === 0 ? (
        <EmptyState icon={Inbox} title="Очередь пуста" description={lane === "hr" ? "Конфликтов, требующих решения, нет." : "Руководители всё согласовали."} />
      ) : (
        <div className="flex flex-col divide-y-[0.5px] divide-line max-h-[420px] overflow-auto">
          {moves.map((c) => (
            <PersonRow key={`c${c.id}`} r={c}
              meta={<>
                <Pill size="sm" tone="info" icon={CalendarClock}>{c.kind === "move" ? "перенос" : c.kindLabel.toLowerCase()}</Pill>
                <DiffLine d={{ label: "", before: range(c.oldStart, c.oldEnd), after: c.newStart && c.newEnd ? range(c.newStart, c.newEnd) : "часть отменена" }} />
                {c.late && <Pill size="sm" tone="accent" title={`Подан за ${c.daysBefore} дн. до начала — позже срока R14`}>нужно исключение: поздний перенос</Pill>}
                {lane === "manager" && <span className="text-[12.5px] text-muted">ждёт: {c.managerName ? shortName(c.managerName) : "—"}</span>}
              </>}
              action={lane === "hr"
                ? <Button size="sm" variant="tinted" onClick={() => router.push("/hr")}>Разобрать</Button>
                : <Button size="sm" icon={Bell} disabled={busy} onClick={() => onRemind([c])}>Поторопить</Button>} />
          ))}
          {list.map((r) => lane === "hr" ? (
            <PersonRow key={r.employee.id} r={r}
              meta={<>
                {r.exceptionRequests > 0 && <Pill size="sm" tone="info">запрос исключения</Pill>}
                {dedupe(r.issues).map((i) => (
                  <Pill key={i.ruleCode} size="sm" tone={i.consequence === "law" ? "bad" : i.consequence === "exception" ? "accent" : "warn"} title={i.title}>
                    {CONSEQUENCE[i.consequence]}: {ISSUE[i.ruleCode] ?? i.title.toLowerCase()}
                  </Pill>
                ))}
              </>}
              action={<Button size="sm" variant="tinted" onClick={() => router.push("/hr")}>Разобрать</Button>} />
          ) : (
            <PersonRow key={r.employee.id} r={r}
              meta={<>
                <span className="text-[12.5px] text-muted">ждёт: {r.managerName ? shortName(r.managerName) : "—"}</span>
                {reminded[r.employee.id] && <span className="text-[12.5px] text-muted-2">напомнили {stamp(reminded[r.employee.id])}</span>}
              </>}
              action={<Button size="sm" icon={Bell} disabled={busy} onClick={() => onRemind([r])}>Поторопить</Button>} />
          ))}
        </div>
      )}
    </Section>
  );
}

const dedupe = (l: DashboardRow["issues"]) => {
  const m = new Map<string, DashboardRow["issues"][number]>();
  for (const i of l) if (!m.has(i.ruleCode) || i.level === "block") m.set(i.ruleCode, i);
  return [...m.values()];
};

/* ---------------- тепловая лента ---------------- */

/** Одна последовательная шкала синего («отпуск»): светлее — меньше, темнее — больше. */
function Heatmap({ load, month, onPick }: { load: MonthLoad[]; month: number; onPick: (m: number) => void }) {
  const max = Math.max(1, ...load.map((m) => m.personDays));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-6 md:grid-cols-12 gap-1.5">
        {load.map((m) => {
          const k = m.personDays / max;
          const dark = k > 0.55;
          return (
            <Tooltip key={m.month} content={m.personDays
              ? `${MON[m.month][0].toUpperCase() + MON[m.month].slice(1)}: ${m.personDays} человеко-дней, в отпуске ${m.people} ${plural(m.people, ["человек", "человека", "человек"])}; пик — ${m.peak} одновременно${m.peakDate ? `, ${day(m.peakDate)}` : ""}`
              : `${MON[m.month][0].toUpperCase() + MON[m.month].slice(1)}: отпусков нет`}>
              <button type="button" onClick={() => onPick(m.month)} aria-pressed={month === m.month}
                className={cx("r-in h-[88px] px-2.5 py-2 flex flex-col justify-between text-left cursor-pointer press transition-shadow",
                  month === m.month && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
                style={{ background: m.personDays ? `rgba(10, 132, 255, ${0.1 + k * 0.78})` : "var(--fill-3)" }}>
                <span className={cx("text-[12.5px] font-medium", dark ? "text-white" : "text-text-2")}>{MON[m.month].slice(0, 3)}</span>
                <span>
                  <span className={cx("block text-[19px] font-semibold tnum leading-none", dark ? "text-white" : "text-text")}>{m.personDays || "—"}</span>
                  {m.peak > 0 && <span className={cx("block text-[11.5px] mt-1", dark ? "text-white/85" : "text-muted")}>пик {m.peak}</span>}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
        <span>человеко-дней</span>
        <span className="inline-flex items-center gap-1.5">меньше
          <span className="w-24 h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(10,132,255,0.1), rgba(10,132,255,0.88))" }} />больше
        </span>
        <span>«пик» — сколько человек отсутствуют одновременно в самый загруженный день</span>
      </div>
    </div>
  );
}

/* ---------------- бухгалтерия ---------------- */

function Payroll({ departures, month, nearest, months, onMonth }: {
  departures: Departure[]; month: string; nearest: string; months: { key: string; count: number }[]; onMonth: (m: string) => void;
}) {
  const list = departures.filter((x) => x.start.slice(0, 7) === month);
  const [y, m] = [month.slice(0, 4), +month.slice(5, 7) - 1];
  return (
    <Section title={`Уходят в ${MON_IN[m]} ${y}`} pad={8}
      description="Для менеджера секции заработной платы: кому начислить отпускные и у кого удержать за дни без сохранения зарплаты (регламент). Отпускные — не позднее чем за 2 календарных дня до начала (ст. 176 ТК), в выходной — в предыдущий рабочий день."
      action={<>
        {month === nearest && <Pill tone="accent" size="sm">ближайший месяц</Pill>}
        <div className="w-[190px]">
          <Select size="sm" value={month} onChange={onMonth}
            options={months.map((x) => {
              const mm = MON[+x.key.slice(5, 7) - 1];
              return { value: x.key, label: `${mm[0].toUpperCase()}${mm.slice(1)} ${x.key.slice(0, 4)}`, description: x.count ? `уходят ${x.count}` : "никто не уходит" };
            })} />
        </div>
        <Button size="sm" icon={Download} disabled={!list.length} onClick={() => downloadCsv(list, `otpusknye-${month}.csv`)}>CSV</Button>
      </>}>
      {list.length === 0 ? (
        <EmptyState icon={Inbox} title="В этом месяце никто не уходит" />
      ) : (
        <div className="flex flex-col divide-y-[0.5px] divide-line">
          {list.map((x) => (
            <div key={`${x.employeeId}-${x.partNo}`} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] items-center gap-4 px-3 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={x.fullName} size={36} />
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold tracking-[-0.01em] truncate">{x.fullName}</div>
                  <div className="text-[13px] text-muted truncate">{x.position}</div>
                </div>
              </div>
              <div>
                <div className="text-[14px] tnum">{range(x.start, x.end)}</div>
                <div className="text-[13px] text-muted">{x.days} {plural(x.days, ["день", "дня", "дней"])}, часть {x.partNo}{x.type !== "main" ? `, ${VACATION_TYPE_LABEL[x.type].toLowerCase()}${x.treatmentKind ? ` (${TREATMENT_KIND_LABEL[x.treatmentKind].toLowerCase()})` : ""}` : ""}</div>
                {x.needsPay && <Pill size="sm" tone="warn" className="mt-1" icon={ShieldAlert} title="Регламент: отпускные по заявлению, не больше оклада. По ТК (ст. 175–176) отпускные — средний заработок, без заявления">нужны отпускные</Pill>}
              </div>
              {UNPAID.has(x.type) ? (
                <div>
                  <div className="text-[13px] text-muted">удержание</div>
                  <div className="text-[14.5px] font-semibold tnum">{x.days} {plural(x.days, ["день", "дня", "дней"])} без сохранения</div>
                </div>
              ) : (
                <div>
                  <div className="text-[13px] text-muted">выплатить до</div>
                  <div className="text-[14.5px] font-semibold tnum">{day(x.payWorkday)}, {wd(x.payWorkday)}</div>
                  {x.payWorkday !== x.payBy && <div className="text-[12.5px] text-muted">{day(x.payBy)} — выходной</div>}
                </div>
              )}
              <Pill tone={x.approved ? "ok" : "warn"} dot>{x.approved ? "согласовано" : "на согласовании"}</Pill>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Отпуск без сохранения зарплаты — бухгалтерии удержание, а не отпускные */
const UNPAID = new Set<Departure["type"]>(["unpaid190", "unpaid189"]);

function downloadCsv(list: Departure[], name: string) {
  const head = ["Сотрудник", "Должность", "Часть", "Вид", "С", "По", "Дней", "Расчёт", "Нужны отпускные", "Выплатить не позднее", "Рабочий день выплаты", "Статус"];
  const rows = list.map((x) => {
    const unpaid = UNPAID.has(x.type);
    return [x.fullName, x.position, x.partNo, VACATION_TYPE_LABEL[x.type], x.start, x.end, x.days, unpaid ? "удержание" : "отпускные",
      x.needsPay ? "да" : "", unpaid ? "" : x.payBy, unpaid ? "" : x.payWorkday, x.approved ? "согласовано" : "на согласовании"];
  });
  const text = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Файл выгружен", { description: `${name}: ${list.length} ${plural(list.length, ["строка", "строки", "строк"])}, открывается в Excel` });
}
