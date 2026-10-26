"use server";

/**
 * Экран правил HR: правила регламента, лимиты групп и зависимости ролей. HR правит черновик,
 * `previewRules` пересчитывает конфликты графика с черновиком, `saveRules` сохраняет разницу —
 * каждое изменение отдельной строкой журнала с «было / стало». Нормы ТК с экрана не меняются.
 * Там же настройка приватности: видят ли сотрудники имена коллег (`getPrivacy` читает её для /me),
 * и маршрут согласования: РО1, кто проверяет его отпуск, кто утверждает график, профсоюз.
 */
import { revalidatePath } from "next/cache";
import { employees, roles, routeSettings, rules, settings } from "../db/repo";
import { transaction } from "../db/client";
import type { LimitGroup, RoleDependency, RouteSettings, Rule, Scope, Severity } from "../db/types";
import { checkDiff, checkSummary, type CheckDiff } from "../hrCheck";
import { logAudit } from "../audit";
import { requireAccess } from "../session";
import { MAIN_SEVERITIES, PARAM_META, SCOPES, SEVERITIES } from "@/components/hr-admin/meta";

/** Черновик экрана: правила, группы и зависимости целиком. У новой зависимости нет id. */
export interface RulesDraft {
  rules: Pick<Rule, "code" | "enabled" | "severity" | "params">[];
  groups: Pick<LimitGroup, "id" | "maxConcurrent" | "scope">[];
  dependencies: (Omit<RoleDependency, "id"> & { id?: number })[];
  privacy: Privacy;
  route: Route;
}

/** Маршрут согласования без приватности (она отдельным блоком). */
export type Route = Pick<RouteSettings, "ro1Id" | "ro1ReviewerId" | "scheduleApproverId" | "unionRequired">;
const routeOf = (r: Route): Route => ({ ro1Id: r.ro1Id, ro1ReviewerId: r.ro1ReviewerId, scheduleApproverId: r.scheduleApproverId, unionRequired: r.unionRequired });

export interface Privacy {
  /** Сотрудник видит, кто из его группы и кого он замещает в отпуске в выбранные даты */
  showColleagueNames: boolean;
}

const SHOW_NAMES_KEY = "show_colleague_names";
/** Нет записи — включено: утверждённый график по ч. 2 ст. 168 ТК и так доводится до всех. */
const readPrivacy = (): Privacy => ({ showColleagueNames: settings.get(SHOW_NAMES_KEY) !== "0" });

export type { CheckSummary, ConflictItem } from "../hrCheck";
export type RulesPreview = CheckDiff;

/* ---------------- проверка с черновиком ---------------- */

function override(draft: RulesDraft) {
  return {
    rules: mergeRules(rules.list(), draft.rules),
    groups: mergeGroups(roles.groups(), draft.groups),
    dependencies: draft.dependencies.map((d, i) => ({ ...d, id: d.id ?? -1 - i })),
  };
}

const check = () => checkSummary();

/* ---------------- проверка черновика на допустимость ---------------- */

function mergeRules(current: Rule[], draft: RulesDraft["rules"]): Rule[] {
  return current.map((r) => {
    const d = draft.find((x) => x.code === r.code);
    if (!d || r.source === "ТК") return r; // нормы ТК с экрана не меняются
    return { ...r, enabled: !!d.enabled, severity: d.severity, params: d.params };
  });
}

function mergeGroups(current: LimitGroup[], draft: RulesDraft["groups"]): LimitGroup[] {
  return current.map((g) => {
    const d = draft.find((x) => x.id === g.id);
    return d ? { ...g, maxConcurrent: d.maxConcurrent, scope: d.scope } : g;
  });
}

function validate(draft: RulesDraft) {
  const sev = (s: unknown): s is Severity => SEVERITIES.includes(s as Severity);
  for (const r of draft.rules) {
    if (!sev(r.severity)) throw new Error(`${r.code}: неизвестная жёсткость`);
    if (MAIN_SEVERITIES[r.code] && !MAIN_SEVERITIES[r.code].includes(r.severity)) throw new Error(`${r.code}: строгость — запрет или предупреждение`);
    for (const s of Object.values(r.params.stages ?? {})) if (!sev(s)) throw new Error(`${r.code}: неизвестная жёсткость`);
    const meta = PARAM_META[r.code];
    const v = r.params.value;
    if (meta && (typeof v !== "number" || !Number.isInteger(v) || v < meta.min || v > meta.max))
      throw new Error(`${r.code}: параметр от ${meta.min} до ${meta.max}`);
  }
  for (const g of draft.groups) {
    if (!Number.isInteger(g.maxConcurrent) || g.maxConcurrent < 1 || g.maxConcurrent > 20) throw new Error("Лимит группы — от 1 до 20");
    if (!SCOPES.includes(g.scope)) throw new Error("Неизвестный круг группы");
  }
  if (draft.route) {
    const working = new Set(employees.listActive().map((e) => e.id));
    for (const id of [draft.route.ro1Id, draft.route.ro1ReviewerId, draft.route.scheduleApproverId])
      if (!working.has(id)) throw new Error("В маршруте — сотрудник, которого нет среди работающих");
    if (draft.route.ro1Id === draft.route.ro1ReviewerId) throw new Error("Отпуск РО1 проверяет другой человек, не сам РО1");
    if (draft.route.scheduleApproverId === draft.route.ro1Id) throw new Error("График утверждает не РО1: он его составляет");
  }
  const roleCodes = new Set(roles.list().map((r) => r.code));
  const seen = new Set<string>();
  for (const d of draft.dependencies) {
    if (!roleCodes.has(d.roleCode) || !roleCodes.has(d.requiresRole)) throw new Error("Неизвестная роль в зависимости");
    if (d.roleCode === d.requiresRole) throw new Error("Роль не может зависеть от самой себя");
    if (!SCOPES.includes(d.scope as Scope)) throw new Error("Неизвестный круг зависимости");
    const k = `${d.roleCode}>${d.requiresRole}`;
    if (seen.has(k)) throw new Error("Такая зависимость уже есть");
    seen.add(k);
  }
}

