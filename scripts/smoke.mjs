/**
 * Deploy smoke check (#14a acceptance, §13.1): point it at a running service and
 * it proves the three things the deploy is actually risky about.
 *
 *   npm run smoke -- https://daifugo-xxxxxxxx.us-west1.run.app
 *
 * 1. `/health` returns 200 through the Cloud Run URL — the image boots, listens
 *    on $PORT, and the revision is serving.
 * 2. `POST /rooms` then `joinRoom` — a write and a read through the room
 *    document, performed by the service's own service account with no local
 *    credentials in play. This is the check that catches a missing Firestore IAM
 *    binding or a wrong `FIRESTORE_PROJECT_ID`, both of which are invisible to a
 *    health check.
 * 3. The WebSocket stays connected past 60 seconds with no traffic on it. This
 *    is the one that has to pass before any game logic depends on it: gen2 plus
 *    WebSocket-only transport plus no session affinity is a combination that
 *    either works or fails silently at the 60-second mark, and the client is far
 *    too late a place to discover which.
 *
 * Deliberately not part of `npm test`: it needs a deployed URL, and CI has none.
 */
import { io } from "socket.io-client";

const target = process.argv[2] ?? process.env.SMOKE_URL;
if (!target) {
  console.error("usage: npm run smoke -- <base-url>");
  process.exit(2);
}
const base = target.replace(/\/+$/, "");
/** Seconds to hold the socket open. 60 is the acceptance bar; override to probe further. */
const holdSeconds = Number(process.env.SMOKE_HOLD_SECONDS ?? 60);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function step(name) {
  process.stdout.write(`• ${name} … `);
  return {
    ok: (detail = "ok") => console.log(detail),
    fail: (error) => {
      console.log("FAILED");
      throw error instanceof Error ? error : new Error(String(error));
    },
  };
}

async function checkHealth() {
  const s = step("GET /health");
  const response = await fetch(`${base}/health`);
  const body = await response.text();
  if (response.status !== 200) s.fail(`expected 200, got ${response.status}: ${body}`);
  s.ok(`200 ${body}`);
}

async function createRoom() {
  const s = step("POST /rooms (Firestore write as the service account)");
  const response = await fetch(`${base}/rooms`, { method: "POST" });
  const body = await response.text();
  if (response.status !== 200) s.fail(`expected 200, got ${response.status}: ${body}`);
  const { roomId } = JSON.parse(body);
  if (!roomId) s.fail(`no roomId in response: ${body}`);
  s.ok(roomId);
  return roomId;
}

/** Resolves once `event` arrives, or rejects if the socket errors out first. */
function once(socket, event, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs,
    );
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    socket.once(event, settle(resolve));
    socket.once(
      "connect_error",
      settle((error) => reject(error)),
    );
    socket.once(
      "gameError",
      settle((error) => reject(new Error(JSON.stringify(error)))),
    );
  });
}

async function main() {
  console.log(`daifugo smoke check → ${base}\n`);
  await checkHealth();
  const roomId = await createRoom();

  const connecting = step("WebSocket connect");
  // WebSocket-only, matching the server (§14): a successful poll would hide
  // exactly the failure this check exists to catch. `reconnection: false` so a
  // silent drop stays a failure instead of being papered over.
  const socket = io(base, { transports: ["websocket"], reconnection: false });
  try {
    await once(socket, "connect");
    connecting.ok(socket.io.engine.transport.name);

    const joining = step("joinRoom (Firestore read + write)");
    const joined = once(socket, "joined");
    socket.emit("joinRoom", roomId, "smoke");
    const payload = await joined;
    joining.ok(`playerId ${payload.playerId}`);

    const holding = step(`holding the socket open for ${holdSeconds}s`);
    const disconnected = new Promise((_, reject) =>
      socket.once("disconnect", (reason) => reject(new Error(`disconnected early: ${reason}`))),
    );
    await Promise.race([sleep(holdSeconds * 1000), disconnected]);
    if (!socket.connected) holding.fail("socket reports disconnected");
    holding.ok(`still connected over ${socket.io.engine.transport.name}`);
  } finally {
    socket.close();
  }

  console.log("\nall checks passed");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
