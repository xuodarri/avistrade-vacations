import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Tooltip } from "./Popover";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "accent" | "vacation";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  info: "bg-info-bg text-info",
  neutral: "bg-fill-2 text-muted",
  accent: "bg-accent-bg text-accent-strong",
  vacation: "bg-vacation text-white",
};
const SIZE = { sm: "h-5 px-2 text-[11.5px] gap-1", md: "h-6 px-2.5 text-[12.5px] gap-1.5" };

/** Пилюля статуса: всегда капсула (концентрична любому родителю). */
export function Pill({
  tone = "neutral", dot, icon: Icon, size = "md", children, className, title,
}: {
  tone?: Tone; dot?: boolean; icon?: LucideIcon; size?: "sm" | "md"; children: ReactNode; className?: string;
  /** Подсказка при наведении (kit Tooltip, не нативный title). */
  title?: ReactNode;
}) {
  const pill = (
    <span tabIndex={title ? 0 : undefined} className={cx("inline-flex items-center rounded-full font-medium whitespace-nowrap tracking-[-0.003em] tnum", SIZE[size], TONE[tone], className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {Icon && <Icon size={size === "sm" ? 12 : 13} strokeWidth={2.25} className="shrink-0" />}
      {children}
    </span>
  );
  return title ? <Tooltip content={title}>{pill}</Tooltip> : pill;
}

/** Счётчик-бейдж: число в кружке (уведомления, количество). */
export function Badge({ tone = "accent", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11.5px] font-semibold tnum", TONE[tone], className)}>
      {children}
    </span>
  );
}
