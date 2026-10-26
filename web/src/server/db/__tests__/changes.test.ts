import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

type Repo = typeof import("../repo");
let repo: Repo;
let tx: <T>(fn: () => T) => T;

beforeAll(async () => {
  process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "vac-")), "test.db");
  repo = await import("../repo");
  tx = (await import("../client")).transaction;
});

const part = (emp: string, year: number, no: number) =>
  repo.parts.forYear(year).find((p) => p.employeeId === emp && p.partNo === no)!;

describe("перенос согласованной части", () => {
  it("демо: поздняя заявка Шевчук ждёт HR, у руководителей заявок нет", () => {
    expect(repo.changes.open("manager")).toEqual([]);
    expect(repo.changes.open("hr").map((c) => c.employeeId)).toEqual(["E08"]);
  });

  it("отказ HR: часть остаётся как была", () => {
    const c = repo.changes.open("hr")[0];
    const before = part("E08", 2026, 2);
    tx(() => repo.changes.reject(c.id, "E19", "Позже чем за 14 дней, замены нет"));
    expect(part("E08", 2026, 2)).toMatchObject({ startDate: before.startDate, endDate: before.endDate });
    expect(repo.changes.get(c.id)?.status).toBe("rejected");
  });

  it("маршрут: заявка → руководитель → HR → даты части меняются, «было» сохранено", () => {
    const p = part("E14", 2027, 1); // 7–20 июня, согласована
    const c = tx(() => repo.changes.create({ partId: p.id, kind: "move", newStart: "2027-07-05", newEnd: "2027-07-18", note: "семейные обстоятельства",
      requestedBy: "E14", requestedOn: "2026-10-27", stage: "manager" }));
    tx(() => repo.changes.managerApprove(c.id, "E09"));
    expect(repo.changes.get(c.id)).toMatchObject({ stage: "hr", managerBy: "E09", status: "open" });
    // до решения HR действуют старые даты
    expect(part("E14", 2027, 1).startDate).toBe("2027-06-07");
    const r = tx(() => repo.changes.approve(c.id, "E19", "ок"));
    expect(r.after.status).toBe("approved");
    expect(part("E14", 2027, 1)).toMatchObject({ startDate: "2027-07-05", endDate: "2027-07-18", days: 14, status: "approved" });
    expect(repo.changes.get(c.id)).toMatchObject({ oldStart: "2027-06-07", oldEnd: "2027-06-20" });
  });

  it("на одну часть — одна открытая заявка; отмена делает часть rejected", () => {
    const p = part("E01", 2027, 1);
    const c = tx(() => repo.changes.create({ partId: p.id, kind: "cancel", newStart: null, newEnd: null, note: "семейное", requestedBy: "E01", requestedOn: "2026-10-26", stage: "hr" }));
    expect(() => tx(() => repo.changes.create({ partId: p.id, kind: "move", newStart: "2027-09-01", newEnd: "2027-09-14", note: "x", requestedBy: "E01", requestedOn: "2026-10-26", stage: "hr" }))).toThrow();
    tx(() => repo.changes.approve(c.id, "E19"));
    expect(part("E01", 2027, 1).status).toBe("rejected");
  });

  it("продление по болезни и отзыв: даты и дни пересчитаны, запись согласована", () => {
    const p = part("E19", 2027, 1); // 16–29 августа
    const ext = tx(() => repo.parts.extend(p.id, "2027-09-02", { by: "E19", on: "2026-10-26", note: "листок нетрудоспособности № 123" }));
    expect(ext.part.after).toMatchObject({ endDate: "2027-09-02", days: 18 });
    expect(ext.change).toMatchObject({ kind: "extend", status: "approved", reason: "illness" });
    const rec = tx(() => repo.parts.recall(p.id, "2027-08-25", { by: "E19", on: "2026-10-26", note: "производственная необходимость, согласие получено" }));
    expect(rec.part.after).toMatchObject({ endDate: "2027-08-24", days: 9 });
  });

  it("обоснование плана сохраняется в заявке", () => {
    const req = repo.requests.forEmployee("E13", 2027)!;
    tx(() => repo.requests.setExceptionNote(req.id, "  Свадьба сестры 15 июня  "));
    expect(repo.requests.forEmployee("E13", 2027)?.exceptionNote).toBe("Свадьба сестры 15 июня");
  });
});

