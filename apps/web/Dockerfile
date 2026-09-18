# Build context: repository root (needs packages/shared).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @mtg/shared build && pnpm --filter @mtg/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# The entrypoint rewrites config.js at start, so the html dir must be writable by nginx (uid 101).
COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html
COPY --chmod=755 apps/web/docker-entrypoint.sh /entrypoint.sh
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
