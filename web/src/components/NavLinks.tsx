"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

/** Разделы как сегменты: светлый трек и белый ползунок, который переезжает к активному разделу. */
export function NavLinks({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  const index = items.findIndex((i) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/")));
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return setBox(null);
    const update = () => setBox({ left: el.offsetLeft, width: el.offsetWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, items.length]);

  if (items.length < 2) return null;
  return (
    <nav className="relative hidden md:flex items-center h-9 p-[3px] rounded-full bg-fill-2 min-w-0 overflow-x-auto [scrollbar-width:none]">
      {box && (
        <span aria-hidden className="absolute top-[3px] bottom-[3px] rounded-full bg-surface"
          style={{
            left: box.left, width: box.width,
            boxShadow: "0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.08), 0 3px 8px rgba(0,0,0,0.06)",
            transition: "left var(--dur-3) var(--ease-spring), width var(--dur-3) var(--ease-spring)",
          }} />
      )}
      {items.map((i, k) => (
        <Link
          key={i.href}
          ref={(el) => { refs.current[k] = el; }}
          href={i.href}
          aria-current={k === index ? "page" : undefined}
          className={`relative z-[1] h-full shrink-0 inline-flex items-center px-3.5 rounded-full text-[13.5px] font-medium whitespace-nowrap transition-colors duration-[var(--dur-2)] ${
            k === index ? "text-text" : "text-muted hover:text-text-2"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
