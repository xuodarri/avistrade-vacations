import { describe, expect, it } from "vitest";
import { TOURS, roleOf, toSelector, tourFor } from "./steps";

describe("шаги тура", () => {
  it("у каждого экрана свой тур, якоря внутри тура не повторяются", () => {
    expect(new Set(TOURS.map((t) => t.path)).size).toBe(TOURS.length);
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    for (const id of ["me", "team", "hr"]) expect(TOURS.find((t) => t.id === id)?.steps.at(-1)?.anchor).toBe("demo-pill");
    for (const t of TOURS) {
      expect(t.steps.length).toBeGreaterThan(0);
      expect(new Set(t.steps.map((s) => s.anchor)).size).toBe(t.steps.length);
    }
  });

  it("якорь — «экран.элемент», тексты короткие", () => {
    for (const t of TOURS) for (const s of t.steps) {
      expect(s.anchor).toMatch(/^[a-z]+(\.[a-z-]+|-[a-z]+)$/);
      expect(s.title.length).toBeLessThanOrEqual(40);
      expect(s.text.length).toBeLessThanOrEqual(160);
    }
  });

  it("reveal ссылается на якорь шага раньше себя", () => {
    for (const t of TOURS) t.steps.forEach((s, i) => {
      if (!s.reveal) return;
      const at = t.steps.findIndex((x) => x.anchor === s.reveal);
      if (at >= 0) expect(at).toBeLessThan(i);
    });
  });

  it("экран и роль", () => {
    expect(tourFor("/hr")?.id).toBe("hr");
    expect(tourFor("/hr/rules")?.id).toBe("hr-rules");
    expect(tourFor("/")).toBeUndefined();
    expect(roleOf(["employee"])).toBe("employee");
    expect(roleOf(["employee", "manager"])).toBe("manager");
    expect(roleOf(["employee", "manager", "hr"])).toBe("hr");
    expect(toSelector("me.calendar")).toBe('[data-tour="me.calendar"]');
    expect(toSelector("[data-part]")).toBe("[data-part]");
  });
});
