"use client";
/* eslint-disable react-hooks/refs -- @floating-ui/react отдаёт колбэк-рефы (refs.setReference/setFloating)
   и списки для навигации через ref; это штатный способ библиотеки, во время рендера refs не читаются. */

import { useRef, useState, type ReactNode } from "react";
import {
  FloatingFocusManager, FloatingPortal, useInteractions, useListNavigation, useTypeahead, type Placement,
} from "@floating-ui/react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Surface, useInnerRadius } from "./Surface";
import { POPOVER_PAD, originOf, useAnchored, withTrigger } from "./Popover";

export type MenuItem =
  | { label: string; icon?: LucideIcon; onSelect: () => void; destructive?: boolean; disabled?: boolean; hint?: ReactNode }
  | { separator: true }
  | { heading: string };

/** Выпадающее меню действий. `children` — триггер (обычно Button или IconButton). */
export function Menu({ items, children, placement = "bottom-end", width = 240 }: {
  items: MenuItem[]; children: ReactNode; placement?: Placement; width?: number;
}) {
  const a = useAnchored({ placement, role: "menu" });
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<(HTMLElement | null)[]>([]);
  const labels = useRef<(string | null)[]>([]);
  const actions = items.map((it) => ("onSelect" in it ? it : null));
  const disabledIdx = actions.flatMap((it, i) => (!it || it.disabled ? [i] : []));
  const nav = useListNavigation(a.f.context, { listRef, activeIndex: active, onNavigate: setActive, loop: true, disabledIndices: disabledIdx });
  labels.current = actions.map((it) => it?.label ?? null);
  const type = useTypeahead(a.f.context, { listRef: labels, activeIndex: active, onMatch: a.open ? setActive : undefined });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([a.click, a.dismiss, a.role, nav, type]);

  return (
    <>
      {withTrigger(children, a.f.refs.setReference, getReferenceProps)}
      {a.open && (
        <FloatingPortal>
          <FloatingFocusManager context={a.f.context} modal={false}>
            <div ref={a.f.refs.setFloating} style={{ ...a.f.floatingStyles, zIndex: 85 }} {...getFloatingProps()}>
              <Surface level="block" tone="raised" pad={POPOVER_PAD} className="kit-pop shadow-3 scroll outline-none"
                style={{ width, maxHeight: "inherit", ...originOf(a.f.placement) }}>
                {items.map((it, i) =>
                  "separator" in it ? <div key={i} className="h-[0.5px] bg-line my-1.5 mx-2" /> :
                  "heading" in it ? <div key={i} className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-muted-2">{it.heading}</div> :
                  <MenuRow key={i} item={it} active={active === i}
                    {...getItemProps({
                      ref: (el: HTMLElement | null) => { listRef.current[i] = el; },
                      onClick: () => { if (it.disabled) return; a.setOpen(false); it.onSelect(); },
                    })} />,
                )}
              </Surface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function MenuRow({ item, active, ...props }: { item: Extract<MenuItem, { onSelect: () => void }>; active: boolean } & Record<string, unknown>) {
  const r = useInnerRadius();
  const Icon = item.icon;
  return (
    <button
      type="button" role="menuitem" tabIndex={active ? 0 : -1} disabled={item.disabled} {...props}
      className={cx("w-full flex items-center gap-2.5 h-9 px-2.5 text-left text-[14px] outline-none cursor-pointer disabled:opacity-40 disabled:cursor-default",
        item.destructive ? "text-bad" : "text-text", active && !item.disabled && (item.destructive ? "bg-bad-bg" : "bg-fill-2"))}
      style={{ borderRadius: r }}
    >
      {Icon && <Icon size={16} strokeWidth={2} className={item.destructive ? "" : "text-muted"} />}
      <span className="flex-1 truncate">{item.label}</span>
      {item.hint && <span className="text-[12px] text-muted-2">{item.hint}</span>}
    </button>
  );
}
