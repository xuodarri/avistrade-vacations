"use client";

/**
 * Перетаскивание края выделения: зажать кружок начала или конца и вести по дням. Второй край стоит
 * на месте; если увести край за него, края меняются ролями. Край «берётся», если зажать его на
 * HOLD_MS или сдвинуть мышь дальше SLOP (на таче — только долгое нажатие, иначе это прокрутка).
 * Если увести указатель за левый или правый край сетки, квартал листается сам. Вердикты на все положения края — один запрос при захвате.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { dayTip } from "@/components/kit";
import type { MoveVerdict } from "./types";

const HOLD_MS = 250;
const SLOP = 4;
/** Листаем, только когда указатель ушёл за сетку (в поле карточки), — крайние дни месяцев не задевают */
const EDGE = 2;
const EDGE_MS = 550;

export interface EdgeDrag {
  /** Неподвижный край */
  fixed: string;
  /** День, на котором сейчас тащимый край */
  cur: string;
  /** Где указатель — для плашки у курсора */
  x: number;
  y: number;
}

/** Диапазон по двум краям, в любом порядке */
export const span = (a: string, b: string) => (a <= b ? { start: a, end: b } : { start: b, end: a });

interface Options {
  /** Обёртка сетки месяцев: в ней ловим зажатие, у её краёв листаем */
  grid: RefObject<HTMLElement | null>;
  /** Если день — край текущего выделения, вернуть противоположный (неподвижный) край */
  fixedFor: (iso: string) => string | null;
  /** Вердикты на все положения тащимого края — один запрос */
  preview: (fixed: string) => Promise<Record<string, MoveVerdict>>;
  onDrop: (start: string, end: string) => void;
  onEdge: (dir: -1 | 1) => void;
}

export function useEdgeDrag(opts: Options) {
  const [drag, setDrag] = useState<EdgeDrag | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, MoveVerdict> | null>(null);
  const o = useRef(opts);
  useEffect(() => { o.current = opts; });
  const swallow = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || stop.current) return;
    const iso = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
    const fixed = iso ? o.current.fixedFor(iso) : null;
    if (!iso || !fixed) return;

    const touch = e.pointerType === "touch";
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    let held: EdgeDrag | null = null;
    let edgeDir: -1 | 1 | 0 = 0;
    let edgeTimer: ReturnType<typeof setTimeout> | null = null;

    const place = (x: number, y: number) => {
      if (!held) return;
      const day = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]")?.dataset.day;
      held = { ...held, cur: day ?? held.cur, x, y };
      setDrag(held);
      // у края сетки — листаем квартал, пока указатель там
      const r = o.current.grid.current?.getBoundingClientRect();
      const dir: -1 | 1 | 0 = !r ? 0 : x < r.left - EDGE ? -1 : x > r.right + EDGE ? 1 : 0;
      if (dir !== edgeDir) {
        edgeDir = dir;
        if (edgeTimer) clearTimeout(edgeTimer);
        edgeTimer = null;
        const tick = () => { edgeTimer = setTimeout(() => { o.current.onEdge(dir as -1 | 1); tick(); }, EDGE_MS); };
        if (dir) tick();
      }
    };

    const grab = (x: number, y: number) => {
      if (held) return;
      clearTimeout(hold);
      held = { fixed, cur: iso, x, y };
      swallow.current = true;
      dayTip.suspend(true);
      o.current.grid.current?.setAttribute("data-grabbing", "");
      try { o.current.grid.current?.setPointerCapture(id); } catch { /* указатель уже отпущен */ }
      setVerdicts(null);
      setDrag(held);
      o.current.preview(fixed).then((v) => { if (held) setVerdicts(v); }).catch(() => {});
      place(x, y);
    };

    const end = (drop: boolean) => {
      const was = held;
      cleanup();
      held = null;
      setDrag(null);
      if (was && drop && was.cur !== iso) { const r = span(was.fixed, was.cur); o.current.onDrop(r.start, r.end); }
      // клик после отпускания — не «выбрать день»
      if (was) setTimeout(() => { swallow.current = false; }, 350);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (held) { place(ev.clientX, ev.clientY); return; }
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) {
        if (touch) end(false); // на таче движение до долгого нажатия — прокрутка страницы
        else grab(ev.clientX, ev.clientY);
      }
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === id) end(true); };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) end(false); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && held) { ev.stopPropagation(); end(false); } };
    const noScroll = (ev: TouchEvent) => { if (held && ev.cancelable) ev.preventDefault(); };
    const noMenu = (ev: Event) => { if (held || touch) ev.preventDefault(); };

    const hold = setTimeout(() => grab(x0, y0), HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("touchmove", noScroll, { passive: false });
    window.addEventListener("contextmenu", noMenu);
    function cleanup() {
      clearTimeout(hold);
      if (edgeTimer) clearTimeout(edgeTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("touchmove", noScroll);
      window.removeEventListener("contextmenu", noMenu);
      try { o.current.grid.current?.releasePointerCapture(id); } catch { /* уже отпущен */ }
      o.current.grid.current?.removeAttribute("data-grabbing");
      if (held) dayTip.suspend(false);
      stop.current = null;
    }
    stop.current = () => end(false);
  };

  /** Клик сразу после перетаскивания — край отпустили, а не нажали на день */
  const consumeClick = () => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  };

  return { drag, verdicts, onPointerDown, consumeClick };
}
