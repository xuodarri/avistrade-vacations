import type { Metadata } from "next";
import { AboutLanding } from "@/components/about/AboutLanding";

export const metadata: Metadata = {
  title: "О решении — Отпуска 2027",
  description: "Как устроен прототип: маршрут согласования, проверка по регламенту и ТК РБ, технологии, решения, вопросы и развитие",
};

/** «О решении»: мини-лендинг для проверяющих, виден всем ролям. Тексты — src/components/about/content.ts. */
export default function AboutPage() {
  return <AboutLanding />;
}
