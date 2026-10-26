"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CalendarCheck, CircleCheck, Clock, Inbox, Info, type LucideIcon } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, Popover, cx } from "@/components/kit";
import { markAllNotificationsRead, markNotificationRead } from "@/server/actions/route";
import type { AppNotification, NotificationKind } from "@/server/db/types";

const ICON: Record<NotificationKind, LucideIcon> = { info: Info, request: Inbox, decision: CircleCheck, reminder: Clock, schedule: CalendarCheck };

function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Minsk" });
}

/** Колокольчик в шапке: непрочитанные — бейджем, список — в поповере. Писем не шлём, только в приложении. */
export function NotificationsBell({ items, unread }: { items: AppNotification[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const go = (n: AppNotification) => {
    setOpen(false);
    start(async () => {
      if (!n.readAt) await markNotificationRead(n.id);
      if (n.href) router.push(n.href); else router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end" width={380} pad={8}
      content={
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-2">
            <span className="text-[15px] font-semibold tracking-[-0.015em]">Уведомления</span>
            {unread > 0 && <Badge>{unread}</Badge>}
            <Button size="sm" variant="ghost" className="ml-auto" disabled={!unread || pending}
              onClick={() => start(async () => { await markAllNotificationsRead(); router.refresh(); })}>
              Отметить всё прочитанным
            </Button>
          </div>
          {items.length === 0 ? (
            <EmptyState icon={BellOff} title="Уведомлений нет" description="Здесь появятся решения по заявкам и новости графика" className="py-6" />
          ) : (
            <div className="flex flex-col gap-0.5 max-h-[420px] scroll">
              {items.map((n) => {
                const Icon = ICON[n.kind] ?? Info;
                return (
                  <button key={n.id} type="button" onClick={() => go(n)}
                    className={cx("press w-full flex items-start gap-3 px-2.5 py-2 rounded-[12px] text-left cursor-pointer hover:bg-fill-2", !n.readAt && "bg-accent-bg/60")}>
                    <span className={cx("mt-0.5 w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0", n.readAt ? "bg-fill-2 text-muted" : "bg-accent-strong text-white")}>
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={cx("block text-[13.5px] leading-snug", n.readAt ? "text-text-2" : "text-text font-medium")}>{n.text}</span>
                      <span className="block text-[11.5px] text-muted-2 mt-0.5">{ago(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-2 w-2 h-2 rounded-full bg-accent shrink-0" aria-label="не прочитано" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      }>
      <span className="relative inline-flex" data-tour="notifications">
        <IconButton icon={Bell} label={unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"} variant="ghost" noTooltip />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 pointer-events-none">
            <Badge tone="bad" className="!min-w-[18px] !h-[18px] !px-1 !text-[10.5px] ring-2 ring-[var(--bg)]">{unread > 9 ? "9+" : unread}</Badge>
          </span>
        )}
      </span>
    </Popover>
  );
}
