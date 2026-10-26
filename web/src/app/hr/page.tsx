import { getGanttBoard } from "@/server/actions/hr";
import { currentUser, can } from "@/server/session";
import { Forbidden } from "@/components/ui";
import { HrGantt } from "./_components/HrGantt";

/** График отпусков HR: Гант во всю ширину окна, панель с фильтрами и заявками на изменение, сводка под Гантом. */
export default async function HrGanttPage() {
  const u = await currentUser();
  if (!can(u, "hr")) return <Forbidden />;
  const data = await getGanttBoard();
  return <HrGantt data={data} today={new Date().toISOString().slice(0, 10)} />;
}
