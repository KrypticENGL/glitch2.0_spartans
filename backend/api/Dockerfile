# syntax=docker/dockerfile:1
# Build context is backend/ (docker build -f api/Dockerfile .), so the API can ship database/ migrations and the demo scenario.

FROM node:22-alpine AS build
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/tsconfig.json api/tsconfig.build.json ./
COPY api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0
WORKDIR /app/api
COPY --from=build /app/api/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
COPY api/scripts ./scripts
# scripts/db.mjs reads ../../database; the demo seeder reads ../simulation-data/demo-scenario.json
COPY database /app/database
COPY simulation-data/demo-scenario.json /app/simulation-data/demo-scenario.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:4000/health/live >/dev/null || exit 1
# Migrations: `docker compose run --rm api npm run migrate` (or db:reset for the demo, then npm run seed:demo:prod)
CMD ["node", "dist/server.js"]
