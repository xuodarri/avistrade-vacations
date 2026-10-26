"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { useControlRadius } from "./Surface";

export interface SegmentOption<V extends string> { value: V; label: ReactNode; icon?: LucideIcon; disabled?: boolean }

const H = { sm: 30, md: 36 } as const;
const INSET = 3; // отступ ползунка от трека: радиус ползунка = радиус трека − 3

/** Ползунок, который плавно едет к активному элементу (общая механика SegmentedControl и Tabs). */
function useThumb(count: number, index: number) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return setBox(null);
    const update = () => setBox({ left: el.offsetLeft, width: el.offsetWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, count]);
  return { refs, box };
}

function arrowNav<V extends string>(e: KeyboardEvent, options: SegmentOption<V>[], value: V, onChange: (v: V) => void) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  e.preventDefault();
  const live = options.filter((o) => !o.disabled);
  const i = live.findIndex((o) => o.value === value);
  const next = live[(i + (e.key === "ArrowRight" ? 1 : -1) + live.length) % live.length];
  if (next) onChange(next.value);
}

/** Сегменты как в iOS: трек-заливка и белый ползунок с тенью, который анимированно переезжает. */
export function SegmentedControl<V extends string>({
  options, value, onChange, size = "md", block, className, "aria-label": ariaLabel,
}: {
  options: SegmentOption<V>[]; value: V; onChange: (v: V) => void; size?: "sm" | "md"; block?: boolean; className?: string; "aria-label"?: string;
}) {
  const index = options.findIndex((o) => o.value === value);
  const { refs, box } = useThumb(options.length, index);
  const r = useControlRadius(H[size]);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(e) => arrowNav(e, options, value, onChange)}
      className={cx("relative inline-flex bg-fill-2 select-none", block && "flex w-full", className)}
      style={{ height: H[size], padding: INSET, borderRadius: r }}
    >
      {box && (
        <span
          aria-hidden
          className="absolute bg-surface"
          style={{
            top: INSET, bottom: INSET, left: box.left, width: box.width, borderRadius: Math.max(r - INSET, 4),
            boxShadow: "0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.08), 0 3px 8px rgba(0,0,0,0.06)",
            transition: "left var(--dur-3) var(--ease-spring), width var(--dur-3) var(--ease-spring)",
          }}
        />
      )}
      {options.map((o, i) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative z-[1] inline-flex items-center justify-center gap-1.5 px-3.5 font-medium whitespace-nowrap cursor-pointer",
              "transition-colors duration-[var(--dur-2)] disabled:opacity-40 disabled:cursor-default",
              size === "sm" ? "text-[12.5px]" : "text-[13.5px]", block && "flex-1",
              active ? "text-text" : "text-muted hover:text-text-2",
            )}
            style={{ borderRadius: Math.max(r - INSET, 4) }}
          >
            {Icon && <Icon size={size === "sm" ? 14 : 15} strokeWidth={2} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Вкладки: текст с плавной полоской-индикатором снизу. Для переключения разделов внутри экрана. */
export function Tabs<V extends string>({
  tabs, value, onChange, className,
}: { tabs: (SegmentOption<V> & { count?: number })[]; value: V; onChange: (v: V) => void; className?: string }) {
  const index = tabs.findIndex((o) => o.value === value);
  const { refs, box } = useThumb(tabs.length, index);
  return (
    <div role="tablist" onKeyDown={(e) => arrowNav(e, tabs, value, onChange)}
      className={cx("relative flex gap-6 border-b-[0.5px] border-line", className)}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            className={cx(
              "relative h-10 inline-flex items-center gap-1.5 text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-[var(--dur-2)]",
              active ? "text-text" : "text-muted hover:text-text-2", "disabled:opacity-40",
            )}
          >
            {Icon && <Icon size={15} strokeWidth={2} />}
            {t.label}
            {t.count != null && <span className={cx("text-[12px] tnum", active ? "text-muted" : "text-muted-2")}>{t.count}</span>}
          </button>
        );
      })}
      {box && (
        <span aria-hidden className="absolute -bottom-px h-[2px] rounded-full bg-text"
          style={{ left: box.left, width: box.width, transition: "left var(--dur-3) var(--ease-spring), width var(--dur-3) var(--ease-spring)" }} />
      )}
    </div>
  );
}
