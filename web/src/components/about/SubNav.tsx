"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/components/kit";

/** Липкое оглавление страницы «О решении»: капсула со ссылками на разделы, активный — по прокрутке. */
export function SubNav({ items, className }: { items: { id: string; label: string }[]; className?: string }) {
  const [active, setActive] = useState(items[0]?.id);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    // активный — последний раздел, чей верх уже под оглавлением; считаем раз в кадр при прокрутке
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.35;
      let current = items[0]?.id;
      for (const i of items) {
        const el = document.getElementById(i.id);
        if (el && el.getBoundingClientRect().top <= line) current = i.id;
      }
      setActive(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, [items]);

  useLayoutEffect(() => {
    const el = active ? refs.current[active] : null;
    if (!el) return setBox(null);
    setBox({ left: el.offsetLeft, width: el.offsetWidth });
    // активная ссылка всегда видна в прокручиваемой полосе на телефоне
    const t = track.current;
    if (t && (el.offsetLeft < t.scrollLeft || el.offsetLeft + el.offsetWidth > t.scrollLeft + t.clientWidth)) {
      t.scrollTo({ left: el.offsetLeft - 24, behavior: "smooth" });
    }
  }, [active]);

  return (
    <div className={cx("sticky z-30 flex justify-center pointer-events-none", className)} style={{ top: "calc(var(--header-h) + 12px)" }}>
      <nav aria-label="Разделы страницы"
        className="pointer-events-auto max-w-full rounded-full bg-[var(--glass)] backdrop-blur-xl backdrop-saturate-150 shadow-2 p-1">
        <div ref={track} className="relative flex items-center overflow-x-auto [scrollbar-width:none]">
          {box && (
            <span aria-hidden className="absolute top-0 bottom-0 rounded-full bg-surface shadow-1"
              style={{ left: box.left, width: box.width, transition: "left var(--dur-3) var(--ease-spring), width var(--dur-3) var(--ease-spring)" }} />
          )}
          {items.map((i) => (
            <a key={i.id} href={`#${i.id}`} ref={(el) => { refs.current[i.id] = el; }}
              aria-current={active === i.id ? "true" : undefined}
              onClick={(e) => {
                const target = document.getElementById(i.id);
                if (!target) return;
                e.preventDefault();
                const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
                history.replaceState(null, "", `#${i.id}`);
              }}
              className={cx(
                "relative shrink-0 h-8 px-3.5 inline-flex items-center rounded-full text-[13px] font-medium whitespace-nowrap transition-colors press",
                active === i.id ? "text-text" : "text-muted hover:text-text",
              )}>
              {i.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
