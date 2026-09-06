# The deployed image (§13.1, §14): `core` + `server`, listening on $PORT.
#
# The build context is the monorepo root, not `packages/server`, because the
# server imports `@daifugo/core` as a workspace sibling — there is no published
# package to install from a registry.
#
# Two stages so the runtime image carries no toolchain: the build stage owns
# TypeScript and the sources, the runtime stage gets `dist` plus production
# dependencies only. Both stages install with `npm ci` against the committed
# lockfile. The build stage installs all three workspaces — the client's Vite
# build runs here — while the runtime stage installs the server's dependencies
# only and receives the client as static files, which need no node_modules.

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app

# Manifests first, so the (slow) install layer is cached until a dependency
# actually changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/client packages/client

# `tsc -b` on the server follows its project reference into core, so this builds
# both in dependency order (§13).
RUN npm run build -w @daifugo/server
RUN npm run build -w @daifugo/client

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --include-workspace-root --workspace @daifugo/server \
    && npm cache clean --force

# npm links `@daifugo/core` into node_modules as a symlink to packages/core, so
# dropping the compiled output in place is all the resolution needs.
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/dist packages/server/dist

# The client ships as static files served by the server off this same service
# (§14): `app.ts` resolves this path relative to its own module, and answers
# room-code deep links like `/ABC` with `index.html` (§8.1).
COPY --from=build /app/packages/client/dist packages/client/dist

# Cloud Run injects PORT; the default matches its own and keeps `docker run`
# honest locally.
ENV PORT=8080
EXPOSE 8080

# Exec form, and `node` rather than `npm start`, so node is PID 1 and receives
# SIGTERM directly on a revision swap. Under npm, node is a grandchild and the
# signal never reaches it.
CMD ["node", "packages/server/dist/index.js"]
