# Daifugo

Private multiplayer Daifugo (Japanese card game) for the author and friends.
TypeScript npm-workspaces monorepo — see [`docs/SPEC.md`](docs/SPEC.md) for the
full specification.

```text
packages/
├── core/    # Pure, deterministic game engine (@daifugo/core)
├── server/  # Fastify + Socket.IO authoritative server
└── client/  # Vite + React client
```

## Setup

```bash
npm install
```

## Commands

```bash
npm run test -w @daifugo/core   # core test matrix — must be green before client work
npm run dev                     # server on :4000, client (Vite) on :5173
npm run test                    # all workspace tests
npm run typecheck               # project-referenced tsc across all packages
npm run lint                    # eslint
npm run build                   # build core, server, then client
```
