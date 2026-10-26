"use client";

/**
 * Мини-Гант «кто ещё в это время»: короткий отрезок шкалы по дням, слева люди, справа капсулы.
 * Растягивается на ширину родителя (позиции в процентах). Отрезок заявки подсвечен.
 */
import { Avatar, Tooltip, cx } from "@/components/kit";
import { fmtRange } from "@/lib/dates";
import type { BarTone, Range } from "./types";
import { dayNo, isoAt, weekday } from "./time";
import { TONE_LABEL, TONE_STYLE } from "./tones";

export interface MiniLaneRow {
  key: string;
  name: string;
  fullName: string;
  note?: string;
  /** Заявка, которую разбираем: её полоса выделена */
  candidate?: boolean;
  /** Отсутствует в эти даты */
  near?: boolean;
  /** Подпись роли рядом с именем, например «замещает» */
  tag?: string;
  /** Дни, когда его отсутствие мешает заявке: обводятся красным */
  clash?: Range[];
  /** old — прежние даты переноса (бледно), new — новые (пунктиром) */
  parts: (Range & { tone: BarTone; style?: "old" | "new" })[];
}

export function MiniLane({ from, to, rows, focus, holidays = [], nameWidth = 150 }: {
  from: string; to: string; rows: MiniLaneRow[]; focus: Range; holidays?: string[]; nameWidth?: number;
}) {
  const days = dayNo(to, from) + 1;
  const pct = (iso: string) => (Math.min(Math.max(dayNo(iso, from), 0), days) / days) * 100;
  const span = (r: Range) => ({ left: `${pct(r.start)}%`, width: `${pct(isoAt(r.end, 1)) - pct(r.start)}%` });
  return (
    <div className="text-[12px]">
      <div className="flex">
        <div className="shrink-0" style={{ width: nameWidth }} />
        <div className="relative flex-1 h-[22px]">
          {Array.from({ length: days }, (_, i) => {
            const iso = isoAt(from, i), wd = weekday(iso), edge = iso === focus.start || iso === focus.end;
            // понедельники подписываем, если не налезают на края заявки
            const nearEdge = Math.abs(dayNo(iso, focus.start)) <= 2 || Math.abs(dayNo(iso, focus.end)) <= 2;
            const show = edge || ((wd === 1 || i === 0) && !nearEdge);
            return show ? (
              <span key={iso} className={cx("absolute top-0 -translate-x-1/2 leading-[22px] text-[10.5px] tnum",
                edge ? "text-text font-semibold" : holidays.includes(iso) ? "text-weekend underline" : "text-muted-2")}
                style={{ left: `${((i + 0.5) / days) * 100}%` }}>
                {+iso.slice(8, 10)}
              </span>
            ) : null;
          })}
        </div>
      </div>
      <div className="relative">
        <div className="absolute inset-y-0 right-0 pointer-events-none" style={{ left: nameWidth }}>
          <div aria-hidden className="absolute inset-y-0 bg-accent-bg/50 r-in" style={span(focus)} />
          {holidays.filter((h) => h >= from && h <= to).map((h) => <div key={h} className="absolute inset-y-0 bg-holiday/70" style={span({ start: h, end: h })} />)}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="relative flex items-center h-[30px]">
            <div className="shrink-0 flex items-center gap-2 pr-3 min-w-0" style={{ width: nameWidth }}>
              <Avatar name={r.fullName} size={20} />
              <span className={cx("truncate", r.candidate ? "font-semibold text-text" : r.near ? "text-text-2" : "text-muted-2")}>{r.name}</span>
              {r.tag && <span className={cx("text-[11px] shrink-0", r.clash?.length ? "text-bad font-medium" : "text-muted-2")}>{r.tag}</span>}
            </div>
            <div className="relative flex-1 h-full">
              {r.parts.map((p) => {
                if (p.end < from || p.start > to) return null;
                const s = span({ start: p.start < from ? from : p.start, end: p.end > to ? to : p.end });
                return (
                  <Tooltip key={`${p.start}-${p.style ?? ""}`} content={`${fmtRange(p.start, p.end)}: ${p.style === "old" ? "было" : p.style === "new" ? "станет" : TONE_LABEL[p.tone].toLowerCase()}`}>
                    <span className="absolute top-[7px] h-[16px] rounded-full cursor-default"
                      style={{ ...s, ...TONE_STYLE[p.tone],
                        ...(p.style === "old" ? { opacity: 0.35 } : {}),
                        ...(p.style === "new" ? { background: "rgba(0,122,255,.08)", boxShadow: "inset 0 0 0 1.5px var(--info)", outline: "1.5px dashed var(--info)", outlineOffset: -1.5 } : {}),
                        ...(r.candidate && p.style !== "old" && p.style !== "new" ? { boxShadow: "0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent)" } : {}) }} />
                  </Tooltip>
                );
              })}
              {r.clash?.map((c) => (
                <Tooltip key={`c-${c.start}`} content={`Замещающий в отпуске ${fmtRange(c.start, c.end)}`}>
                  <span className="absolute top-[4px] h-[22px] rounded-full cursor-default"
                    style={{ ...span(c), background: "rgba(255,59,48,.22)", boxShadow: "inset 0 0 0 1.5px var(--bad)" }} />
                </Tooltip>
              ))}
              {!r.parts.some((p) => p.end >= from && p.start <= to) && r.note && (
                <span className="absolute left-1 top-[7px] text-[11px] text-muted-2">{r.note}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
