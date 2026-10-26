import { getApproverBoard } from "@/server/actions/hr";
import { getSchedule } from "@/server/actions/route";
import { currentUser, can } from "@/server/session";
import { Forbidden } from "@/components/ui";
import { HrGantt } from "@/app/hr/_components/HrGantt";
import { ApprovalActions } from "../_components/ScheduleApproval";

/** График для утверждающего: тот же Гант, только чтение, кнопки «Утвердить» и «Вернуть HR». */
export default async function ScheduleForApproverPage() {
  const u = await currentUser();
  // график читаем мягко: пока миграция таблицы графиков не применена, страница работает без него
  const sch = await getSchedule().catch(() => null);
  const schedule = sch?.halves?.find((h) => h.status === "pending") ?? null, route = sch?.route ?? null;
  if (u.id !== route?.scheduleApproverId && !can(u, "hr")) return <Forbidden />;
  const data = await getApproverBoard();
  return (
    <HrGantt data={data} today={new Date().toISOString().slice(0, 10)} readOnly title={`График отпусков ${data.year}`}
      actions={u.id === route?.scheduleApproverId && schedule ? <ApprovalActions year={data.year} half={schedule.half} /> : undefined} />
  );
}
