/**
 * Цвета Ганта на токенах kit: мягкие капсулы — тонированный фон и насыщенный текст, как у Pill.
 * Согласовано — зелёный ok, на проверке — синий info, предупреждение — warn, запрет — bad.
 * Мятный акцент здесь только для выбора (выделенная полоса), статусом он не бывает.
 */
import type { CSSProperties } from "react";
import type { BarTone, LoadLevel, RouteStage } from "./types";
import type { Tone } from "@/components/kit";

export const TONE_LABEL: Record<BarTone, string> = {
  approved: "Согласовано",
  pending: "На проверке",
  warn: "Предупреждение",
  block: "Запрет",
  exception: "Разрешено исключением",
  draft: "Черновик",
  returned: "Возвращено",
};

/** Пилюля kit для того же статуса. */
export const TONE_PILL: Record<BarTone, Tone> = {
  approved: "ok", pending: "info", warn: "warn", block: "bad", exception: "ok", draft: "neutral", returned: "neutral",
};

/** Статус полосы — единственное, что передаёт её цвет. Конфликт рисуется поверх знаком и штриховкой. */
export type BarStatus = "approved" | "pending" | "draft" | "returned";
export const statusOf = (p: { status: string }): BarStatus =>
  p.status === "approved" ? "approved" : p.status === "pending" ? "pending" : p.status === "draft" ? "draft" : "returned";
export const STATUS_LABEL: Record<BarStatus, string> = {
  approved: "Согласовано", pending: "На согласовании", draft: "Черновик", returned: "Возвращено сотруднику",
};
export const STATUS_STYLE: Record<BarStatus, CSSProperties> = {
  approved: { background: "rgba(52,199,89,.30)", color: "#155E30" },
  pending: { background: "#DCE6F3", color: "#2A4466" },
  draft: { background: "transparent", color: "var(--muted)", outline: "1.5px dashed rgba(0,0,0,.28)", outlineOffset: -1.5 },
  returned: { background: "var(--fill)", color: "var(--muted-2)" },
};

/** Тот же язык для мини-лент, где есть только тон: цвет — статус, у конфликта — обводка. */
export const TONE_STYLE: Record<BarTone, CSSProperties> = {
  approved: STATUS_STYLE.approved,
  pending: STATUS_STYLE.pending,
  warn: { ...STATUS_STYLE.pending, boxShadow: "inset 0 0 0 1.5px var(--warn)" },
  block: { ...STATUS_STYLE.pending, boxShadow: "inset 0 0 0 1.5px var(--bad)" },
  exception: STATUS_STYLE.approved,
  draft: STATUS_STYLE.draft,
  returned: STATUS_STYLE.returned,
};

/** Тепловая лента загрузки группы. */
export const LOAD_STYLE: Record<LoadLevel, { bg: string; label: string }> = {
  0: { bg: "transparent", label: "" },
  1: { bg: "#B8E6C6", label: "есть места" },
  2: { bg: "#FFD66B", label: "на лимите" },
  3: { bg: "#FFAE52", label: "нет на месте связанной роли" },
  4: { bg: "#FF6B5E", label: "лимит превышен" },
  5: { bg: "#9CC7FF", label: "разрешено исключением" },
};

export const STAGE_LABEL: Record<RouteStage, string> = {
  draft: "Черновик",
  manager: "У руководителя",
  hr: "Ждёт решения РО1",
  approved: "Согласовано",
  returned: "Возвращено сотруднику",
  rejected: "Отклонено",
};
