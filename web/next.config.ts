import type { NextConfig } from "next";

// cacheComponents выключен: страницы читают cookie демо-входа и базу на каждый запрос.
const nextConfig: NextConfig = {
  // для Docker (Railway): .next/standalone с server.js и только нужными node_modules
  output: "standalone",
  // Демо-вход хранится в cookie на хосте. Разные хосты (localhost, 127.0.0.1, me.localhost…) — разные
  // cookie, так параллельные вкладки и тесты не перелогинивают друг друга. Next в dev пускает их только из списка.
  allowedDevOrigins: ["127.0.0.1", "*.localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
