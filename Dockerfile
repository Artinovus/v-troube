# Z trouby – produkční obraz (Next.js standalone)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/db ./db
COPY --from=build /app/scripts/migrate.mjs /app/scripts/create-admin.mjs ./scripts/
COPY --from=build /app/src/lib/password.ts ./src/lib/password.ts
USER app
EXPOSE 3000
# Při startu se nejprve spustí čekající migrace.
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
