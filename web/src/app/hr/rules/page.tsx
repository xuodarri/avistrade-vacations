import { getRulesScreen } from "@/server/actions/rules";
import { currentUser, can } from "@/server/session";
import { employees } from "@/server/db/repo";
import type { RoleCode } from "@/server/db/types";
import { Forbidden } from "@/components/ui";
import { RulesEditor } from "@/components/hr-admin/RulesEditor";

/** Правила проверки: HR меняет лимиты, связи ролей, строгость и параметры сам. */
export default async function RulesPage() {
  const u = await currentUser();
  if (!can(u, "hr")) return <Forbidden />;
  const data = await getRulesScreen();
  const headcount: Record<string, number> = {};
  const roleOf: Record<string, RoleCode> = {};
  for (const e of employees.listActive()) {
    headcount[e.roleCode] = (headcount[e.roleCode] ?? 0) + 1;
    roleOf[e.id] = e.roleCode;
  }
  return <RulesEditor {...data} headcount={headcount} roleOf={roleOf} />;
}