/* ---------------- серверные функции ---------------- */

/** Настройка приватности для экранов сотрудника. Читать может любой вошедший. */
export async function getPrivacy(): Promise<Privacy> {
  return readPrivacy();
}

/** Данные экрана: правила, группы, зависимости, роли, приватность и текущая проверка графика. */
export async function getRulesScreen() {
  await requireAccess("hr");
  return {
    rules: rules.list(), groups: roles.groups(), dependencies: roles.dependencies(), roles: roles.list(),
    privacy: readPrivacy(), route: routeOf(routeSettings.get()), summary: check(),
    people: employees.listActive().map((e) => ({ id: e.id, fullName: e.fullName, position: e.position })),
  };
}

/** Что станет с конфликтами графика, если сохранить черновик. Ничего не пишет. */
export async function previewRules(draft: RulesDraft): Promise<RulesPreview> {
  await requireAccess("hr");
  validate(draft);
  return checkDiff(override(draft));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Сохранить черновик: только то, что изменилось, каждое изменение — строка журнала. */
export async function saveRules(draft: RulesDraft) {
  const u = await requireAccess("hr");
  validate(draft);
  const changed = transaction(() => {
    let n = 0;
    for (const cur of rules.list()) {
      const d = draft.rules.find((x) => x.code === cur.code);
      if (!d || cur.source === "ТК") continue;
      // severity — жёсткость при сборке графика; держим params.stages.collect в согласии с ней
      const params = { ...d.params, stages: { ...d.params.stages, collect: d.severity } };
      const patch = { enabled: !!d.enabled, severity: d.severity, params };
      if (same({ enabled: cur.enabled, severity: cur.severity, params: cur.params }, patch)) continue;
      const { before, after } = rules.update(cur.code, patch);
      logAudit({ actorId: u.id, action: "update", entity: "rule", entityId: cur.code, before, after });
      n++;
    }
    for (const cur of roles.groups()) {
      const d = draft.groups.find((x) => x.id === cur.id);
      if (!d || (d.maxConcurrent === cur.maxConcurrent && d.scope === cur.scope)) continue;
      const { before, after } = roles.updateGroup(cur.id, { maxConcurrent: d.maxConcurrent, scope: d.scope });
      logAudit({ actorId: u.id, action: "update", entity: "group", entityId: cur.id, before, after });
      n++;
    }
    const current = roles.dependencies();
    for (const cur of current) {
      const d = draft.dependencies.find((x) => x.id === cur.id);
      if (!d) {
        const removed = roles.removeDependency(cur.id);
        logAudit({ actorId: u.id, action: "delete", entity: "dependency", entityId: cur.id, before: removed ?? cur });
        n++;
      } else if (d.scope !== cur.scope) {
        const { before, after } = roles.updateDependency(cur.id, { scope: d.scope });
        logAudit({ actorId: u.id, action: "update", entity: "dependency", entityId: cur.id, before, after });
        n++;
      }
    }
    for (const d of draft.dependencies.filter((x) => x.id == null)) {
      const added = roles.addDependency({ roleCode: d.roleCode, requiresRole: d.requiresRole, scope: d.scope, regClause: d.regClause || "кто без кого не уходит" });
      logAudit({ actorId: u.id, action: "create", entity: "dependency", entityId: added.id, after: added });
      n++;
    }
    const route = routeOf(routeSettings.get());
    if (draft.route && JSON.stringify(routeOf(draft.route)) !== JSON.stringify(route)) {
      const r = routeSettings.set(routeOf(draft.route));
      logAudit({ actorId: u.id, action: "route_update", entity: "settings", entityId: "route", before: routeOf(r.before), after: routeOf(r.after) });
      n++;
    }
    const privacy = readPrivacy();
    if (draft.privacy && !!draft.privacy.showColleagueNames !== privacy.showColleagueNames) {
      const after = { showColleagueNames: !!draft.privacy.showColleagueNames };
      settings.set(SHOW_NAMES_KEY, after.showColleagueNames ? "1" : "0");
      logAudit({ actorId: u.id, action: "update", entity: "setting", entityId: SHOW_NAMES_KEY, before: privacy, after });
      n++;
    }
    return n;
  });
  revalidatePath("/hr", "layout");
  revalidatePath("/me", "layout");
  return {
    changed, summary: check(), rules: rules.list(), groups: roles.groups(), dependencies: roles.dependencies(),
    privacy: readPrivacy(), route: routeOf(routeSettings.get()),
  };
}
