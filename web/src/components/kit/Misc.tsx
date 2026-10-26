import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

/** Заглушка загрузки с мягким переливом. Радиус по умолчанию — от текущей Surface. */
export function Skeleton({ w, h = 14, round, className, style }: { w?: number | string; h?: number | string; round?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span aria-hidden className={cx("kit-skeleton block", round ? "rounded-full" : "r-in", className)}
      style={{ width: w ?? "100%", height: h, ...style }} />
  );
}

/** Пустое состояние: иконка в круге, заголовок, пояснение, действие. */
export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center text-center px-6 py-10", className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-full bg-fill-2 text-muted inline-flex items-center justify-center mb-4">
          <Icon size={26} strokeWidth={1.75} />
        </div>
      )}
      <div className="text-[17px] font-semibold tracking-[-0.02em]">{title}</div>
      {description && <div className="text-[14px] text-muted mt-1 max-w-[42ch]">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const AVATAR_TONES = ["#5E5CE6", "#0A84FF", "#30B0C7", "#34C759", "#FF9F0A", "#FF6482", "#AC8E68", "#64D2FF"];

/** Инициалы из ФИО «Фамилия Имя Отчество» → «ИФ» (имя + фамилия, как подписывают люди). */
export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[1]?.[0] ?? "") + (p[0]?.[0] ?? "")).toUpperCase() || "?";
}

/** Аватар с инициалами. Цвет устойчив для одного и того же имени. */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span aria-hidden className={cx("inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 select-none", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, letterSpacing: "-0.02em",
        background: `linear-gradient(180deg, color-mix(in srgb, ${bg} 82%, white), ${bg})` }}>
      {initials(name)}
    </span>
  );
}

/** Тонкий разделитель внутри карточки. */
export const Divider = ({ className }: { className?: string }) => <div className={cx("h-[0.5px] bg-line", className)} />;

/** Подпись «ключ — значение» для карточек сводки. */
export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" | "info" }) {
  const color = tone ? { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" }[tone] : "text-text";
  return (
    <div>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cx("text-[28px] leading-tight font-semibold tracking-[-0.03em] tnum", color)}>{value}</div>
      {hint && <div className="text-[12px] text-muted-2 mt-0.5">{hint}</div>}
    </div>
  );
}
