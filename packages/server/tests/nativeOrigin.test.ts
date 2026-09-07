/**
 * The one CORS allowance the iOS app needs (§14).
 *
 * The web client is served off this same service, so every call it makes is
 * same-origin and nothing here applies to it. The app's pages come from
 * `capacitor://localhost`, which makes `POST /rooms` cross-origin — a request the
 * WebView will send but whose response it discards without the header below.
 *
 * The socket needs no equivalent: this server is WebSocket-only, and a WebSocket
 * upgrade is not a CORS request.
 */
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import { InMemoryRoomRepository } from "../src/repository.js";
import { ManualScheduler } from "../src/timers.js";

function server() {
  return buildServer({
    repo: new InMemoryRoomRepository(),
    scheduler: new ManualScheduler(),
    clientRoot: null,
  }).app;
}

async function createRoom(origin: string | undefined) {
  return server().inject({
    method: "POST",
    url: "/rooms",
    headers: origin === undefined ? {} : { origin },
  });
}

describe("native origin", () => {
  it("echoes the iOS app's origin back to it", async () => {
    const response = await createRoom("capacitor://localhost");
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("capacitor://localhost");
    expect(response.headers.vary).toContain("Origin");
  });

  it("allows the older ionic scheme too", async () => {
    const response = await createRoom("ionic://localhost");
    expect(response.headers["access-control-allow-origin"]).toBe("ionic://localhost");
  });

  it("allows nothing else", async () => {
    const response = await createRoom("https://example.com");
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("stays out of the way of a same-origin request", async () => {
    const response = await createRoom(undefined);
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
