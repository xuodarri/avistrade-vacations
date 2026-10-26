"use client";

import { useState } from "react";
import { Pill, SegmentedControl, Surface } from "@/components/kit";
import { QUESTIONS } from "./content";

/** Вопросы к компании по группам; нумерация сквозная, чтобы на презентации ссылаться «вопрос 7». */
export function Questions() {
  const [group, setGroup] = useState(QUESTIONS[0].id);
  const offset = (id: string) => {
    let n = 0;
    for (const g of QUESTIONS) { if (g.id === id) return n; n += g.items.length; }
    return n;
  };
  const current = QUESTIONS.find((g) => g.id === group)!;
  const start = offset(group);

  return (
    <div>
      <div className="overflow-x-auto [scrollbar-width:none] -mx-1 px-1 pb-1">
        <SegmentedControl aria-label="Группа вопросов" value={group} onChange={setGroup}
          options={QUESTIONS.map((g) => ({ value: g.id, label: `${g.label} ${g.items.length}` }))} />
      </div>
      <Surface level="inset" className="mt-4">
        <ol className="flex flex-col gap-1.5">
          {current.items.map((it, i) => (
            <Surface as="li" key={it.q} nested pad={16} className="flex gap-4 items-start">
              <span className="w-7 h-7 shrink-0 rounded-full bg-surface shadow-1 grid place-items-center text-[12.5px] font-semibold tnum text-muted">
                {start + i + 1}
              </span>
              <span className="flex-1 min-w-0 pt-[3px]">
                <span className="block text-[15px] leading-[1.5]">{it.q}</span>
                {it.a && <Pill tone="info" size="sm" className="mt-2">{it.a}</Pill>}
              </span>
            </Surface>
          ))}
        </ol>
      </Surface>
    </div>
  );
}
