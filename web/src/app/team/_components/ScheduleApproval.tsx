"use client";

/**
 * Утверждение графика у руководителя организации (ч. 1–2 ст. 168 ТК): карточка на /team и кнопки
 * над Гантом только для чтения. «Утвердить» — с подтверждением, «Вернуть HR» — с комментарием.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarRange, Undo2 } from "lucide-react";
import { Button, Card, Dialog, Field, Pill, Stat, Textarea, toast } from "@/components/kit";
import { approveSchedule, returnSchedule } from "@/server/actions/route";

export interface ScheduleSummary {
  year: number;
  half: 1 | 2;
  halfLabel: string;
  people: number;
  parts: number;
  days: number;
  resolved: number;
  open: number;
  notices: string[];
  submittedBy: string | null;
  submittedAt: string | null;
}

export function ScheduleApprovalCard({ s }: { s: ScheduleSummary }) {
  return (
    <Card pad={24} className="mb-6 flex flex-col gap-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] font-semibold tracking-[-0.025em]">Утверждение графика: {s.halfLabel} {s.year}</h2>
            <Pill tone="warn" dot>На утверждении</Pill>
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            Отправил отдел кадров{s.submittedBy ? `: ${s.submittedBy}` : ""}{s.submittedAt ? `, ${new Date(s.submittedAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Minsk" })}` : ""}.
            После утверждения график доводится до всех работников (ч. 2 ст. 168 ТК).
          </p>
        </div>
        <div className="ml-auto"><ApprovalActions year={s.year} half={s.half} withOpen /></div>
      </div>
      <div className="grid grid-cols-5 gap-4">
        <Stat label="Сотрудников с отпуском" value={s.people} />
        <Stat label="Частей отпуска" value={s.parts} />
        <Stat label="Дней отпуска" value={s.days} />
        <Stat label="Разрешено исключением" value={s.resolved} tone="ok" hint="с причиной в журнале" />
        <Stat label="Открытых конфликтов" value={s.open} tone={s.open ? "bad" : "ok"} hint={s.open ? "РО1 ещё не решил" : "все решены"} />
      </div>
      {s.notices.length > 0 && (
        <div className="text-[13px] text-muted"><span className="text-info font-medium">Регламент и ТК: </span>{s.notices.join(" ")}</div>
      )}
    </Card>
  );
}

/** Кнопки утверждающего: открыть график, утвердить, вернуть HR. */
export function ApprovalActions({ year, half, withOpen }: { year: number; half: 1 | 2; withOpen?: boolean }) {
  const [dialog, setDialog] = useState<"approve" | "return" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<unknown>, title: string) => start(async () => {
    try {
      await fn();
      setDialog(null);
      toast(title, { description: "Запись в журнале, уведомления отправлены" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не получилось сохранить", { tone: "bad" });
    }
  });
  return (
    <div className="flex items-center gap-2">
      {withOpen && <Link href="/team/schedule"><Button icon={CalendarRange}>Открыть график</Button></Link>}
      <Button icon={Undo2} onClick={() => setDialog("return")}>Вернуть HR</Button>
      <Button variant="primary" icon={CalendarCheck} onClick={() => setDialog("approve")}>Утвердить график</Button>

      <Dialog open={dialog === "approve"} onClose={() => setDialog(null)} persistent={busy} title={`Утвердить график: ${half === 1 ? "I" : "II"} полугодие ${year}?`}
        description="После утверждения график доводится до всех работников. Изменить даты можно будет только через заявку на перенос."
        footer={<>
          <Button onClick={() => setDialog(null)}>Отмена</Button>
          <Button variant="primary" icon={CalendarCheck} loading={busy} onClick={() => run(() => approveSchedule({ year, half }), "График утверждён")}>Утвердить</Button>
        </>} />
      <Dialog open={dialog === "return"} onClose={() => setDialog(null)} persistent={busy} title="Вернуть график HR"
        description="Отдел кадров получит уведомление с вашим комментарием."
        footer={<>
          <Button onClick={() => setDialog(null)}>Отмена</Button>
          <Button variant="primary" icon={Undo2} loading={busy} disabled={comment.trim().length < 5}
            onClick={() => run(() => returnSchedule({ year, half, comment }), "График возвращён HR")}>Вернуть</Button>
        </>}>
        <Field label="Комментарий" hint={comment.trim().length < 5 ? "Обязательно" : undefined}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} autoFocus placeholder="Например: в августе без руководства оптового отделения, поправьте" />
        </Field>
      </Dialog>
    </div>
  );
}
