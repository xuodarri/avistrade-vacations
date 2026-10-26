"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Briefcase, Check, ChevronRight, Crown, FlaskConical, HeartHandshake, RotateCcw, Search, ShieldCheck, User, UserX, type LucideIcon } from "lucide-react";
import { Avatar, Button, Dialog, Popover, SegmentedControl, Spinner, cx, toast } from "@/components/kit";
import { loginAs } from "@/server/actions/session";
import { resetDemoData } from "@/server/actions/demo";

export interface Persona {
  key: "employee" | "manager" | "hr" | "director" | "benefit" | "substitute";
  id: string;
  title: string;
  name: string;
  short: string;
  position: string;
  desc: string;
  home: string;
}

export interface DemoPerson { id: string; name: string; position: string; group: string }

const ICON: Record<Persona["key"], LucideIcon> = {
  employee: User, manager: Briefcase, hr: ShieldCheck, director: Crown, benefit: HeartHandshake, substitute: UserX,
};

const fmtDay = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Пилюля «Демо: …» в шапке, справа с краю. Поповер вниз: «Режим» — готовые персонажи (Alt+1…6),
 * «Любой сотрудник» — вход под кем угодно вместо корпоративной авторизации, «Данные» — сброс демо.
 */
export function DemoPillClient({ personas, people, currentId, currentName, fixedToday }: {
  personas: Persona[]; people: DemoPerson[]; currentId: string; currentName: string; fixedToday: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"mode" | "people" | "data">("mode");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [resetting, setResetting] = useState(false);
  const router = useRouter();
  const current = personas.find((p) => p.id === currentId);
  const label = current ? current.title : currentName;

  const loginTo = (id: string, short: string, desc: string, home?: string) => {
    setOpen(false);
    toast(`Вы вошли как ${short}`, { description: desc, tone: "info" });
    start(async () => { await loginAs(id, home); });
  };
  const choose = (p: Persona) => loginTo(p.id, p.short, `${p.title}: ${p.position}`, p.home);

  // Alt+1…6 — быстрое переключение режимов
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const i = Number(e.code.replace("Digit", "")) - 1;
      if (Number.isInteger(i) && personas[i]) { e.preventDefault(); choose(personas[i]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reset = async () => {
    setResetting(true);
    try {
      await resetDemoData();
      setConfirm(false);
      setOpen(false);
      toast("Демо-данные сброшены", { description: "База вернулась к чистому сиду, журнал — только история демо" });
      router.refresh();
    } catch (e) {
      toast("Не удалось сбросить", { tone: "bad", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setResetting(false);
    }
  };

  const q = query.trim().toLowerCase();
  const found = q ? people.filter((p) => `${p.name} ${p.position}`.toLowerCase().includes(q)) : people;
  const groups = [...new Set(found.map((p) => p.group))];

  return (
    <>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }} placement="bottom-end" width={380} pad={10}
        content={
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 px-1.5 pt-0.5">
              <FlaskConical size={16} className="text-accent-strong" />
              <span className="text-[13px] font-semibold">Демо-режим</span>
              <span className="ml-auto text-[11.5px] text-muted-2">не будет в рабочей версии</span>
            </div>
            <Link href="/about" onClick={() => setOpen(false)}
              className="press flex items-center gap-3 px-2.5 py-2 rounded-[12px] bg-fill-2 hover:bg-fill text-left">
              <span className="w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 bg-surface text-accent-strong">
                <BookOpen size={18} strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold tracking-[-0.01em]">О решении</span>
                <span className="block text-[12px] text-muted-2 truncate">что умеет прототип и как он устроен</span>
              </span>
              <ChevronRight size={16} className="text-muted-2 shrink-0" />
            </Link>
            <SegmentedControl block size="sm" value={tab} onChange={setTab}
              options={[{ value: "mode", label: "Режим" }, { value: "people", label: "Любой сотрудник" }, { value: "data", label: "Данные" }]} />
            {tab === "mode" && (
              <div className="flex flex-col gap-0.5">
                {personas.map((p, i) => {
                  const Icon = ICON[p.key];
                  const active = p.id === currentId;
                  return (
                    <button key={p.key} type="button" disabled={pending} onClick={() => choose(p)}
                      className={cx("press w-full flex items-center gap-3 px-2.5 py-2 rounded-[12px] text-left cursor-pointer disabled:opacity-60",
                        active ? "bg-accent-bg" : "hover:bg-fill-2")}>
                      <span className={cx("w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0", active ? "bg-accent-strong text-white" : "bg-fill-2 text-text-2")}>
                        <Icon size={18} strokeWidth={2} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className="text-[14px] font-semibold tracking-[-0.01em] whitespace-nowrap">{p.title}</span>
                          <span className="text-[12.5px] text-muted truncate">{p.short}</span>
                        </span>
                        <span className="block text-[12px] text-muted-2 truncate">{p.desc}</span>
                      </span>
                      {active ? <Check size={16} className="text-accent-strong shrink-0" />
                        : <kbd className="shrink-0 text-[11px] text-muted-2 font-sans tnum px-1.5 h-5 inline-flex items-center rounded-[6px] bg-fill-2">Alt+{i + 1}</kbd>}
                    </button>
                  );
                })}
              </div>
            )}
            {tab === "people" && (
              <div className="flex flex-col gap-1.5">
                <p className="px-1.5 text-[12px] text-muted leading-snug">
                  Вместо корпоративной авторизации. В рабочей версии пользователь определяется по учётной записи компании (AD / SSO).
                </p>
                <div className="relative">
                  <Search size={15} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none" />
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фамилия или должность"
                    className="w-full h-9 pl-8 pr-3 bg-fill-2 rounded-[12px] text-[14px] outline-none placeholder:text-muted-2" />
                </div>
                <div className="flex flex-col max-h-[340px] overflow-y-auto scroll">
                  {groups.map((g) => (
                    <div key={g}>
                      <div className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-muted-2">{g}</div>
                      {found.filter((p) => p.group === g).map((p) => {
                        const active = p.id === currentId;
                        return (
                          <button key={p.id} type="button" disabled={pending}
                            onClick={() => (active ? setOpen(false) : loginTo(p.id, p.name, p.position))}
                            className={cx("press w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[12px] text-left cursor-pointer disabled:opacity-60",
                              active ? "bg-accent-bg" : "hover:bg-fill-2")}>
                            <Avatar name={p.name} size={28} />
                            <span className="flex-1 min-w-0 leading-tight">
                              <span className="block text-[13.5px] font-medium truncate">{p.name}</span>
                              <span className="block text-[12px] text-muted truncate">{p.position}</span>
                            </span>
                            {active && <Check size={16} className="text-accent-strong shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {!found.length && <div className="px-2.5 py-6 text-center text-[13px] text-muted">Никого не нашли</div>}
                </div>
              </div>
            )}
            {tab === "data" && (
              <div className="flex flex-col gap-3 px-1.5 pb-1">
                <p className="text-[13px] text-text-2 leading-snug">
                  Вернуть базу к чистым демо-данным: планы, заявки на перенос, исключения и журнал — как в начале демо.
                  Нужно перед записью видео.
                </p>
                <Button variant="destructive" icon={RotateCcw} onClick={() => setConfirm(true)}>Сбросить демо-данные</Button>
                <div className="text-[12px] text-muted">
                  {fixedToday ? <>Демо-дата: <span className="tnum text-text-2">{fmtDay(fixedToday)}</span> (DEMO_TODAY)</> : "Дата проверок — сегодняшняя по Минску"}
                </div>
              </div>
            )}
          </div>
        }>
        <button type="button" data-tour="demo-pill" aria-label={`Демо-режим: ${label}. Сменить роль или сбросить данные`}
          className={cx("press h-9 pl-2.5 pr-3.5 rounded-full inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-[filter]",
            "bg-accent-bg text-accent-strong hover:brightness-[0.97]", open && "brightness-[0.94]")}>
          {pending ? <Spinner size={15} /> : <FlaskConical size={15} strokeWidth={2.2} />}
          <span className="text-[13px] font-semibold whitespace-nowrap max-w-[160px] truncate">
            <span className="hidden sm:inline font-medium opacity-75">Демо: </span>{label}
          </span>
        </button>
      </Popover>
      <Dialog open={confirm} onClose={() => !resetting && setConfirm(false)} persistent={resetting}
        title="Сбросить демо-данные?" description="Все изменения — правки планов, решения, исключения, записи журнала — пропадут. Базу заполнит демо-сид."
        footer={<>
          <Button onClick={() => setConfirm(false)} disabled={resetting}>Отмена</Button>
          <Button variant="destructive" loading={resetting} icon={RotateCcw} onClick={reset}>Сбросить</Button>
        </>} />
    </>
  );
}
