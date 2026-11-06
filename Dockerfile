# ── build stage ─────────────────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS build
WORKDIR /app
COPY package.json bunfig.toml ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN cd web && bun run build

# ── runtime stage ───────────────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    HOST=0.0.0.0 \
    PORT=8787
RUN apk add --no-cache vips-dev
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/v1/health || exit 1
WORKDIR /app/server
CMD ["bun", "src/index.ts"]
