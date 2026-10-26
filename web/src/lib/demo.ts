/**
 * Демо-сборка: демо-пилюля, «Войти как…», сброс данных. Включена, если NEXT_PUBLIC_DEMO=1,
 * а в dev — по умолчанию (выключить: NEXT_PUBLIC_DEMO=0). При внедрении их не будет.
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1"
  || (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO !== "0");
