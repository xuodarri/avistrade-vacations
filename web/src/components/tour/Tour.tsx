"use client";
/* eslint-disable react-hooks/refs -- @floating-ui/react отдаёт колбэк-рефы (refs.setFloating), во время рендера refs не читаются. */

/**
 * Движок тура: затемнение страницы с вырезом вокруг элемента шага и карточка рядом (@floating-ui/react).
 *
 * - Вырез — div с огромной тенью; его радиус = радиус элемента + отступ (концентрично). Между шагами вырез
 *   переезжает (380 мс, при prefers-reduced-motion сразу), позицию пишет rAF-цикл: вырез не отстаёт от прокрутки.
 * - Перед шагом страница плавно прокручивается к элементу. Нет элемента — шаг пропускается.
 *   Шаг с `reveal` сам нажимает кнопку, которая показывает цель (панель заявки), и закрывает её (Esc),
 *   когда тур уходит назад, до этого шага, или закрывается.
 * - Каждый шаг рисуется в свой новый контейнер в конце body. Шторки kit (FloatingFocusManager + useDismiss) помечают
 *   «чужими» узлы, что были до их открытия, и закрываются по клику в них; узел, добавленный позже, они пропускают.
 * - Клавиши: → и Enter — далее, ← — назад, Esc — закрыть. Пока тур открыт, экран под ним клавиш не получает.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingArrow, arrow, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { X } from "lucide-react";
import { Button, IconButton, Surface, cx, toast } from "@/components/kit";
import { originOf } from "@/components/kit/Popover";
import { toSelector, type TourDef, type TourStep } from "./steps";

const PAD = 6; // вырез шире элемента
const HEADER = 64; // липкая шапка: прокручиваем так, чтобы элемент не уходил под неё
const DUR = 380; // --dur-3
const DIM = "rgba(20, 20, 24, 0.42)";

type Box = { x: number; y: number; w: number; h: number; r: number };
interface Shown { i: number; el: HTMLElement; host: HTMLElement; n: number; total: number; last: boolean }

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// ожидания — на таймерах: rAF в фоновой вкладке почти не тикает
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** Виден ли элемент. `appearing` — только что открытая шторка ещё в анимации с opacity 0: её не отбрасываем. */
function visible(el: HTMLElement, appearing = false) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return el.checkVisibility?.({ opacityProperty: !appearing, visibilityProperty: true }) ?? true;
}

function query(sel?: string, appearing = false) {
  if (!sel) return null;
  try {
    // слой самого тура не ищем: у карточки тоже role="dialog"
    for (const el of document.querySelectorAll<HTMLElement>(sel)) if (!el.closest("[data-tour=layer]") && visible(el, appearing)) return el;
  } catch { /* кривой селектор в данных шага */ }
  return null;
}

const findTarget = (s: TourStep, appearing = false) => query(toSelector(s.anchor), appearing) ?? query(s.fallback, appearing);

/** Кнопка, открывающая цель шага: якорь другого шага берётся вместе с его запасным селектором. */
const findReveal = (steps: TourStep[], reveal: string) => {
  const s = steps.find((x) => x.anchor === reveal);
  return s ? findTarget(s) : query(toSelector(reveal));
};

/** Закрыть шторку или окно kit, которые открыл тур: они слушают Esc на document. */
const closeLayer = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

const radii = new WeakMap<HTMLElement, number>();
/** Радиус элемента; у обёртки без скругления — радиус ребёнка того же размера (Section, обёртка с data-tour). */
function radiusOf(el: HTMLElement) {
  const known = radii.get(el);
  if (known !== undefined) return known;
  const read = (e: Element) => parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0;
  let r = read(el);
  const c = el.firstElementChild;
  if (!r && c && el.children.length === 1) {
    const a = c.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2) r = read(c);
  }
  radii.set(el, r);
  return r;
}

function measure(el: HTMLElement): Box {
  const b = el.getBoundingClientRect();
  const w = b.width + PAD * 2, h = b.height + PAD * 2;
  const r = radiusOf(el);
  return { x: b.left - PAD, y: b.top - PAD, w, h, r: Math.min(r ? r + PAD : 12, Math.min(w, h) / 2) };
}

const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const mix = (a: Box, b: Box, t: number): Box => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t, r: a.r + (b.r - a.r) * t,
});

function paint(cut: HTMLElement | null, b: Box | null) {
  if (!cut || !b) return;
  Object.assign(cut.style, {
    transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: `${b.r}px`,
  });
}

