"use client";

/**
 * Поверхности и правило концентричности.
 *
 *   радиус внутри = радиус снаружи − отступ (inner = r − pad)
 *
 * Шкала: панель 28 → блок 20 → контрол 12 → ползунок 9 → пилюля круглая.
 * Каждая Surface кладёт в контекст свой внутренний радиус (и CSS-переменную --r-in),
 * а контролы kit (Button, Input, Select, SegmentedControl…) берут радиус оттуда сами:
 * min(внутренний радиус, высота / 2). Вложенная Surface с `nested` получает радиус
 * от родителя. Пресеты подобраны так, что внутри всегда выходит 12:
 *   panel 28 − pad 16 = 12      inset-панель 28 − 8 = 20 (блоки) → блок 20 − 8 = 12
 */
import { createContext, useContext, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export const R = { panel: 28, block: 20, control: 12, thumb: 9, pill: 9999 } as const;

const RadiusCtx = createContext<number>(R.control);
/** Радиус, который должен взять контрол или блок, стоящий у края текущей поверхности. */
export const useInnerRadius = () => useContext(RadiusCtx);
/**
 * Радиус контрола высоты h: всегда 12, но не круглее капсулы. Концентричность у края держат
 * отступы пресетов (panel 28 − 16 = 12, block 20 − 8 = 12). При большем отступе контрол не у
 * края, и уменьшать его радиус не нужно — иначе при pad 24 кнопки стали бы квадратными.
 */
export const useControlRadius = (h: number) => Math.min(R.control, h / 2);

type Level = "panel" | "block" | "inset";
const PRESET: Record<Level, { r: number; pad: number }> = {
  panel: { r: R.panel, pad: 16 }, // карточка верхнего уровня; контролы у края — 12
  inset: { r: R.panel, pad: 8 }, // панель, внутри которой лежат блоки (как сгруппированный список iOS)
  block: { r: R.block, pad: 8 }, // блок внутри inset-панели или поповер
};

/** Плюс обычные атрибуты и события DOM (onMouseEnter, id, role…): уходят на корневой элемент. */
export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "style" | "children"> {
  level?: Level;
  /** Взять радиус у родительской Surface (= её внутренний радиус). */
  nested?: boolean;
  /** Отступ, px. Меняет и внутренний радиус: inner = r − pad. */
  pad?: number;
  /** Плоская заливка без тени — для блоков внутри панели. */
  tone?: "raised" | "flat" | "tinted";
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  [k: `data-${string}`]: string | undefined;
}

export function Surface({ level = "panel", nested, pad, tone, as: Tag = "div", className, style, children, ...rest }: SurfaceProps) {
  const parentInner = useContext(RadiusCtx);
  const preset = PRESET[level];
  const r = nested ? parentInner : preset.r;
  const p = pad ?? preset.pad;
  const inner = Math.max(r - p, 6);
  const t = tone ?? (nested || level === "block" ? "flat" : "raised");
  return (
    <RadiusCtx.Provider value={inner}>
      <Tag
        {...rest}
        className={cx(
          t === "raised" && "bg-surface shadow-1",
          t === "flat" && "bg-surface-alt",
          t === "tinted" && "bg-fill-3",
          className,
        )}
        style={{ borderRadius: r, padding: p, ["--r-in" as string]: `${inner}px`, ...style }}
      >
        {children}
      </Tag>
    </RadiusCtx.Provider>
  );
}

/** Карточка = Surface level="panel". */
export const Card = (p: Omit<SurfaceProps, "level">) => <Surface level="panel" {...p} />;

/** Секция с заголовком: заголовок, подпись, действие справа, тело — карточка. */
export function Section({
  title, description, action, children, className, bodyClassName, pad, ...rest
}: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode;
  className?: string; bodyClassName?: string; pad?: number;
  /** data-* уходят на корневой <section> (например, data-tour для тура «Помощь»). */
  [k: `data-${string}`]: string | undefined;
}) {
  return (
    <section {...rest} className={cx("flex flex-col gap-3", className)}>
      <div className="flex items-end gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[19px] font-semibold tracking-[-0.022em] leading-tight">{title}</h2>
          {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
        </div>
        {action && <div className="ml-auto shrink-0 flex items-center gap-2">{action}</div>}
      </div>
      <Card pad={pad} className={bodyClassName}>{children}</Card>
    </section>
  );
}

/** Заголовок страницы: крупный, с отрицательным трекингом. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4 mb-7">
      <div className="min-w-0">
        <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.032em]">{title}</h1>
        {subtitle && <div className="text-[15px] text-muted mt-1.5">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
