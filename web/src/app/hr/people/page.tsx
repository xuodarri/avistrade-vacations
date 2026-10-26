import { getPeople } from "@/server/actions/people";
import { currentUser, can } from "@/server/session";
import { Forbidden } from "@/components/ui";
import { PeopleView } from "@/components/hr-admin/PeopleView";

/** Сотрудники: список, карточка с последствиями правок, приём и увольнение. Только HR. */
export default async function PeoplePage() {
  const u = await currentUser();
  if (!can(u, "hr")) return <Forbidden />;
  return <PeopleView {...await getPeople()} />;
}
