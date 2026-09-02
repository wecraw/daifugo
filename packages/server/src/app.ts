/**
 * The server assembled from its parts (§8, §14), with the repository and clock
 * injected.
 *
 * Extracted from `index.ts` so the wiring can be built against an in-memory
 * repository and a manual clock in tests, and against Firestore and the wall
 * clock in production — the pieces are identical, only the edges differ. Callers
 * register nothing further and simply `listen`; every route and Socket.IO handler
 * is already attached (Fastify locks routes at `listen`).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@daifugo/core";
import type { HouseRulesConfig } from "@daifugo/core";
import type { RoomRepository } from "./repository.js";
import { RoomManager } from "./roomManager.js";
import { RoomHub, type DaifugoServer } from "./room.js";
import { RealScheduler, type Scheduler } from "./timers.js";

export interface BuildServerOptions {
  repo: RoomRepository;
  /** Defaults to the wall clock; tests pass a {@link ManualScheduler}. */
  scheduler?: Scheduler;
  /** Fastify logging. Off by default so tests stay quiet. */
  logger?: boolean;
  config?: Readonly<HouseRulesConfig>;
}

export interface BuiltServer {
  app: FastifyInstance;
  io: DaifugoServer;
  manager: RoomManager;
  hub: RoomHub;
  scheduler: Scheduler;
}

export function buildServer(options: BuildServerOptions): BuiltServer {
  const app = Fastify({ logger: options.logger ?? false });
  const scheduler =
    options.scheduler ??
    new RealScheduler((error) => app.log.error(error, "scheduled task failed"));

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(app.server, { cors: { origin: "*" }, transports: ["websocket"] });

  const hub = new RoomHub(io);
  const manager = new RoomManager({
    repo: options.repo,
    scheduler,
    onUpdate: (doc) => hub.broadcast(doc),
    config: options.config,
  });
  hub.attach(manager);

  app.get("/healthz", async () => ({ ok: true }));

  // Room creation is an HTTP call, not a socket event: the code has to exist
  // before anyone can `joinRoom` it (§8.1). The first joiner becomes host (§8.2).
  app.post("/rooms", async () => ({ roomId: await manager.createRoom() }));

  io.on("connection", (socket) => hub.register(socket));

  return { app, io, manager, hub, scheduler };
}
