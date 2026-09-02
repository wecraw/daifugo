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
npm run dev                     # Firestore emulator + server on :4000 + client (Vite) on :5173
npm run test                    # all workspace tests (Firestore-backed tests auto-skip)
npm run test:emulator           # server tests under the Firestore emulator
npm run emulator                # Firestore emulator alone (on :8080)
npm run typecheck               # project-referenced tsc across all packages
npm run lint                    # eslint
npm run build                   # build core, server, then client
```

## State and configuration (§14)

Room state lives in **Firestore**, one document per room, so a redeploy or a crash
does not destroy an in-flight match. The service runs as a **single Cloud Run
instance** — this is a private game for a dozen people, and §14 records the
scale-out machinery deliberately left unbuilt. `npm run dev` wraps the stack in
the Firestore emulator automatically (via `firebase-tools`, a dev dependency — no
global install needed).

Any **deployed** runtime must set `FIRESTORE_PROJECT_ID` explicitly — the server
refuses to auto-detect it (§14). Point at the emulator by also setting
`FIRESTORE_EMULATOR_HOST` (both are set for you under `npm run dev`).
