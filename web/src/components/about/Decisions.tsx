"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Pill, SegmentedControl, Surface, cx, type Tone } from "@/components/kit";
import { DECISIONS, type Basis } from "./content";

const BASIS_TONE: Record<Basis["kind"], Tone> = { law: "info", reg: "accent", task: "neutral", ours: "neutral" };
type Filter = "all" | "decision" | "assumption";

/** Решения и допущения: карточки-аккордеоны, основание видно сразу, пояснение — по клику. */
export function Decisions() {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(DECISIONS[0].title);
  const list = DECISIONS.filter((d) => filter === "all" || (filter === "assumption") === !!d.assumption);
  const count = (a: boolean) => DECISIONS.filter((d) => !!d.assumption === a).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <SegmentedControl<Filter> aria-label="Показать" value={filter} onChange={setFilter}
          options={[
            { value: "all", label: `Все ${DECISIONS.length}` },
            { value: "decision", label: `Решения ${count(false)}` },
            { value: "assumption", label: `Допущения ${count(true)}` },
          ]} />
        <div className="flex flex-wrap gap-1.5 text-[12.5px]">
          <Pill tone="info" size="sm">ТК РБ и законы</Pill>
          <Pill tone="accent" size="sm">регламент</Pill>
          <Pill tone="neutral" size="sm">задание и интерфейс</Pill>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-3 items-start">
        {list.map((d) => {
          const isOpen = open === d.title;
          return (
            <Surface key={d.title} level="panel" pad={0} className="overflow-hidden">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.title)}
                className="w-full text-left px-5 pt-4 pb-4 flex gap-3 items-start cursor-pointer">
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-[16px] font-semibold tracking-[-0.015em]">{d.title}</span>
                    {d.assumption && <Pill tone="warn" size="sm">допущение</Pill>}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {d.basis.map((b) => <Pill key={b.label} tone={BASIS_TONE[b.kind]} size="sm">{b.label}</Pill>)}
                  </span>
                </span>
                <span className="mt-0.5 w-7 h-7 shrink-0 rounded-full bg-fill-2 grid place-items-center text-muted">
                  <ChevronDown size={16} strokeWidth={2.25}
                    style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform var(--dur-2) var(--ease-spring)" }} />
                </span>
              </button>
              <div className="grid" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", transition: "grid-template-rows var(--dur-3) var(--ease-spring)" }}>
                <div className="overflow-hidden">
                  <p className={cx("px-5 pb-5 -mt-0.5 text-[14.5px] leading-[1.55] text-text-2 transition-opacity", isOpen ? "opacity-100" : "opacity-0")}>
                    {d.text}
                  </p>
                </div>
              </div>
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
