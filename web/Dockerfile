# Прототип «Отпуска» для Railway: Next.js standalone на Node 24, база SQLite (node:sqlite) на volume /data.
# Нативных модулей нет — node:sqlite встроен в Node, поэтому образ собирается без компилятора.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci падает: lock собран на Windows, а у @tailwindcss/oxide-wasm32-wasi под Linux есть вложенные
# @emnapi/*, которых npm в lock не пишет. npm install берёт версии из lock и доставляет недостающие.
RUN npm install --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* вшиваются в клиентский код при сборке
ARG NEXT_PUBLIC_DEMO=1
ENV NEXT_PUBLIC_DEMO=$NEXT_PUBLIC_DEMO
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/vacations.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
# база создаётся и заливается сидом при первом запросе, если файла на volume ещё нет
CMD ["node", "server.js"]
