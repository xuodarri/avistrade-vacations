"use client";

/** Строки «Замещает» и «Вид» для разбора заявки HR и карточки руководителя. */
import { UserRound } from "lucide-react";
import { Avatar, Pill, Surface } from "@/components/kit";
import { fmtRange } from "@/lib/dates";
import type { LeaveKind, SubstituteInfo } from "./types";

export function SubstituteLine({ s }: { s: SubstituteInfo | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13.5px] min-w-0">
      <span className="text-muted shrink-0">Замещает</span>
      {s ? (
        <>
          <Avatar name={s.fullName} size={22} />
          <span><span className="font-medium">{s.fullName.split(" ").slice(0, 2).join(" ")}</span>, {s.position.toLowerCase()}</span>
          {s.away.length > 0 && <Pill tone="bad" size="sm" dot className="shrink-0">в отпуске {s.away.map((a) => fmtRange(a.start, a.end)).join(", ")}</Pill>}
        </>
      ) : (
        <Pill tone="warn" size="sm" icon={UserRound}>не указан</Pill>
      )}
    </div>
  );
}

/** Вид отпуска за свой счёт и причина сотрудника. У основного отпуска строки нет. */
export function LeaveKindLine({ kind }: { kind: LeaveKind }) {
  if (kind.main) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13.5px]">
      <span className="text-muted shrink-0">Вид</span>
      <span><span className="font-medium">{kind.label}</span>{kind.reason ? ` — ${kind.reason[0].toLowerCase()}${kind.reason.slice(1)}` : ""}</span>
      <span className="text-[12px] text-muted-2">{kind.basis}</span>
      {!kind.reason && <Pill tone="warn" size="sm">причина не указана</Pill>}
    </div>
  );
}

/** Обоснование сотрудника к запросу исключения — цитатой над вердиктами. */
export function ExceptionNote({ note }: { note: string | null }) {
  return (
    <Surface nested tone="flat" className="bg-info-bg!">
      <div className="flex gap-3">
        <span aria-hidden className="w-[3px] self-stretch rounded-full bg-info shrink-0" />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-info mb-0.5">Запрос исключения: почему нужны именно эти даты</div>
          {note
            ? <blockquote className="text-[14px] leading-snug text-text">«{note}»</blockquote>
            : <div className="text-[13px] text-muted">Сотрудник не написал обоснование.</div>}
        </div>
      </div>
    </Surface>
  );
}
