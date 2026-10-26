"use client";

/** «Тур пройден» — в localStorage на пару «экран + роль». Хук читает значение только в браузере. */
import { useSyncExternalStore } from "react";

const PREFIX = "tour:v1";
const EVT = "tour-storage";

export const doneKey = (tourId: string, role: string) => `${PREFIX}:${tourId}:${role}`;

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVT, cb); };
}

/** Значение ключа; `undefined` — на сервере и при гидрации (ещё неизвестно), `null` — ключа нет. */
export function useStored(key: string | null): string | null | undefined {
  return useSyncExternalStore(subscribe, () => (key ? read(key) : null), () => undefined);
}
