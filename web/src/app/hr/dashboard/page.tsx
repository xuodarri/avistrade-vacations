import { getDashboard } from "@/server/actions/dashboard";
import { currentUser, can } from "@/server/session";
import { Forbidden } from "@/components/ui";
import { DashboardView } from "@/components/hr-admin/DashboardView";

/** Сбор графика: кто подал, где застряло, конфликты, загрузка по месяцам, отпуска для бухгалтерии. */
export default async function DashboardPage() {
  const u = await currentUser();
  if (!can(u, "hr")) return <Forbidden />;
  return <DashboardView {...await getDashboard()} />;
}
