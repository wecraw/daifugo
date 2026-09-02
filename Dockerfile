# The deployed image (§13.1, §14): `core` + `server`, listening on $PORT.
#
# The build context is the monorepo root, not `packages/server`, because the
# server imports `@daifugo/core` as a workspace sibling — there is no published
# package to install from a registry.
#
# Two stages so the runtime image carries no toolchain: the build stage owns
# TypeScript and the sources, the runtime stage gets `dist` plus production
# dependencies only. Both stages install with `npm ci` against the committed
# lockfile, filtered to the two workspaces that ship — `@daifugo/client` is
# skipped entirely here (it arrives in #36, served off this same service).

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app

# Manifests first, so the (slow) install layer is cached until a dependency
# actually changes. `npm ci` validates the lockfile against every workspace it
# names, so all three package.json files are copied even though the client is
# not installed.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --include-workspace-root \
      --workspace @daifugo/core \
      --workspace @daifugo/server

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/server packages/server

# `tsc -b` on the server follows its project reference into core, so this builds
# both in dependency order (§13).
RUN npm run build -w @daifugo/server

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

# Cloud Run injects PORT; the default matches its own and keeps `docker run`
# honest locally.
ENV PORT=8080
EXPOSE 8080

# Exec form, and `node` rather than `npm start`, so node is PID 1 and receives
# SIGTERM directly on a revision swap. Under npm, node is a grandchild and the
# signal never reaches it.
CMD ["node", "packages/server/dist/index.js"]
