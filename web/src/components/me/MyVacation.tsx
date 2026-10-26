"use client";

/**
 * «Мой отпуск»: слева карточка календаря со списком отпусков под ним, справа липкая панель плана.
 * Проверка показывается там, где принимается решение: в панели выбранных дат под календарём, на пилюле части
 * и в чек-листе плана. Когда график утверждён — баннер над календарём (ч. 2 ст. 168 ТК: доводится до всех).
 */
import { useSyncExternalStore } from "react";
import { CalendarCheck, Clock, X } from "lucide-react";
import { IconButton, PageHeader, Pill, Surface } from "@/components/kit";
import { fmtDate } from "@/lib/dates";
import { rangeText } from "./cal";
import { PlanPanel, REQUEST_LOOK } from "./PlanPanel";
import { PlanProvider, usePlan } from "./state";
import { YearCalendar } from "./YearCalendar";
import type { MyPlan } from "./types";

export function MyVacation({ initial }: { initial: MyPlan }) {
  return (
    <PlanProvider initial={initial}>
      <Header />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="min-w-0 flex flex-col gap-4">
          <ScheduleBanner />
          <YearCalendar />
        </div>
        <PlanPanel />
      </div>
    </PlanProvider>
  );
}

function Header() {
  const p = usePlan();
  const e = p.plan.employee;
  const status = p.request?.status ?? "none";
  const look = REQUEST_LOOK[status === "draft" && !p.parts.length ? "none" : status];
  // ближайшее полугодие, график которого ещё не утверждён (регламент: на I — до 15 января, на II — до 15 июля)
  const next = p.plan.schedule.find((h) => h.status !== "approved");
  return (
    <PageHeader
      title={`Мой отпуск ${p.year}`}
      subtitle={`${e.fullName}, ${e.position.charAt(0).toLowerCase()}${e.position.slice(1)}${e.department ? `, ${e.department}` : ""}`}
      actions={
        <>
          <Pill tone={look.tone} dot size="md">{look.label}</Pill>
          {!p.locked && status !== "approved" && <Pill tone="neutral" icon={Clock}>Подать до 15 декабря {p.year - 1}</Pill>}
          {next && <Pill tone="neutral" icon={CalendarCheck}>График на {HALF[next.half]} утвердят до {fmtDate(next.deadline)} {next.deadline.slice(0, 4)}</Pill>}
          {e.benefit && <Pill tone="info" title="Лимиты группы не действуют (ч. 4 ст. 168 ТК)">Льгота: {e.benefit}</Pill>}
        </>
      }
    />
  );
}

const HALF = { 1: "I полугодие", 2: "II полугодие" } as const;

/* Закрытый баннер помним в браузере. На сервере не рисуем: кто его закрыл, не увидит мелькания, остальным он плавно появится */
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
const readHidden = (key: string) => {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
};

/** «График отпусков на I полугодие 2027 утверждён 3 января. Ваши отпуска: …» — последнее утверждённое полугодие, закрывается крестиком */
function ScheduleBanner() {
  const p = usePlan();
  const s = [...p.plan.schedule].reverse().find((h) => h.status === "approved");
  const key = `me.schedule-banner.${p.year}.${s?.half ?? 0}.${s?.decidedAt ?? ""}`;
  const hidden = useSyncExternalStore(subscribe, () => readHidden(key), () => true);
  if (!s || hidden) return null;
  const inHalf = (d: string) => (s.half === 1 ? d.slice(5) <= "06-30" : d.slice(5) >= "07-01");
  const mine = p.parts.filter((x) => x.status === "approved" && inHalf(x.start)).map((x) => rangeText(x.start, x.end));
  const close = () => {
    try { localStorage.setItem(key, "1"); } catch { /* приватный режим — просто скроем до перезагрузки */ }
    window.dispatchEvent(new StorageEvent("storage", { key }));
  };
  return (
    <Surface level="block" tone="tinted" className="flex items-start gap-3 kit-fade" role="status">
      <CalendarCheck size={20} className="shrink-0 mt-0.5 text-ok" />
      <div className="min-w-0 flex-1 text-[13.5px] leading-snug text-text-2">
        <b className="font-semibold text-text">
          График отпусков на {HALF[s.half]} {p.year} года утверждён{s.decidedAt ? ` ${fmtDate(s.decidedAt.slice(0, 10))}` : ""}.
        </b>{" "}
        {mine.length ? <>Ваши отпуска: {mine.join(", ")}. </> : null}
        О начале каждого отпуска напомним за 15 дней (ст. 169 ТК). Изменить даты можно через «Запросить перенос».
      </div>
      <IconButton icon={X} label="Скрыть" size="sm" onClick={close} />
    </Surface>
  );
}
