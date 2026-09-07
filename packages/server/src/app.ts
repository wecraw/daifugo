/**
 * The server assembled from its parts (§8, §14), with the repository and clock
 * injected.
 *
 * Extracted from `index.ts` so the wiring can be built against an in-memory
 * repository and a manual clock in tests, and against Firestore and the wall
 * clock in production — the pieces are identical, only the edges differ. Callers
 * register nothing further and simply `listen`; every route and Socket.IO handler
 * is already attached (Fastify locks routes at `listen`).
 *
 * The built client is served off this same service (§14), which makes this an SPA
 * host as well as an API: the room code is a URL path (`/ABC`, §8.1), so a deep
 * link has to answer with `index.html` rather than a 404. That is the whole of the
 * routing story — there is no server-side router, and the client reads the code
 * back out of `location.pathname`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
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
  /**
   * Where the built client lives. Defaults to where the Docker image puts it;
   * pass `null` for an API-only server. A root without an `index.html` — an image
   * built before the client shipped, a dev process running behind Vite — is not an
   * error: the HTTP API and the socket serve as they always did.
   */
  clientRoot?: string | null;
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

  // No `cors` option, even with the iOS app in the picture (§14). Socket.IO's
  // `cors` only ever applies to the HTTP polling handshake, and this server is
  // WebSocket-only — a WebSocket upgrade is not subject to CORS at all, so the
  // app connects cross-origin without any allowance here. `POST /rooms` is the
  // one call that does need one; `allowNativeOrigin` below covers it.
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(app.server, { transports: ["websocket"] });

  const hub = new RoomHub(io);
  const manager = new RoomManager({
    repo: options.repo,
    scheduler,
    onUpdate: (doc) => hub.broadcast(doc),
    config: options.config,
  });
  hub.attach(manager);

  // Deliberately NOT `/healthz`: Google Front End intercepts that exact path in
  // front of Cloud Run and answers it with its own 404, so the request never
  // reaches this process. Measured on the deployed service — `/`, `/health`,
  // `/readyz` and even `/healthz/` all arrive normally; only the bare `/healthz`
  // is swallowed. Renaming it back would silently break every external check.
  app.get("/health", async () => ({ ok: true }));

  allowNativeOrigin(app);

  serveAppleAppSiteAssociation(app);

  serveClient(app, options.clientRoot === undefined ? defaultClientRoot() : options.clientRoot);

  // Room creation is an HTTP call, not a socket event: the code has to exist
  // before anyone can `joinRoom` it (§8.1). The first joiner becomes host (§8.2).
  app.post("/rooms", async () => ({ roomId: await manager.createRoom() }));

  io.on("connection", (socket) => hub.register(socket));

  return { app, io, manager, hub, scheduler };
}

/**
 * The origins the iOS app's WebView sends, which are not this service's own.
 *
 * Capacitor serves the bundle from `capacitor://localhost` on iOS; the second is
 * what a live-reload dev build reports instead. Neither is a wildcard: an
 * allowlist of two fixed scheme-and-host strings cannot be claimed by a web page,
 * because no browser will let one set an `Origin` it does not have.
 */
const NATIVE_ORIGINS = new Set(["capacitor://localhost", "ionic://localhost"]);

/**
 * The one piece of CORS this server needs (§14).
 *
 * On the web there is nothing cross-origin: the client is served off this same
 * service and every call is same-origin. The iOS app is the exception — its pages
 * come from `capacitor://localhost`, so `POST /rooms` is cross-origin and the
 * WebView drops the response without this header. Only that fixed pair of origins
 * is echoed, so the web's zero-CORS posture is unchanged for every real browser.
 *
 * No preflight branch: the request the client actually sends is a bodiless POST
 * with no custom headers, which is a CORS *simple* request — the browser sends it
 * outright and only checks the response. Credentials are not involved either;
 * identity is the resume token in the socket payload (§8.1), never a cookie.
 */
function allowNativeOrigin(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin === "string" && NATIVE_ORIGINS.has(origin)) {
      void reply.header("Access-Control-Allow-Origin", origin);
      void reply.header("Vary", "Origin");
    }
  });
}

/**
 * The Apple App Site Association file, which is what makes an invite link open
 * the iOS app instead of Safari (§14).
 *
 * iOS fetches this once, at install, from `https://<domain>/.well-known/` — via
 * Apple's CDN, so it must be plain HTTPS JSON with no redirect and no
 * authentication. The app claims it back with an `applinks:` associated-domains
 * entitlement (`packages/client/ios/App/App/App.entitlements`); both sides have
 * to name each other or the link silently stays a web link.
 *
 * `?` matches exactly one character, so `/???` is the room-code path (§8.1) and
 * nothing else: the bare origin still opens the web client, which is what
 * someone sharing "come play" rather than a specific room means.
 *
 * Served as a route rather than a static file because `@fastify/static` ignores
 * dotted directories, which would drop this into the SPA fallback and answer
 * Apple with a page of HTML.
 */
const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        // <team id>.<bundle id>, both from the Xcode project.
        appIDs: ["2FVQPZ94T9.org.ccrawford.daifugo"],
        components: [{ "/": "/???", comment: "a room code, e.g. /ABC" }],
      },
    ],
  },
} as const;

function serveAppleAppSiteAssociation(app: FastifyInstance): void {
  app.get("/.well-known/apple-app-site-association", async (_request, reply) =>
    reply.type("application/json").send(APPLE_APP_SITE_ASSOCIATION),
  );
}

/**
 * `packages/client/dist` as the runtime image lays it out, resolved from this
 * file rather than from `process.cwd()` so it does not depend on where the
 * process was started.
 */
function defaultClientRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
}

/**
 * Static assets plus the SPA fallback, when there is a client to serve.
 *
 * `index.html` is read once, at boot: it changes only with a deploy, and holding
 * it in memory keeps the fallback out of `@fastify/static`'s encapsulation — a
 * `reply.sendFile` from a root-scope handler would not see the decorator the
 * plugin installs in its own child context.
 *
 * Only GET and HEAD fall back. Anything else reaching the 404 handler is a real
 * 404 — answering a mistyped `POST /room` with a page of HTML would be a worse
 * answer than the error.
 */
function serveClient(app: FastifyInstance, clientRoot: string | null): void {
  if (clientRoot === null) return;
  const indexPath = join(clientRoot, "index.html");
  if (!existsSync(indexPath)) {
    app.log.warn(`no client build at ${clientRoot}; serving the API only`);
    return;
  }
  const indexHtml = readFileSync(indexPath, "utf8");

  // `wildcard: false` keeps the plugin from claiming `/*`, which would swallow
  // every unmatched path before the fallback below could see it.
  void app.register(fastifyStatic, { root: clientRoot, wildcard: false });

  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.code(404).send({ error: "Not Found" });
    }
    return reply.code(200).type("text/html; charset=utf-8").send(indexHtml);
  });
}
