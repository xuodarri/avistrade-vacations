"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cx } from "./cx";

export type ToastTone = "ok" | "warn" | "bad" | "info";
interface ToastItem { id: number; title: ReactNode; description?: ReactNode; tone: ToastTone; action?: { label: string; onClick: () => void }; duration: number }

type Listener = () => void;
const EMPTY: ToastItem[] = [];
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export interface ToastOptions { description?: ReactNode; tone?: ToastTone; action?: { label: string; onClick: () => void }; duration?: number }

/** Показать уведомление снизу по центру. Вызывать откуда угодно на клиенте; нужен один ToastProvider в layout. */
export function toast(title: ReactNode, opts: ToastOptions = {}) {
  const t: ToastItem = { id: ++seq, title, tone: opts.tone ?? "ok", description: opts.description, action: opts.action, duration: opts.duration ?? 4000 };
  items = [...items.slice(-3), t];
  emit();
  return t.id;
}
toast.dismiss = (id: number) => { items = items.filter((t) => t.id !== id); emit(); };

const ICON = { ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert, info: Info };
const COLOR = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" };

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const noop = () => () => {};

export function ToastProvider() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div aria-live="polite" className="fixed bottom-5 z-[90] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none w-[min(440px,calc(100vw-32px))]">
      {list.map((t) => <ToastView key={t.id} t={t} />)}
    </div>,
    document.body,
  );
}

function ToastView({ t }: { t: ToastItem }) {
  useEffect(() => {
    if (!t.duration) return;
    const id = setTimeout(() => toast.dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t]);
  const Icon = ICON[t.tone];
  return (
    <div role="status" className="kit-toast pointer-events-auto w-full flex items-start gap-3 rounded-[22px] glass shadow-3 pl-4 pr-2 py-3">
      <Icon size={20} strokeWidth={2} className={cx("shrink-0 mt-px", COLOR[t.tone])} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium leading-snug">{t.title}</div>
        {t.description && <div className="text-[13px] text-muted mt-0.5 leading-snug">{t.description}</div>}
      </div>
      {t.action && (
        <button type="button" onClick={() => { t.action!.onClick(); toast.dismiss(t.id); }}
          className="press shrink-0 h-7 px-3 rounded-full text-[13px] font-medium text-accent-strong hover:bg-accent-bg cursor-pointer">{t.action.label}</button>
      )}
      <button type="button" aria-label="Закрыть" onClick={() => toast.dismiss(t.id)}
        className="press shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center text-muted-2 hover:bg-fill-2 cursor-pointer"><X size={15} /></button>
    </div>
  );
}
