import { getMyPlan } from "@/server/actions/plan";
import { MyVacation } from "@/components/me/MyVacation";

/** «Мой отпуск»: календарь с загрузкой группы без имён, части плана и живая проверка по правилам. */
export default async function MePage() {
  const plan = await getMyPlan();
  return <MyVacation initial={plan} />;
}
