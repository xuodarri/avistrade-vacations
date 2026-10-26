import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// alias @/ — как в tsconfig, чтобы тесты могли импортировать сид и серверный код
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
