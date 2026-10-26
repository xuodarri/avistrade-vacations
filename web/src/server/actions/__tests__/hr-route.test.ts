import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// вход в демо — cookie; в тесте пользователь задаётся переменной
let userId = "E19";
vi.mock("@/server/session", async (orig) => {
  const real = await orig<typeof import("@/server/session")>();
  const repo = await import("@/server/db/repo");
  return { ...real, currentUser: async () => { const e = repo.employees.get(userId)!; return { ...e, access: real.accessOf(e) }; } };
});

type Repo = typeof import("../../db/repo");
let repo: Repo;
let hr: typeof import("../hr");
let team: typeof import("../team");

beforeAll(async () => {
  process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "vac-")), "test.db");
  repo = await import("../../db/repo");
  hr = await import("../hr");
  team = await import("../team");
});

const partOf = (emp: string, no: number) => repo.parts.forYear(2027).find((p) => p.employeeId === emp && p.partNo === no)!;

describe("регламент: РО1 проверяет после руководителя", () => {
  it("часть у руководителя: РО1 не согласует и не разрешает исключение", async () => {
    const p = partOf("E16", 1); // Шумская, чистая заявка у Романовича
    userId = "E19";
    const r = await hr.hrApprovePart(p.id);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Ждёт руководителя: Романович Г. Ю.") });
    const x = await hr.hrApproveWithException(p.id, "проверка маршрута");
    expect(x).toEqual({ ok: false, error: expect.stringContaining("Ждёт руководителя") });
    expect(repo.parts.get(p.id)?.status).toBe("pending");
  });

  it("после согласия руководителя РО1 согласует", async () => {
    const p = partOf("E16", 1);
    userId = "E09";
    expect((await team.managerApprove(p.id)).ok).toBe(true);
    userId = "E19";
    const r = await hr.hrApprovePart(p.id);
    expect(r.ok).toBe(true);
    expect(repo.parts.get(p.id)?.status).toBe("approved");
  });

  it("вернуть сотруднику РО1 может и на шаге руководителя", async () => {
    const p = partOf("E16", 2);
    userId = "E19";
    expect((await hr.hrReturnPart(p.id, "сдвиньте на неделю")).ok).toBe(true);
  });

  it("перенос у руководителя: РО1 не согласует, после руководителя — шаг РО1", async () => {
    const p = partOf("E14", 1); // Петров, согласованная часть, руководитель Романович
    const { transaction } = await import("../../db/client");
    const c = transaction(() => repo.changes.create({ partId: p.id, kind: "move", newStart: "2027-07-05", newEnd: "2027-07-18", note: "семья",
      requestedBy: "E14", requestedOn: "2026-10-27", stage: "manager" }));
    userId = "E19";
    expect(await hr.hrApproveChange(c.id)).toEqual({ ok: false, error: expect.stringContaining("Ждёт руководителя") });
    expect(await hr.hrApproveChangeWithException(c.id, "проверка маршрута")).toEqual({ ok: false, error: expect.stringContaining("Ждёт руководителя") });
    transaction(() => repo.changes.managerApprove(c.id, "E09"));
    const r = await hr.hrApproveChange(c.id);
    if (!r.ok) expect(r.error).not.toContain("Ждёт руководителя");
  });
});

describe("контекст движка: /hr и /team считают как /me", () => {
  it("полугодия и итог проверки совпадают с engine.checkPlan", async () => {
    const approvals = await import("../../approvals");
    const engine = await import("../../engine");
    const ctx = approvals.engineContext(2027);
    expect(ctx.settings.halfYears).toEqual(engine.engineContext(2027).settings.halfYears);
    expect(ctx.settings.halfYears?.length).toBeGreaterThan(0);
    for (const e of repo.employees.list()) {
      const list = repo.parts.forYear(2027).filter((p) => p.employeeId === e.id);
      if (!list.length) continue;
      const me = engine.checkPlan(e.id, list, 2027);
      const board = approvals.checkInContext(ctx, e.id)!;
      expect({ id: e.id, needsException: board.summary.needsException, canSubmit: board.summary.canSubmit })
        .toEqual({ id: e.id, needsException: me.needsException, canSubmit: me.canSubmit });
    }
  });

  it("график II полугодия утверждён: срок полугодия видят и /me, и /hr (раньше /hr его не видел)", async () => {
    const approvals = await import("../../approvals");
    const engine = await import("../../engine");
    const { DEFAULT_SETTINGS } = await import("@/domain");
    const s = repo.schedules.get(2027, 2);
    repo.schedules.save({ ...s, status: "approved", decidedBy: "E01", decidedAt: "2026-10-20T10:00:00Z" });
    const ctx = approvals.engineContext(2027);
    const without = { ...ctx, settings: { ...DEFAULT_SETTINGS, year: 2027 } }; // как было: без settings.halfYears
    let caught = 0;
    for (const e of repo.employees.list()) {
      const list = repo.parts.forYear(2027).filter((p) => p.employeeId === e.id);
      if (!list.length) continue;
      const me = engine.checkPlan(e.id, list, 2027);
      const board = approvals.checkInContext(ctx, e.id)!;
      expect({ id: e.id, needsException: board.summary.needsException }).toEqual({ id: e.id, needsException: me.needsException });
      const has = (r: typeof board) => r.results.some((x) => x.status !== "ok" && x.status !== "off" && /уже утверждён/.test(x.message));
      if (has(board) && !has(approvals.checkInContext(without, e.id)!)) caught++;
    }
    expect(caught).toBeGreaterThan(0);
    repo.schedules.save(s);
  });
});
