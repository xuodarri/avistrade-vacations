/** Общие мелкие элементы экранов. */
import type { ReactNode } from "react";
import { PART_STATUS_LABEL, REQUEST_STATUS_LABEL, type PartStatus, type RequestStatus } from "@/server/db/types";

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4 mb-7">
      <div className="min-w-0">
        <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.032em]">{title}</h1>
        {sub && <div className="text-[15px] text-muted mt-1.5">{sub}</div>}
      </div>
      <div className="ml-auto flex gap-2">{children}</div>
    </div>
  );
}

/** Плашка «здесь будет экран»: убрать, когда экран готов. */
export function StubNote({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 px-5 py-3.5 rounded-[var(--r-block)] bg-fill-3 text-[13px] text-muted">
      {children}
    </div>
  );
}

const PART_CHIP: Record<PartStatus, string> = {
  draft: "chip-muted", pending: "chip-warn", approved: "chip-ok", returned: "chip-info", rejected: "chip-bad",
};
export const PartStatusChip = ({ s }: { s: PartStatus }) => <span className={`chip ${PART_CHIP[s]}`}>{PART_STATUS_LABEL[s]}</span>;

const REQ_CHIP: Record<RequestStatus, string> = { draft: "chip-muted", submitted: "chip-warn", approved: "chip-ok", returned: "chip-info" };
export const RequestStatusChip = ({ s }: { s: RequestStatus | null }) =>
  s ? <span className={`chip ${REQ_CHIP[s]}`}>{REQUEST_STATUS_LABEL[s]}</span> : <span className="chip chip-bad">Не подан</span>;

export function Forbidden() {
  return (
    <div className="card px-8 py-14 text-center">
      <div className="text-[20px] font-semibold tracking-[-0.025em] mb-1.5">Раздел недоступен</div>
      <div className="text-muted text-[14px]">Войдите как руководитель или HR через переключатель пользователя в шапке.</div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" | "info" }) {
  const color = tone ? { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" }[tone] : "text-text";
  return (
    <div className="card px-5 py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`text-[28px] leading-tight font-semibold tracking-[-0.03em] tnum ${color}`}>{value}</div>
    </div>
  );
}
