"use client";
/* eslint-disable react-hooks/refs -- @floating-ui/react отдаёт колбэк-рефы (refs.setReference/setFloating)
   и списки для навигации через ref; это штатный способ библиотеки, во время рендера refs не читаются. */

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  FloatingFocusManager, FloatingPortal, useInteractions, useListNavigation, useTypeahead, type Placement,
} from "@floating-ui/react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cx } from "./cx";
import { Surface, useControlRadius, useInnerRadius } from "./Surface";
import { POPOVER_PAD, originOf, useAnchored, withTrigger } from "./Popover";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Вторая строка мелким шрифтом. */
  description?: string;
  /** Что-то слева: иконка, аватар, цветная точка. */
  leading?: ReactNode;
  /** Название группы: опции с одинаковой группой идут под общим заголовком. */
  group?: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string> {
  options: SelectOption<V>[];
  value: V | null;
  onChange: (v: V) => void;
  placeholder?: string;
  /** Поле поиска сверху. По умолчанию включается, когда опций больше 8. */
  searchable?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** Ширина списка; по умолчанию не уже кнопки. */
  menuWidth?: number;
  placement?: Placement;
  /** Свой триггер вместо поля (например, аватар в шапке). Получает выбранную опцию. */
  renderTrigger?: (selected: SelectOption<V> | null, open: boolean) => ReactNode;
  /** Строка над списком (пояснение). */
  header?: ReactNode;
  "aria-label"?: string;
}

const H = { sm: 30, md: 36 } as const;

