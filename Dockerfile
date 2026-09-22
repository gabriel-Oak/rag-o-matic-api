# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: builder — compiles TypeScript to dist/
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# package*.json first to leverage Docker layer caching
COPY package*.json ./

# Full install (dev deps needed for tsc).
# NOTE: the root "prepare" script (husky) runs during npm ci. The build
# context has no .git (see .dockerignore), and husky v9 handles that
# gracefully: it prints ".git can't be found" and exits 0
# (see node_modules/husky/index.js) — so the build does NOT fail.
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: runtime — production image
# ---------------------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./

# Production deps only.
# --ignore-scripts is safe here: the only packages with install scripts in
# package-lock.json are esbuild and fsevents, both dev-only
# (esbuild via tsx, fsevents optional/darwin). No production dependency
# needs postinstall. It also skips the root "prepare" (husky), which is a
# devDependency and would be missing with --omit=dev.
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

EXPOSE 8080

# Run as the unprivileged "node" user (built into node:alpine).
# The app only binds a TCP port and writes logs to stdout — no file writes.
USER node

CMD ["node", "dist/index.js"]
