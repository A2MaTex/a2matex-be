# syntax=docker/dockerfile:1.7
#
# One image serves three roles: the API (default CMD), the migration job
# (`npx prisma migrate deploy`) and the manual seed jobs (`npx tsx src/seed/...`).
# Debian slim instead of Alpine because bcrypt ships glibc prebuilds.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl curl dumb-init \
    && rm -rf /var/lib/apt/lists/*

# The repo does not commit a lockfile, so dependencies are resolved exactly once
# here and every later stage derives from this tree instead of resolving again.
FROM base AS deps
COPY package.json ./
RUN npm install --no-package-lock

FROM deps AS builder
COPY tsconfig.json tsconfig.build.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run prisma:generate && npm run build

# Strip devDependencies from the same tree the build used.
FROM builder AS pruned
RUN npm prune --omit=dev --no-package-lock && npm cache clean --force

FROM base AS runner
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9999
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# TypeScript sources stay for the manual seed job, which parses controller files.
COPY --from=builder /app/src ./src
COPY prisma ./prisma
COPY prisma7.config.ts tsconfig.json package.json ./

USER node
EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/${API_PREFIX:-api/v1}/health" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
