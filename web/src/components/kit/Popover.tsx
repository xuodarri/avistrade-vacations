"use client";
/* eslint-disable react-hooks/refs -- @floating-ui/react отдаёт колбэк-рефы (refs.setReference/setFloating)
   и списки для навигации через ref; это штатный способ библиотеки, во время рендера refs не читаются. */

/**
 * Якорные всплывающие окна на @floating-ui/react: авто-переворот у края экрана, сдвиг,
 * закрытие по Esc и клику мимо, фокус-ловушка. Панель — Surface level="block" (радиус 20,
 * отступ 6 → элементы внутри 14, концентрично).
 */
import {
  cloneElement, isValidElement, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type Ref,
} from "react";
import {
  FloatingArrow, FloatingFocusManager, FloatingPortal, arrow, autoUpdate, flip, offset, shift, size as sizeMw, useClick, useDismiss, useFocus,
  useFloating, useHover, useInteractions, useRole, type Placement,
} from "@floating-ui/react";
import { cx } from "./cx";
import { Surface } from "./Surface";

export const POPOVER_PAD = 6;

/** Откуда «вырастает» окно — для анимации появления. */
export function originOf(placement: Placement): CSSProperties {
  const side = placement.split("-")[0];
  const align = placement.split("-")[1];
  const x = align === "start" ? "left" : align === "end" ? "right" : "center";
  const map: Record<string, [string, string]> = {
    bottom: [`${x} top`, "-4px"], top: [`${x} bottom`, "4px"], left: ["right center", "0px"], right: ["left center", "0px"],
  };
  const [origin, dy] = map[side] ?? map.bottom;
  return { ["--pop-origin" as string]: origin, ["--pop-dy" as string]: dy };
}

/** Общая механика: позиция, открытие, клавиатура. Возвращает всё для триггера и панели. */
export function useAnchored({
  open: controlled, onOpenChange, placement = "bottom-start", matchWidth, role = "dialog", gap = 8, maxHeight = 440,
}: {
  open?: boolean; onOpenChange?: (o: boolean) => void; placement?: Placement; matchWidth?: boolean;
  role?: "dialog" | "menu" | "listbox"; gap?: number;
  /** Потолок высоты окна; списки — 440, поповеры с содержимым — по высоте экрана. */
  maxHeight?: number;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (o: boolean) => { if (controlled === undefined) setInner(o); onOpenChange?.(o); };
  const f = useFloating({
    open, onOpenChange: setOpen, placement, whileElementsMounted: autoUpdate,
    middleware: [
      offset(gap), flip({ padding: 12 }), shift({ padding: 12 }),
      sizeMw({
        padding: 12,
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(160, Math.min(availableHeight, maxHeight))}px`,
            ...(matchWidth ? { minWidth: `${rects.reference.width}px` } : {}),
          });
        },
      }),
    ],
  });
  const click = useClick(f.context);
  const dismiss = useDismiss(f.context);
  const r = useRole(f.context, { role });
  return { open, setOpen, f, click, dismiss, role: r };
}

type TriggerEl = ReactElement<Record<string, unknown> & { ref?: Ref<HTMLElement> }>;

function setRef(r: Ref<HTMLElement> | undefined, el: HTMLElement | null) {
  if (typeof r === "function") r(el);
  else if (r) (r as { current: HTMLElement | null }).current = el;
}

/**
 * Привязать триггер: клонирует единственного ребёнка с ref и обработчиками. Свои пропсы и ref
 * ребёнка сохраняются: getProps получает их и сливает с обработчиками floating-ui, ref — общий.
 * Поэтому триггеры можно вкладывать: Tooltip внутри Menu, IconButton с подсказкой как триггер Popover.
 */
export function withTrigger(child: ReactNode, ref: (el: HTMLElement | null) => void, getProps: (own: Record<string, unknown>) => Record<string, unknown>) {
  if (!isValidElement(child)) return child;
  const el = child as TriggerEl;
  const own = el.props;
  const merged = (node: HTMLElement | null) => { ref(node); setRef(own.ref, node); };
  return cloneElement(el, { ...getProps(own), ref: merged } as Record<string, unknown>);
}

/** Поповер: произвольное содержимое у якоря. `children` — триггер (один элемент). */
export function Popover({
  content, children, open, onOpenChange, placement, width, className, pad = 16,
}: {
  content: ReactNode | ((close: () => void) => ReactNode); children: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void;
  placement?: Placement; width?: number; className?: string; pad?: number;
}) {
  const a = useAnchored({ open, onOpenChange, placement, maxHeight: Infinity });
  const { getReferenceProps, getFloatingProps } = useInteractions([a.click, a.dismiss, a.role]);
  return (
    <>
      {withTrigger(children, a.f.refs.setReference, getReferenceProps)}
      {a.open && (
        <FloatingPortal>
          <FloatingFocusManager context={a.f.context} modal={false} initialFocus={-1}>
            <div ref={a.f.refs.setFloating} style={{ ...a.f.floatingStyles, zIndex: 85 }} {...getFloatingProps()}>
              <Surface level="block" tone="raised" pad={pad} className={cx("kit-pop shadow-3 scroll outline-none", className)}
                style={{ width, maxHeight: "inherit", ...originOf(a.f.placement) }}>
                {typeof content === "function" ? content(() => a.setOpen(false)) : content}
              </Surface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

export const TOOLTIP_BG = "rgba(29, 29, 31, 0.94)";

/** Подсказка: тёмный пузырь со стрелкой по наведению или фокусу, с задержкой. Вместо нативного title. */
export function Tooltip({ content, children, placement = "top", delay = 350 }: {
  content: ReactNode; children: ReactNode; placement?: Placement; delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const f = useFloating({
    open, onOpenChange: setOpen, placement, whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowRef, padding: 10 })],
  });
  const hover = useHover(f.context, { delay: { open: delay, close: 60 }, move: false });
  const focus = useFocus(f.context);
  const dismiss = useDismiss(f.context);
  const role = useRole(f.context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  if (!content) return <>{children}</>;
  return (
    <>
      {withTrigger(children, f.refs.setReference, getReferenceProps)}
      {open && (
        <FloatingPortal>
          <div ref={f.refs.setFloating} style={{ ...f.floatingStyles, zIndex: 95, pointerEvents: "none" }} {...getFloatingProps()}>
            <div className="kit-pop max-w-[280px] rounded-[10px] text-white text-[12.5px] leading-snug px-2.5 py-1.5 shadow-2 backdrop-blur-md"
              style={{ background: TOOLTIP_BG, ...originOf(f.placement) }}>
              {content}
            </div>
            <FloatingArrow ref={arrowRef} context={f.context} fill={TOOLTIP_BG} width={14} height={7} tipRadius={2} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
