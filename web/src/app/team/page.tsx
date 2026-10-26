import { getManagerQueue } from "@/server/actions/team";
import { getApproverBoard } from "@/server/actions/hr";
import { getSchedule } from "@/server/actions/route";
import { currentUser, can } from "@/server/session";
import { Forbidden } from "@/components/ui";
import { PageHeader } from "@/components/kit";
import { Inbox } from "./_components/Inbox";
import { ScheduleApprovalCard, type ScheduleSummary } from "./_components/ScheduleApproval";

/** Очередь руководителя: «входящие» заявки прямых подчинённых, а у утверждающего — ещё и утверждение графика. */
export default async function TeamPage() {
  const u = await currentUser();
  // график читаем мягко: пока миграция таблицы графиков не применена, страница работает без него
  const sch = await getSchedule().catch(() => null);
  // на утверждение уходит полугодие: берём первое, которое ждёт решения
  const schedule = sch?.halves?.find((h) => h.status === "pending") ?? null, route = sch?.route ?? null;
  const approver = !!route && u.id === route.scheduleApproverId;
  if (!can(u, "manager") && !approver) return <Forbidden />;

  let card: ScheduleSummary | null = null;
  if (approver && schedule?.status === "pending") {
    const b = await getApproverBoard();
    // части этого полугодия: I — январь–июнь, II — июль–декабрь (по дате начала)
    const inHalf = (iso: string) => (schedule.half === 1 ? iso <= `${b.year}-06-30` : iso >= `${b.year}-07-01`) && iso.startsWith(String(b.year));
    const live = b.parts.filter((p) => (p.status === "approved" || p.status === "pending") && inHalf(p.start));
    card = {
      year: b.year, half: schedule.half, halfLabel: schedule.half === 1 ? "I полугодие" : "II полугодие",
      people: new Set(live.map((p) => p.employeeId)).size, parts: live.length, days: live.reduce((s, p) => s + p.days, 0),
      resolved: b.summary.resolved, open: b.summary.open, notices: b.notices,
      submittedBy: schedule.submittedBy ? (b.employees[schedule.submittedBy]?.name ?? schedule.submittedBy) : null, submittedAt: schedule.submittedAt ?? null,
    };
  }
  const q = can(u, "manager") ? await getManagerQueue() : null;
  const n = q?.people.length ?? 0, a = n % 10, b = n % 100;
  const word = a >= 2 && a <= 4 && (b < 12 || b > 14) ? "человека" : "человек";

  return (
    <>
      <PageHeader title="Согласование" subtitle={q ? `Команда: ${n} ${word}. Маршрут: сотрудник, затем вы, окончательно решает РО1 ${q.hrName}` : "Утверждение графика отпусков"} />
      {card && <ScheduleApprovalCard s={card} />}
      {q && <Inbox people={q.people} lane={q.lane} holidays={q.holidays} managerId={q.manager.id} review={q.review} hrName={q.hrName} />}
    </>
  );
}
