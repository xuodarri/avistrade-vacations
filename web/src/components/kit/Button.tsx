"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { useControlRadius } from "./Surface";
import { Tooltip } from "./Popover";

export type ButtonVariant = "primary" | "secondary" | "tinted" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const H: Record<ButtonSize, number> = { sm: 30, md: 36, lg: 44 };
const SIZE: Record<ButtonSize, string> = {
  sm: "h-[30px] px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[14px] gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};
const ICON: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 19 };
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent-strong text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-press)]",
  secondary: "bg-fill-2 text-text hover:bg-fill",
  tinted: "bg-accent-bg text-accent-strong hover:bg-[var(--accent-bg-hover)]",
  ghost: "bg-transparent text-accent-strong hover:bg-fill-2",
  destructive: "bg-bad-bg text-bad hover:bg-[rgba(255,59,48,0.17)]",
};

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx("shrink-0", className)} style={{ animation: "kit-spin 0.8s linear infinite" }} aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
      <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Иконка справа (например, шеврон). */
  iconRight?: LucideIcon;
  loading?: boolean;
  /** Растянуть на всю ширину. */
  block?: boolean;
  /** Круглая капсула вместо концентричного радиуса. */
  pill?: boolean;
}

/** Кнопка. Радиус концентричен текущей Surface (см. Surface.tsx), pill — капсула. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, iconRight: IconR, loading, block, pill, disabled, className, style, children, type = "button", ...rest },
  ref,
) {
  const r = useControlRadius(H[size]);
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "press inline-flex items-center justify-center font-medium whitespace-nowrap select-none tracking-[-0.01em] cursor-pointer",
        "disabled:opacity-45 disabled:cursor-default",
        SIZE[size], VARIANT[variant], block && "w-full", className,
      )}
      style={{ borderRadius: pill ? H[size] / 2 : r, ...style }}
      {...rest}
    >
      {loading ? <Spinner size={ICON[size]} /> : Icon && <Icon size={ICON[size]} strokeWidth={2} className="shrink-0 -ml-0.5" />}
      {children}
      {IconR && !loading && <IconR size={ICON[size]} strokeWidth={2} className="shrink-0 -mr-1 opacity-70" />}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Подпись: aria-label и подсказка kit (Tooltip) при наведении. */
  label: string;
  /** Не показывать подсказку (например, если рядом уже есть текст). */
  noTooltip?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Круглая (по умолчанию) или концентричная квадратная. */
  round?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = "ghost", size = "md", loading, round = true, noTooltip, className, style, type = "button", disabled, ...rest },
  ref,
) {
  const h = H[size];
  const r = useControlRadius(h);
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      disabled={disabled || loading}
      className={cx(
        "press inline-flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-default",
        VARIANT[variant], variant === "ghost" && "text-text-2 hover:text-text", className,
      )}
      style={{ width: h, height: h, borderRadius: round ? h / 2 : r, ...style }}
      {...rest}
    >
      {loading ? <Spinner size={ICON[size]} /> : <Icon size={ICON[size]} strokeWidth={2} />}
    </button>
  );
  return noTooltip ? btn : <Tooltip content={label}>{btn}</Tooltip>;
});

/** Группа кнопок с общим отступом. */
export const ButtonRow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx("flex flex-wrap items-center gap-2", className)}>{children}</div>
);
