import type { Metadata } from "next";
import { KitShowcase } from "./KitShowcase";

export const metadata: Metadata = { title: "Набор интерфейса — Отпуска 2027" };

/** Витрина примитивов `@/components/kit`: все элементы во всех состояниях. Сверяться по ней. */
export default function KitPage() {
  return <KitShowcase />;
}
