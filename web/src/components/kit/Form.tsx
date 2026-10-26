"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Check, Minus, Plus, type LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { useControlRadius } from "./Surface";

const FIELD = cx(
  "w-full bg-fill-2 text-text placeholder:text-muted-2 outline-none border-0",
  "transition-[box-shadow,background-color] duration-[var(--dur-1)] hover:bg-fill",
  "focus:bg-surface focus:shadow-[0_0_0_1px_var(--accent),var(--ring)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);
const INVALID = "!shadow-[0_0_0_1px_var(--bad),0_0_0_4px_rgba(255,59,48,0.16)]";

/** Подпись, поле и подсказка/ошибка под ним. */
export function Field({ label, hint, error, children, className, htmlFor }: {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-2 px-0.5">{label}</label>}
      {children}
      {(error || hint) && <div className={cx("text-[12px] px-0.5", error ? "text-bad" : "text-muted")}>{error || hint}</div>}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  icon?: LucideIcon;
  invalid?: boolean;
  size?: "sm" | "md" | "lg";
  /** Элемент справа внутри поля: единицы, кнопка очистки. */
  trailing?: ReactNode;
}
const IH = { sm: 30, md: 36, lg: 44 };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon: Icon, invalid, size = "md", trailing, className, style, ...rest }, ref,
) {
  const r = useControlRadius(IH[size]);
  return (
    <div className={cx("relative flex items-center", className)}>
      {Icon && <Icon size={16} strokeWidth={2} className="absolute left-3 text-muted-2 pointer-events-none" />}
      <input
        ref={ref}
        className={cx(FIELD, size === "lg" ? "text-[15px]" : "text-[14px]", Icon ? "pl-9" : "pl-3", trailing ? "pr-10" : "pr-3", invalid && INVALID)}
        style={{ height: IH[size], borderRadius: r, ...style }}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {trailing && <div className="absolute right-2 flex items-center text-muted text-[13px]">{trailing}</div>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { invalid, className, style, rows = 3, ...rest }, ref,
) {
  const r = useControlRadius(40);
  return (
    <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined}
      className={cx(FIELD, "px-3 py-2.5 text-[14px] leading-snug resize-y min-h-[72px]", invalid && INVALID, className)}
      style={{ borderRadius: r, ...style }} {...rest} />
  );
});

/** Число с кнопками − / +. Шаг, границы, суффикс («дней»). */
export function NumberStepper({
  value, onChange, min = -Infinity, max = Infinity, step = 1, suffix, disabled, className, "aria-label": ariaLabel,
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: ReactNode;
  disabled?: boolean; className?: string; "aria-label"?: string;
}) {
  const r = useControlRadius(36);
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const btn = "w-9 h-full inline-flex items-center justify-center text-text-2 hover:bg-fill disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default press";
  return (
    <div className={cx("inline-flex self-start items-center h-9 bg-fill-2 overflow-hidden", disabled && "opacity-50", className)} style={{ borderRadius: r }}>
      <button type="button" className={btn} aria-label="Меньше" disabled={disabled || value <= min} onClick={() => set(value - step)}><Minus size={15} strokeWidth={2.25} /></button>
      <label className="flex items-baseline gap-1 px-1">
        <input
          type="text" inputMode="numeric" aria-label={ariaLabel} disabled={disabled}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => { const n = Number(e.target.value.replace(/[^\d-]/g, "")); if (!Number.isNaN(n)) set(n); }}
          onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); set(value + step); } if (e.key === "ArrowDown") { e.preventDefault(); set(value - step); } }}
          className="w-[3ch] text-center bg-transparent outline-none text-[14px] font-medium tnum focus:shadow-none"
          style={{ width: `${Math.max(String(value).length, 2) + 0.5}ch` }}
        />
        {suffix && <span className="text-[13px] text-muted">{suffix}</span>}
      </label>
      <button type="button" className={btn} aria-label="Больше" disabled={disabled || value >= max} onClick={() => set(value + step)}><Plus size={15} strokeWidth={2.25} /></button>
    </div>
  );
}

/** Переключатель iOS: зелёный трек, белый кружок с пружинкой. */
export function Switch({ checked, onChange, disabled, label, description, className }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode; description?: ReactNode; className?: string;
}) {
  const id = useId();
  const sw = (
    <button
      id={id} type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative shrink-0 w-[42px] h-[26px] rounded-full cursor-pointer disabled:opacity-45 disabled:cursor-default transition-colors duration-[var(--dur-2)]",
        checked ? "bg-accent" : "bg-[rgba(120,120,128,0.2)]")}
    >
      <span className="absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white"
        style={{ transform: `translateX(${checked ? 16 : 0}px)`, transition: "transform var(--dur-3) var(--ease-spring)",
          boxShadow: "0 0 0 0.5px rgba(0,0,0,0.04), 0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.12)" }} />
    </button>
  );
  if (!label) return <span className={className}>{sw}</span>;
  return (
    <div className={cx("flex items-start gap-3", className)}>
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
        <div className="text-[14px]">{label}</div>
        {description && <div className="text-[12.5px] text-muted mt-0.5">{description}</div>}
      </label>
      {sw}
    </div>
  );
}

/** Галочка: скруглённый квадрат 20px, заливка акцентом. indeterminate — прочерк. */
export function Checkbox({ checked, onChange, disabled, indeterminate, label, description, className }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; indeterminate?: boolean;
  label?: ReactNode; description?: ReactNode; className?: string;
}) {
  const on = checked || indeterminate;
  return (
    <label className={cx("inline-flex items-start gap-2.5 select-none", disabled ? "opacity-45 cursor-default" : "cursor-pointer", className)}>
      <button
        type="button" role="checkbox" aria-checked={indeterminate ? "mixed" : checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("press mt-px w-5 h-5 shrink-0 rounded-[6px] inline-flex items-center justify-center cursor-pointer disabled:cursor-default",
          on ? "bg-accent-strong text-white" : "bg-surface shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.18)] hover:shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.3)]")}
      >
        {indeterminate ? <Minus size={13} strokeWidth={3} /> : checked && <Check size={13} strokeWidth={3} />}
      </button>
      {label && (
        <span className="min-w-0">
          <span className="text-[14px] block">{label}</span>
          {description && <span className="text-[12.5px] text-muted block mt-0.5">{description}</span>}
        </span>
      )}
    </label>
  );
}
