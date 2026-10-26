/**
 * Плашка «Запрос исключения» в карточке руководителя и в разборе заявки у РО1: какие правила
 * регламента нарушены (тексты движка с именами), обоснование сотрудника и кто разрешает
 * исключение окончательно. У РО1 внутри — само действие «Разрешить исключением».
 */
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Surface } from "@/components/kit";
import type { BoardFinding } from "./types";

type Rule = Pick<BoardFinding, "title" | "message" | "people" | "ruleCode">;

/** «РО1 — Кузьмич М. Л.» или, по отпуску самого РО1, «проверяющий за РО1 — …» */
export function deciderLabel(name: string, asReviewer?: boolean) {
  return `${asReviewer ? "проверяющий за РО1" : "РО1"} — ${name}`;
}

/** Точка в конце фразы, если имя уже не кончается на инициал с точкой. */
export const sentence = (s: string) => (s.endsWith(".") ? s : `${s}.`);

export function ExceptionCallout({ title = "Запрос исключения", rules, note, footer, action }: {
  title?: string;
  rules: Rule[];
  /** Обоснование сотрудника; undefined — не показывать строку (не запрос, а конфликт без запроса) */
  note?: string | null;
  footer: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Surface nested tone="flat" className="bg-warn-bg!">
      <div className="flex gap-3">
        <ShieldAlert size={20} className="text-warn shrink-0 mt-px" />
        <div className="min-w-0 flex-1 flex flex-col gap-2.5">
          <div className="text-[15px] font-semibold tracking-[-0.015em] text-warn">{title}</div>
          {rules.length > 0 && (
            <ul className="flex flex-col gap-1.5 list-disc pl-4 marker:text-warn">
              {rules.map((r, i) => (
                <li key={`${r.ruleCode}-${i}`} className="text-[13.5px] leading-snug">
                  <span className="font-medium">{r.title}.</span>{" "}
                  <span className="text-text-2">{r.message.replace(/^Часть \d+:\s*/, "").replace(/\. Разрешено исключением HR:.*$/, "")}</span>
                  {r.people.length > 0 && <span className="text-muted"> ({r.people.join(", ")})</span>}
                </li>
              ))}
            </ul>
          )}
          {note !== undefined && (
            note
              ? <blockquote className="text-[14px] leading-snug border-l-[3px] border-warn/50 pl-3">«{note}»<div className="text-[12px] text-muted mt-0.5">обоснование сотрудника</div></blockquote>
              : <div className="text-[13px] text-muted">Сотрудник не написал обоснование.</div>
          )}
          <div className="text-[13px] text-text-2">{footer}</div>
          {action && <div className="flex">{action}</div>}
        </div>
      </div>
    </Surface>
  );
}
