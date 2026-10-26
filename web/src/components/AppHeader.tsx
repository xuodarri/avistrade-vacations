import Link from "next/link";
import { currentUser } from "@/server/session";
import { NavLinks } from "./NavLinks";
import { HelpButton } from "@/components/tour";
import { NotificationsBell } from "./NotificationsBell";
import { notifications } from "@/server/db/repo";
import { Avatar } from "@/components/kit";
import { DemoPill } from "@/components/demo/DemoPill";

/** Сплошная шапка: знак и название, разделы по правам (пилюли), помощь, уведомления, текущий пользователь и справа с краю — демо-пилюля. */
export async function AppHeader() {
  const u = await currentUser();
  const role = (a: string[]) => (a.includes("hr") ? "HR" : a.includes("manager") ? "Руководитель" : "Сотрудник");

  const nav = [
    { href: "/me", label: "Мой отпуск" },
    ...(u.access.includes("manager") ? [{ href: "/team", label: "Согласование" }] : []),
    ...(u.access.includes("hr")
      ? [
          { href: "/hr", label: "График", exact: true },
          { href: "/hr/dashboard", label: "Сбор графика" },
          { href: "/hr/rules", label: "Правила" },
          { href: "/hr/people", label: "Сотрудники" },
          { href: "/hr/log", label: "Журнал" },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 bg-surface shadow-[0_0.5px_0_var(--color-line-soft),0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="max-w-[1280px] mx-auto px-6 h-[var(--header-h)] flex items-center gap-4 xl:gap-6">
        <Link href="/" aria-label="Авистрейд — Отпуска, на главную" className="flex items-center gap-3 shrink-0 press">
          {/* знак Авистрейда без слова «АВИСТРЕЙД» (public/brand/avistrade-mark.svg) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/avistrade-mark.svg" alt="" width={26} height={26} className="block" />
          <span className="hidden lg:inline text-[16px] font-semibold tracking-[-0.022em]">Отпуска</span>
        </Link>
        <NavLinks items={nav} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <HelpButton access={u.access} />
          <NotificationsBell items={notifications.forEmployee(u.id, 30)} unread={notifications.unreadCount(u.id)} />
          {/* пользователь — только информация: вход под другим человеком живёт в демо-пилюле */}
          <div className="flex items-center gap-2.5 pl-1 pr-1.5 min-w-0">
            <Avatar name={u.fullName} size={32} />
            <span className="hidden xl:block leading-tight max-w-[200px]">
              <span className="block text-[13.5px] font-medium truncate">{u.fullName}</span>
              <span className="block text-[11.5px] text-muted">{role(u.access)}</span>
            </span>
          </div>
          <DemoPill />
        </div>
      </div>
    </header>
  );
}
