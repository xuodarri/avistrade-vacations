"use client";

/** «Было → стало» пилюлями: правила, журнал. Пустое «было» (новое значение) не показывается. */
import { ShieldAlert } from "lucide-react";
import { Pill } from "@/components/kit";
import type { FieldChange } from "./meta";

const EMPTY = new Set(["", "—", "нет"]);

export function DiffLine({ d }: { d: FieldChange }) {
  const hasBefore = !EMPTY.has(d.before);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <span className="text-muted mr-0.5">{d.label}</span>
      {hasBefore && <Pill tone="neutral" size="sm" className="line-through decoration-muted-2">{d.before}</Pill>}
      {hasBefore && <span className="text-muted-2">→</span>}
      <Pill tone={d.risky ? "bad" : d.after === "удалена" || d.after === "—" ? "neutral" : "accent"} size="sm" icon={d.risky ? ShieldAlert : undefined}>{d.after}</Pill>
    </div>
  );
}
