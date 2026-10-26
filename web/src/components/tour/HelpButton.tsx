"use client";

/**
 * «Помощь» в шапке: запускает тур текущего экрана. На экранах без тура кнопки нет.
 * При первом заходе на /me рядом — пилюля «Как пользоваться?»; сам тур без спроса не запускается.
 * Тур пройден или закрыт — запоминается в localStorage для пары «экран + роль».
 */
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CircleHelp, X } from "lucide-react";
import { Button, IconButton } from "@/components/kit";
import { roleOf, tourFor } from "./steps";
import { doneKey, useStored, writeStored } from "./storage";
import { TourRunner } from "./Tour";

/** Экраны, где новичку показываем пилюлю «Как пользоваться?». */
const HINT_ON = new Set(["me"]);

export function HelpButton({ access }: { access?: readonly string[] }) {
  const path = usePathname();
  const tour = tourFor(path);
  const role = roleOf(access);
  const key = tour ? doneKey(tour.id, role) : null;
  const done = useStored(key);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  if (!tour || !key) return null;

  const open = openAt === path; // переход на другой экран тур закрывает
  const hint = HINT_ON.has(tour.id) && done === null && !open;
  const start = () => setOpenAt(path);
  const close = () => {
    writeStored(key, "done");
    setOpenAt(null);
    btn.current?.focus({ preventScroll: true });
  };

  return (
    <div className="flex items-center gap-1">
      {hint && (
        <div className="kit-fade flex items-center gap-0.5">
          <Button size="sm" pill variant="tinted" onClick={start}>Как пользоваться?</Button>
          <IconButton icon={X} size="sm" label="Скрыть подсказку" onClick={() => writeStored(key, "skipped")} />
        </div>
      )}
      <IconButton ref={btn} icon={CircleHelp} label="Помощь: как пользоваться экраном" aria-haspopup="dialog" aria-expanded={open} onClick={start} />
      {open && <TourRunner key={path} tour={tour} onClose={close} />}
    </div>
  );
}
