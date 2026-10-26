/**
 * Оповещения в приложении. Писем не шлём: уведомление видно в колокольчике в шапке.
 * Звать внутри той же transaction(), что и само изменение, — вместе с logAudit.
 *
 *   notify(["E13"], "Романович Г. Ю. согласовал часть 7–20 июня", "/me", "decision")
 */
import "server-only";
import { notifications } from "./db/repo";
import type { NotificationKind } from "./db/types";
import { log } from "./log";

export function notify(employeeIds: (string | null | undefined)[], text: string, href: string | null = null, kind: NotificationKind = "info") {
  const ids = employeeIds.filter((x): x is string => !!x);
  if (!ids.length) return;
  notifications.add(ids, { text, href, kind });
  log.info("notify", { to: ids.length, kind, href });
}
