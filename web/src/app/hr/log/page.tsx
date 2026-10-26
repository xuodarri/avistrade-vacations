import { currentUser, can } from "@/server/session";
import { Forbidden } from "@/components/ui";
import { JournalView } from "@/components/hr-admin/JournalView";
import { getJournal } from "./data";

/** Журнал: кто, когда и что сделал — планы, решения, исключения HR, правила, напоминания. */
export default async function LogPage({ searchParams }: PageProps<"/hr/log">) {
  const u = await currentUser();
  if (!can(u, "hr")) return <Forbidden />;
  const { type } = await searchParams;
  const { rows, exceptions, people } = getJournal();
  return <JournalView rows={rows} exceptions={exceptions} people={people} initialKind={typeof type === "string" ? type : undefined} />;
}
