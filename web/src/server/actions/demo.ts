"use server";

/** Демо-сборка: сброс базы к чистому сиду перед записью видео. В рабочей версии недоступно. */
import { revalidatePath } from "next/cache";
import { resetDatabase } from "../db/client";
import { DEMO } from "@/lib/demo";

export async function resetDemoData() {
  if (!DEMO) throw new Error("Сброс данных доступен только в демо-сборке");
  resetDatabase();
  revalidatePath("/", "layout");
  return { ok: true as const, at: new Date().toISOString() };
}