describe("сотрудники: правка, приём, увольнение", () => {
  it("create даёт следующий E## и почту, update и dismiss возвращают было/стало, listActive без уволенных", () => {
    const e = tx(() => repo.employees.create({ fullName: "Тестова Ольга Ивановна", position: "Менеджер по продажам", roleCode: "МПП",
      division: "Оптовое отделение", department: "отдел оптовых продаж", managerId: "E09", hiredOn: "2026-11-01", baseDays: 24 }));
    expect(e).toMatchObject({ id: "E20", email: "e20@avistrade.by", dismissedOn: null, benefit189: null, isHr: false });
    const u = tx(() => repo.employees.update("E20", { position: "Старший менеджер", benefit189: "care", isHr: false }));
    expect(u.before.position).toBe("Менеджер по продажам");
    expect(u.after).toMatchObject({ position: "Старший менеджер", benefit189: "care" });
    tx(() => repo.employees.dismiss("E20", "2026-11-10"));
    expect(repo.employees.listActive("2026-11-20").some((x) => x.id === "E20")).toBe(false);
    expect(repo.employees.listActive("2026-11-05").some((x) => x.id === "E20")).toBe(true);
    expect(repo.employees.list().some((x) => x.id === "E20")).toBe(true);
    tx(() => repo.employees.restore("E20"));
    expect(repo.employees.get("E20")?.dismissedOn).toBeNull();
  });
});

describe("маршрут, график, уведомления", () => {
  it("настройки маршрута: умолчания и запись с было/стало", () => {
    expect(repo.routeSettings.get()).toEqual({ ro1Id: "E19", ro1ReviewerId: "E02", scheduleApproverId: "E01", unionRequired: false, showColleagueNames: true });
    const r = tx(() => repo.routeSettings.set({ unionRequired: true, ro1ReviewerId: "E03" }));
    expect(r.before.unionRequired).toBe(false);
    expect(r.after).toMatchObject({ unionRequired: true, ro1ReviewerId: "E03", ro1Id: "E19" });
    tx(() => repo.routeSettings.set({ unionRequired: false, ro1ReviewerId: "E02" }));
  });
  it("график 2027 — сбор; сохранение возвращает было/стало", () => {
    expect(repo.schedules.get(2027).status).toBe("collecting");
    expect(repo.schedules.get(2030).status).toBe("collecting");
    const r = tx(() => repo.schedules.save({ ...repo.schedules.get(2027), status: "pending", submittedBy: "E19", submittedAt: "2026-12-20T10:00:00Z" }));
    expect(r.before.status).toBe("collecting");
    expect(r.after).toMatchObject({ status: "pending", submittedBy: "E19" });
  });
  it("уведомления: демо, счётчик, добавление без дублей, прочтение", () => {
    expect(repo.notifications.unreadCount("E09")).toBe(1);
    tx(() => repo.notifications.add(["E09", "E09", "E13"], { text: "тест", href: "/team", kind: "request" }));
    expect(repo.notifications.unreadCount("E09")).toBe(2);
    expect(repo.notifications.forEmployee("E13")[0]).toMatchObject({ text: "тест", href: "/team", readAt: null });
    tx(() => repo.notifications.markAllRead("E09"));
    expect(repo.notifications.unreadCount("E09")).toBe(0);
    const n = repo.notifications.forEmployee("E13")[0];
    tx(() => repo.notifications.markRead(n.id, "E09")); // чужое не трогаем
    expect(repo.notifications.forEmployee("E13")[0].readAt).toBeNull();
  });
});

describe("сброс демо-данных", () => {
  it("возвращает базу к сиду: тестовые правки и записи журнала пропадают, заявки на перенос снова открыты", async () => {
    const { resetDatabase } = await import("../client");
    tx(() => repo.audit.insert({ actorId: "E19", action: "test", entity: "x", entityId: null, before: null, after: null }));
    expect(repo.employees.get("E20")).not.toBeNull();
    resetDatabase();
    expect(repo.employees.get("E20")).toBeNull();
    expect(repo.audit.list({ limit: 1000 }).some((a) => a.action === "test")).toBe(false);
    expect(repo.changes.open().map((c) => c.employeeId)).toEqual(["E08"]);
    expect(part("E14", 2027, 1).startDate).toBe("2027-06-07");
    expect(repo.audit.list({ limit: 1000 })).toHaveLength(13);
  });
});
