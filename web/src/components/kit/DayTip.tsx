"use client";

/**
 * Подсказка дня календаря — один пузырь на всю страницу.
 *
 * Все `CalendarMonth` (сколько бы их ни стояло рядом: год, квартал, два месяца в пикере) зовут
 * `dayTip.show(ячейка, содержимое)` и `dayTip.hide()`. Рисует пузырь `DayTipHost`, он один и
 * смонтирован в `app/layout.tsx`. Поэтому переход в соседний месяц для пузыря — то же самое,
 * что переход на соседний день.
 *
 * Поведение как у нативных подсказок macOS:
 * - первое появление через 300 мс; пока пузырь открыт, смена дня мгновенная;
 * - уход с дня прячет пузырь не сразу, а через 120 мс: зазоры между днями и месяцами его не моргают;
 * - после скрытия ещё 500 мс «тёпло»: следующий день показывается без задержки;
 * - позиция не анимируется никогда: пузырь сразу встаёт на новое место. Анимируются только
 *   появление и исчезновение (opacity и scale 0.98 → 1 от стрелки);
 * - до первого расчёта позиции пузырь невидим, в углу экрана он не рисуется.
 */
import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { arrow, autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/react";
import { cx } from "./cx";
import { TOOLTIP_BG as BUBBLE } from "./Popover";

const OPEN_DELAY = 300;
const HIDE_DELAY = 120;
const WARM_MS = 500;
const OUT_MS = 120;

type Phase = "closed" | "open" | "out";
interface TipState { phase: Phase; el: HTMLElement | null; content: ReactNode; session: number }

let state: TipState = { phase: "closed", el: null, content: null, session: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<TipState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

let openTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let outTimer: ReturnType<typeof setTimeout> | null = null;
let pending: { el: HTMLElement; content: ReactNode } | null = null;
let lastHidden = 0;
let suspended = false;
const clear = (t: ReturnType<typeof setTimeout> | null) => { if (t) clearTimeout(t); return null; };

/** Управление общим пузырём. Звать из обработчиков наведения и фокуса. */
export const dayTip = {
  show(el: HTMLElement, content: ReactNode) {
    if (suspended) return;
    hideTimer = clear(hideTimer);
    if (state.phase === "open") { set({ el, content }); return; }
    if (state.phase === "out" || Date.now() - lastHidden < WARM_MS) {
      outTimer = clear(outTimer);
      set({ phase: "open", el, content, session: state.phase === "out" ? state.session : state.session + 1 });
      return;
    }
    pending = { el, content };
    if (!openTimer) {
      openTimer = setTimeout(() => {
        openTimer = null;
        if (pending) set({ phase: "open", el: pending.el, content: pending.content, session: state.session + 1 });
        pending = null;
      }, OPEN_DELAY);
    }
  },
  hide() {
    openTimer = clear(openTimer);
    pending = null;
    if (state.phase !== "open" || hideTimer) return;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      lastHidden = Date.now();
      set({ phase: "out" });
      outTimer = setTimeout(() => { outTimer = null; set({ phase: "closed", el: null, content: null }); }, OUT_MS);
    }, HIDE_DELAY);
  },
  /**
   * Пауза подсказки (например, на время перетаскивания части): пока включена, show игнорируется,
   * открытый пузырь закрывается сразу, без анимации. После снятия паузы — обычная задержка 300 мс.
   */
  suspend(on: boolean) {
    suspended = on;
    if (!on) return;
    openTimer = clear(openTimer); hideTimer = clear(hideTimer); outTimer = clear(outTimer);
    pending = null;
    lastHidden = 0;
    if (state.phase !== "closed") set({ phase: "closed", el: null, content: null });
  },
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const CLOSED: TipState = { phase: "closed", el: null, content: null, session: 0 };

/** Единственный пузырь подсказки дня. Уже смонтирован в app/layout.tsx — экранам ставить не нужно. */
export function DayTipHost() {
  const s = useSyncExternalStore(subscribe, () => state, () => CLOSED);
  const floatRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);

  // позиция — императивно: computePosition завершается микрозадачей до отрисовки кадра,
  // поэтому при смене дня пузырь ни разу не рисуется на старом месте и не летит
  useLayoutEffect(() => {
    const floating = floatRef.current, ref = s.el;
    if (s.phase === "closed" || !floating || !ref) return;
    const place = () => {
      if (!ref.isConnected) return;
      computePosition(ref, floating, {
        placement: "top", strategy: "fixed",
        middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowRef.current!, padding: 12 })],
      }).then(({ x, y, placement, middlewareData }) => {
        const side = placement.split("-")[0] as "top" | "bottom";
        Object.assign(floating.style, { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`, visibility: "visible" });
        floating.dataset.side = side;
        const a = arrowRef.current;
        if (a && middlewareData.arrow) {
          Object.assign(a.style, { left: `${middlewareData.arrow.x ?? 0}px`, [side === "top" ? "bottom" : "top"]: "-7px", [side === "top" ? "top" : "bottom"]: "" });
          a.style.transform = side === "top" ? "none" : "rotate(180deg)";
          floating.style.setProperty("--tip-origin", `${(middlewareData.arrow.x ?? 0) + 7}px ${side === "top" ? "100%" : "0%"}`);
        }
      });
    };
    place();
    return autoUpdate(ref, floating, place);
  }, [s.phase, s.el, s.content]);

  if (s.phase === "closed" || typeof document === "undefined") return null;
  return createPortal(
    <div ref={floatRef} role="tooltip"
      style={{ position: "fixed", left: 0, top: 0, zIndex: 95, pointerEvents: "none", visibility: "hidden", width: "max-content" }}>
      <div key={s.session}
        className={cx("max-w-[260px] rounded-[12px] text-white text-[12.5px] leading-snug px-3 py-2 shadow-2 backdrop-blur-md",
          s.phase === "out" ? "kit-tip-out" : "kit-tip-in")}
        style={{ background: BUBBLE }}>
        {s.content}
      </div>
      <div ref={arrowRef} aria-hidden className="absolute w-[14px] h-[7px]"
        style={{ opacity: s.phase === "out" ? 0 : 1, transition: `opacity ${OUT_MS}ms` }}>
        <svg width="14" height="7" viewBox="0 0 14 7" className="block"><path d="M0 0h14L8.2 6.1a1.6 1.6 0 0 1-2.4 0z" fill={BUBBLE} /></svg>
      </div>
    </div>,
    document.body,
  );
}

/** Цвета точек на тёмном пузыре — светлые варианты статусов. */
const DOT = { ok: "#30D158", warn: "#FFB340", bad: "#FF6961", info: "#64D2FF", vacation: "#409CFF", accent: "#3DDBB0", neutral: "rgba(255,255,255,0.45)" };
export type DayTipTone = keyof typeof DOT;

/** Строка подсказки дня с цветной точкой: «в группе осталось одно место», «запрет: мест нет». */
export function DayTipLine({ tone, dot, children, className }: { tone?: DayTipTone; dot?: string; children: ReactNode; className?: string }) {
  const color = dot ?? (tone ? DOT[tone] : null);
  return (
    <div className={cx("flex items-start gap-2 text-white/90", className)}>
      {color ? <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px]" style={{ background: color }} /> : <span className="w-1.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
