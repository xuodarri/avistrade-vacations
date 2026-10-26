/** Склейка классов: пропускает false / null / undefined. */
export function cx(...parts: (string | false | null | undefined | 0)[]) {
  return parts.filter(Boolean).join(" ");
}