/** Свой выпадающий список: клавиатура (стрелки, Enter, Esc, ввод букв), поиск, группы, галочка. */
export function Select<V extends string>({
  options, value, onChange, placeholder = "Выберите…", searchable, size = "md", disabled, invalid, className,
  menuWidth, placement = "bottom-start", renderTrigger, header, "aria-label": ariaLabel,
}: SelectProps<V>) {
  const [query, setQueryRaw] = useState("");
  const [active, setActive] = useState<number | null>(null);
  // при открытии подсветить выбранную опцию, при закрытии сбросить поиск
  const a = useAnchored({
    placement, matchWidth: !menuWidth, role: "listbox",
    onOpenChange: (o) => {
      if (o) setActive(Math.max(0, options.findIndex((x) => x.value === value)));
      else setQueryRaw("");
    },
  });
  const setQuery = (q: string) => { setQueryRaw(q); setActive(0); };
  const listRef = useRef<(HTMLElement | null)[]>([]);
  const search = searchable ?? options.length > 8;
  const r = useControlRadius(H[size]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.description ?? ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selectedIdx = visible.findIndex((o) => o.value === value);
  const selected = options.find((o) => o.value === value) ?? null;


  const nav = useListNavigation(a.f.context, {
    listRef, activeIndex: active, selectedIndex: selectedIdx >= 0 ? selectedIdx : null, onNavigate: setActive, loop: true,
    virtual: search || undefined, disabledIndices: visible.flatMap((o, i) => (o.disabled ? [i] : [])),
  });
  const labels = useRef<(string | null)[]>([]);
  labels.current = visible.map((o) => o.label);
  const type = useTypeahead(a.f.context, { listRef: labels, activeIndex: active, onMatch: a.open ? setActive : undefined, enabled: !search });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([a.click, a.dismiss, a.role, nav, type]);

  const pick = (o: SelectOption<V>) => { if (o.disabled) return; onChange(o.value); a.setOpen(false); };

  const trigger = renderTrigger ? (
    <button type="button" disabled={disabled} aria-label={ariaLabel} className={cx("press cursor-pointer disabled:opacity-45", className)}>
      {renderTrigger(selected, a.open)}
    </button>
  ) : (
    <button
      type="button" disabled={disabled} aria-label={ariaLabel}
      className={cx(
        "press w-full inline-flex items-center gap-2 bg-fill-2 hover:bg-fill text-left cursor-pointer disabled:opacity-45 disabled:cursor-default",
        size === "sm" ? "pl-2.5 pr-2 text-[13px]" : "pl-3 pr-2.5 text-[14px]",
        a.open && "bg-surface shadow-[0_0_0_1px_var(--accent),var(--ring)]",
        invalid && "shadow-[0_0_0_1px_var(--bad),0_0_0_4px_rgba(255,59,48,0.16)]", className,
      )}
      style={{ height: H[size], borderRadius: r }}
    >
      {selected?.leading}
      <span className={cx("flex-1 truncate", !selected && "text-muted-2")}>{selected?.label ?? placeholder}</span>
      <ChevronsUpDown size={15} strokeWidth={2} className="text-muted-2 shrink-0" />
    </button>
  );

  const heads = visible.map((o, i) => (o.group && o.group !== visible[i - 1]?.group ? o.group : null));
  return (
    <>
      {withTrigger(trigger, a.f.refs.setReference, (own) => getReferenceProps({
        ...own,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (!a.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); a.setOpen(true); }
        },
      }))}
      {a.open && (
        <FloatingPortal>
          <FloatingFocusManager context={a.f.context} modal={false} initialFocus={search ? 0 : undefined}>
            <div ref={a.f.refs.setFloating} style={{ ...a.f.floatingStyles, zIndex: 85 }} {...getFloatingProps()}>
              <Surface level="block" tone="raised" pad={POPOVER_PAD} className="kit-pop shadow-3 flex flex-col outline-none"
                style={{ width: menuWidth, maxHeight: "inherit", ...originOf(a.f.placement) }}>
                {header && <div className="px-2.5 pt-1.5 pb-2 text-[12px] text-muted leading-snug">{header}</div>}
                {search && (
                  <SearchBox value={query} onChange={setQuery}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && active != null && visible[active]) { e.preventDefault(); pick(visible[active]); }
                    }} />
                )}
                <div className="scroll min-h-0 flex-1" role="presentation">
                  {visible.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">Ничего не найдено</div>}
                  {visible.map((o, i) => {
                    const head = heads[i];
                    return (
                      <div key={o.value}>
                        {head && <div className={cx("px-2.5 pb-1 text-[12px] font-medium text-muted-2", i > 0 ? "pt-3" : "pt-1.5")}>{head}</div>}
                        <OptionRow option={o} selected={o.value === value} active={active === i}
                          {...getItemProps({
                            ref: (el: HTMLElement | null) => { listRef.current[i] = el; },
                            onClick: () => pick(o),
                            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(o); } },
                          })} />
                      </div>
                    );
                  })}
                </div>
              </Surface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function SearchBox({ value, onChange, onKeyDown }: { value: string; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  const r = useInnerRadius();
  return (
    <div className="relative mb-1.5 shrink-0">
      <Search size={15} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none" />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder="Поиск"
        className="w-full h-9 pl-8 pr-3 bg-fill-2 text-[14px] outline-none placeholder:text-muted-2 focus:shadow-none" style={{ borderRadius: r }} />
    </div>
  );
}

function OptionRow({ option: o, selected, active, ...props }: { option: SelectOption; selected: boolean; active: boolean } & Record<string, unknown>) {
  const r = useInnerRadius();
  return (
    <div
      role="option" aria-selected={selected} aria-disabled={o.disabled || undefined} tabIndex={active ? 0 : -1} {...props}
      className={cx("flex items-center gap-2.5 min-h-9 px-2.5 py-1.5 cursor-pointer outline-none select-none",
        active && !o.disabled && "bg-fill-2", o.disabled && "opacity-40 cursor-default")}
      style={{ borderRadius: r }}
    >
      {o.leading}
      <span className="flex-1 min-w-0">
        <span className={cx("block truncate text-[14px]", selected && "font-medium")}>{o.label}</span>
        {o.description && <span className="block truncate text-[12px] text-muted">{o.description}</span>}
      </span>
      <Check size={16} strokeWidth={2.5} className={cx("shrink-0 text-accent-strong", !selected && "invisible")} />
    </div>
  );
}
