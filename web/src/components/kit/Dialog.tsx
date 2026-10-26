"use client";
/* eslint-disable react-hooks/refs -- @floating-ui/react отдаёт колбэк-рефы (refs.setReference/setFloating)
   и списки для навигации через ref; это штатный способ библиотеки, во время рендера refs не читаются. */

import { useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { FloatingFocusManager, FloatingOverlay, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import { X } from "lucide-react";
import { cx } from "./cx";
import { Surface } from "./Surface";
import { IconButton } from "./Button";

interface ModalBase {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Кнопки внизу: концентричны окну (радиус окна − отступ). */
  footer?: ReactNode;
  /** Не закрывать по клику на фон (например, пока идёт сохранение). */
  persistent?: boolean;
}

/**
 * Блокировка прокрутки страницы, пока открыто окно: overflow hidden на html. Место под полосу держит
 * scrollbar-gutter: stable (globals.css), поэтому padding-right не нужен и ширина страницы не меняется.
 * Счётчик — на случай двух окон сразу.
 */
let locks = 0;
const lockListeners = new Set<() => void>();
const emitLocks = () => lockListeners.forEach((l) => l());
function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    if (locks++ === 0) html.style.overflow = "hidden";
    emitLocks();
    return () => { if (--locks === 0) html.style.overflow = ""; emitLocks(); };
  }, [open]);
}

/** Открыто ли сейчас какое-нибудь окно kit (Dialog / Sheet) — например, чтобы спрятать плавающие элементы. */
export function useModalOpen() {
  return useSyncExternalStore(
    (l) => { lockListeners.add(l); return () => { lockListeners.delete(l); }; },
    () => locks > 0, () => false,
  );
}

function useModal(open: boolean, onClose: () => void, persistent?: boolean) {
  useScrollLock(open);
  const f = useFloating({ open, onOpenChange: (o) => { if (!o) onClose(); } });
  const dismiss = useDismiss(f.context, { outsidePress: !persistent, outsidePressEvent: "mousedown" });
  const role = useRole(f.context, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);
  return { f, getFloatingProps };
}

const OVERLAY = "kit-fade bg-[rgba(20,20,24,0.28)] backdrop-blur-[6px]";

function Head({ title, description, onClose, id }: { title?: ReactNode; description?: ReactNode; onClose: () => void; id: string }) {
  return (
    <div className="flex items-start gap-3 px-2 pt-2">
      <div className="flex-1 min-w-0">
        {title && <h2 id={id} className="text-[20px] font-semibold tracking-[-0.025em] leading-tight">{title}</h2>}
        {description && <p className="text-[14px] text-muted mt-1">{description}</p>}
      </div>
      <IconButton icon={X} label="Закрыть" variant="secondary" size="sm" onClick={onClose} className="-mt-0.5 -mr-0.5" />
    </div>
  );
}

/** Модальное окно по центру: затемнение с размытием, фокус внутри, Esc закрывает. */
export function Dialog({ open, onClose, title, description, children, footer, persistent, width = 480 }: ModalBase & { width?: number }) {
  const { f, getFloatingProps } = useModal(open, onClose, persistent);
  const id = useId();
  if (!open) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay className={cx(OVERLAY, "z-[80] grid place-items-center p-4")}>
        <FloatingFocusManager context={f.context}>
          <div ref={f.refs.setFloating} aria-labelledby={title ? id : undefined} {...getFloatingProps()} className="outline-none w-full" style={{ maxWidth: width }}>
            <Surface level="panel" pad={16} className="kit-dialog shadow-3 flex flex-col gap-4 max-h-[85vh]">
              <Head title={title} description={description} onClose={onClose} id={id} />
              {children && <div className="scroll px-2 min-h-0">{children}</div>}
              {footer && <div className="flex justify-end gap-2 pt-1">{footer}</div>}
            </Surface>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}

/** Боковая панель справа (разбор заявки, детали): остров с отступом от края, концентричный окну. */
export function Sheet({ open, onClose, title, description, children, footer, persistent, width = 440 }: ModalBase & { width?: number }) {
  const { f, getFloatingProps } = useModal(open, onClose, persistent);
  const id = useId();
  if (!open) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay className={cx(OVERLAY, "z-[80] flex justify-end p-2")}>
        <FloatingFocusManager context={f.context}>
          <div ref={f.refs.setFloating} aria-labelledby={title ? id : undefined} {...getFloatingProps()} className="outline-none h-full w-full" style={{ maxWidth: width }}>
            <Surface level="panel" pad={16} className="kit-sheet shadow-3 h-full flex flex-col gap-4">
              <Head title={title} description={description} onClose={onClose} id={id} />
              <div className="scroll px-2 flex-1 min-h-0">{children}</div>
              {footer && <div className="flex gap-2">{footer}</div>}
            </Surface>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
