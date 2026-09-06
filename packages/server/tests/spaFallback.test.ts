/**
 * Serving the built client off the API service (§14), and the SPA fallback the
 * room-code URLs need (§8.1).
 *
 * The client's whole router is `location.pathname`, so `/ABC` has to arrive as
 * `index.html`. The fixture writes a throwaway build to a temp dir rather than
 * depending on `packages/client/dist`, which may or may not exist depending on
 * whether anyone has run a build.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import { InMemoryRoomRepository } from "../src/repository.js";
import { ManualScheduler } from "../src/timers.js";

const INDEX_HTML = "<!doctype html><title>Daifugo</title><div id=root></div>";

const roots: string[] = [];

function clientBuild(): string {
  const root = mkdtempSync(join(tmpdir(), "daifugo-client-"));
  roots.push(root);
  writeFileSync(join(root, "index.html"), INDEX_HTML);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "app.js"), "export const ok = true;\n");
  return root;
}

function server(clientRoot: string | null) {
  return buildServer({
    repo: new InMemoryRoomRepository(),
    scheduler: new ManualScheduler(),
    clientRoot,
  }).app;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("serving the client", () => {
  it("answers a room-code deep link with index.html", async () => {
    const app = server(clientBuild());
    const response = await app.inject({ method: "GET", url: "/ABC" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toBe(INDEX_HTML);
    await app.close();
  });

  it("serves the index at the root and the real assets as themselves", async () => {
    const app = server(clientBuild());

    expect((await app.inject({ method: "GET", url: "/" })).body).toBe(INDEX_HTML);
    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("export const ok = true;\n");
    await app.close();
  });

  it("does not shadow the API routes", async () => {
    const app = server(clientBuild());

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    const created = await app.inject({ method: "POST", url: "/rooms" });
    expect(created.statusCode).toBe(200);
    expect(typeof created.json().roomId).toBe("string");
    await app.close();
  });

  it("still 404s a non-GET that matches no route", async () => {
    const app = server(clientBuild());
    const response = await app.inject({ method: "POST", url: "/ABC" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    await app.close();
  });

  it("serves the API alone when there is no client build", async () => {
    const app = server(null);

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/ABC" })).statusCode).toBe(404);
    await app.close();
  });

  it("serves the API alone when the configured root has no index.html", async () => {
    const empty = mkdtempSync(join(tmpdir(), "daifugo-empty-"));
    roots.push(empty);
    const app = server(empty);

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/ABC" })).statusCode).toBe(404);
    await app.close();
  });
});