/**
 * Прокрутить к элементу: сначала вложенные горизонтальные прокрутки (полоса в Ганте) — элемент к центру,
 * потом окно — элемент целиком по центру, а высокий — с верхнего края.
 */
function bringIntoView(el: HTMLElement, smooth: boolean) {
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.scrollWidth <= p.clientWidth + 1 || !/auto|scroll/.test(getComputedStyle(p).overflowX)) continue;
    const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
    if (a.left >= b.left && a.right <= b.right) continue;
    p.scrollBy({ left: a.left + a.width / 2 - (b.left + b.width / 2), behavior });
  }
  const r = el.getBoundingClientRect();
  const top = HEADER + 16, bottom = window.innerHeight - 16, room = bottom - top;
  if (r.top >= top && r.bottom <= bottom) return;
  const dy = r.height <= room ? r.top - top - (room - r.height) / 2 : r.top - top;
  window.scrollBy({ top: dy, behavior });
}

function waitFor(get: () => HTMLElement | null, ms: number) {
  return new Promise<HTMLElement | null>((res) => {
    const t0 = performance.now();
    const loop = () => {
      const el = get();
      if (el || performance.now() - t0 > ms) res(el);
      else setTimeout(loop, 40);
    };
    loop();
  });
}

/** Тур по шагам. Монтируется открытым; `onClose` — пройден до конца или закрыт. */
export function TourRunner({ tour, onClose }: { tour: TourDef; onClose: () => void }) {
  const steps = tour.steps;
  const [cur, setCur] = useState<Shown | null>(null);
  const seq = useRef(0); // номер перехода: устаревший асинхронный переход не применяется
  const opened = useRef<number | null>(null); // шаг, на котором тур открыл шторку
  const box = useRef<Box | null>(null); // текущий нарисованный вырез
  const anim = useRef<{ from: Box | null; fromEl: HTMLElement | null; at: number }>({ from: null, fromEl: null, at: 0 });
  const cutRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const arrowWrap = useRef<HTMLSpanElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const curRef = useRef<Shown | null>(null);
  const first = useRef(true);

  const step = cur ? steps[cur.i] : null;
  const f = useFloating({
    open: !!cur,
    placement: step?.placement ?? "bottom",
    elements: { reference: cur?.el ?? null },
    whileElementsMounted: (ref, fl, update) => autoUpdate(ref, fl, update, { animationFrame: true }),
    middleware: [
      offset(PAD + 12),
      flip({ padding: 12, fallbackPlacements: ["bottom", "top", "right", "left"], fallbackStrategy: "bestFit" }),
      shift({ padding: 12, crossAxis: true }),
      arrow({ element: arrowRef, padding: 22 }),
    ],
  });

  // onClose родителя может меняться на каждый рендер — тур из-за этого не перезапускается
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const close = useCallback(() => {
    seq.current++;
    if (opened.current !== null) { opened.current = null; closeLayer(); }
    onCloseRef.current();
  }, []);

  /** Доступен ли шаг: цель на странице или её откроет шаг с reveal (тогда и все шаги после него). */
  const available = useCallback((k: number) => !!findTarget(steps[k])
    || steps.slice(0, k + 1).some((s) => s.reveal && findReveal(steps, s.reveal)), [steps]);

  const go = useCallback(async (start: number, d: 1 | -1) => {
    const my = ++seq.current;
    await Promise.resolve();
    if (my !== seq.current) return;
    for (let j = start; j >= 0 && j < steps.length; j += d) {
      const s = steps[j];
      if (opened.current !== null && j < opened.current) {
        opened.current = null;
        closeLayer();
        await sleep(60);
      }
      // шаги внутри шторки, открытой туром: она может ещё проявляться (opacity 0) — не отбрасываем
      let el = findTarget(s, opened.current !== null && j >= opened.current);
      if (!el && s.reveal) {
        const btn = findReveal(steps, s.reveal);
        if (btn) {
          btn.click();
          opened.current = j;
          el = await waitFor(() => findTarget(s, true), 1500);
        }
      }
      if (my !== seq.current) return;
      if (!el) continue;

      const prev = curRef.current;
      anim.current = { from: box.current, fromEl: prev?.el ?? null, at: performance.now() };
      const host = document.createElement("div");
      host.dataset.tour = "layer";
      document.body.appendChild(host);
      const all = steps.map((_, k) => k === j || available(k));
      const next: Shown = {
        i: j, el, host,
        n: all.slice(0, j + 1).filter(Boolean).length,
        total: all.filter(Boolean).length,
        last: !all.slice(j + 1).some(Boolean),
      };
      curRef.current = next;
      setCur(next);
      bringIntoView(el, !reduced());
      return;
    }
    if (my !== seq.current) return;
    if (d === -1) return; // назад некуда — остаёмся
    if (!curRef.current) toast("На этом экране пока нечего показывать", { tone: "info" });
    close();
  }, [steps, available, close]);

  // старт тура; go асинхронная и ставит состояние после await, каскада рендеров нет
  useEffect(() => { void go(0, 1); }, [go]);

  // контейнер прошлого шага убираем после смены; последний — при закрытии
  useEffect(() => {
    const host = cur?.host;
    if (host && !host.isConnected) document.body.appendChild(host);
    return () => host?.remove();
  }, [cur?.host]);

  // вырез: rAF-цикл, пока тур открыт
  useLayoutEffect(() => {
    if (!cur) return;
    let raf = 0;
    const tick = () => {
      const to = measure(cur.el);
      const a = anim.current;
      const t = reduced() ? 1 : Math.min(1, (performance.now() - a.at) / DUR);
      const from = a.fromEl?.isConnected && visible(a.fromEl) ? measure(a.fromEl) : a.from;
      const b = from && t < 1 ? mix(from, to, ease(t)) : to;
      box.current = b;
      paint(cutRef.current, b);
      // стрелка — только когда карточка не наезжает на элемент (у высоких блоков она встаёт поверх)
      const fl = f.refs.floating.current?.getBoundingClientRect();
      if (arrowWrap.current && fl) {
        const over = fl.left < to.x + to.w && fl.right > to.x && fl.top < to.y + to.h && fl.bottom > to.y;
        arrowWrap.current.style.opacity = over ? "0" : "1";
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [cur, f.refs.floating]);

  // фокус на «Далее» на каждом шаге
  useEffect(() => {
    if (!cur) return;
    first.current = false;
    nextRef.current?.focus({ preventScroll: true });
  }, [cur]);

  // клавиши: в фазе захвата на window, экран под туром их не получает
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.key === "Tab") return;
      e.stopPropagation();
      const c = curRef.current;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (!c) return;
      if (e.key === "ArrowRight") { e.preventDefault(); void go(c.i + 1, 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); void go(c.i - 1, -1); }
      else if (e.key === "Enter") {
        const a = document.activeElement;
        if (a instanceof HTMLButtonElement && c.host.contains(a)) return; // Enter на кнопке карточки — её же нажатие
        e.preventDefault();
        void go(c.i + 1, 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, close]);

  if (!cur || !step) return null;
  const titleId = `tour-title-${cur.i}`;

  return createPortal(
    <>
      {/* затемнение: ловит клики, чтобы страница под туром не нажималась */}
      <div className={cx("fixed inset-0 z-[100]", first.current && "kit-fade")} aria-hidden>
        <div ref={(el) => { cutRef.current = el; paint(el, box.current); }} className="absolute left-0 top-0 pointer-events-none"
          style={{ boxShadow: `0 0 0 9999px ${DIM}` }} />
      </div>
      <div ref={f.refs.setFloating} role="dialog" aria-modal="true" aria-labelledby={titleId}
        style={{ ...f.floatingStyles, zIndex: 101 }}>
        <Surface level="block" tone="raised" pad={16} className="kit-pop shadow-3 w-[320px] max-w-[calc(100vw-24px)] flex flex-col"
          style={originOf(f.placement)}>
          <div className="flex items-start gap-2">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.015em] leading-snug pt-1">{step.title}</h2>
            <IconButton icon={X} label="Закрыть (Esc)" size="sm" noTooltip className="ml-auto -mr-1.5 -mt-1" onClick={close} />
          </div>
          <p className="text-[13.5px] text-text-2 leading-snug mt-1">{step.text}</p>
          <div className="flex items-center gap-2 mt-4">
            <span className="text-[12.5px] text-muted tnum">Шаг {cur.n} из {cur.total}</span>
            <div className="ml-auto flex items-center gap-1.5">
              {cur.n > 1 && <Button size="sm" variant="ghost" onClick={() => void go(cur.i - 1, -1)}>Назад</Button>}
              <Button ref={nextRef} size="sm" variant="primary" onClick={() => (cur.last ? close() : void go(cur.i + 1, 1))}>
                {cur.last ? "Готово" : "Далее"}
              </Button>
            </div>
          </div>
        </Surface>
        <span ref={arrowWrap} className="transition-opacity duration-[var(--dur-1)]">
          <FloatingArrow ref={arrowRef} context={f.context} fill="#FFFFFF" width={16} height={8} tipRadius={2} />
        </span>
      </div>
    </>,
    cur.host,
  );
}
