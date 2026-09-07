/**
 * The Apple App Site Association file (§14), which is what makes an invite link
 * open the iOS app rather than the web client.
 *
 * iOS fetches it through Apple's CDN, which means it has to be JSON at exactly
 * this path — a page of HTML from the SPA fallback, or a 404 from the static
 * plugin ignoring dotted directories, both read as "this domain claims nothing"
 * and the link silently stays a web link.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import { InMemoryRoomRepository } from "../src/repository.js";
import { ManualScheduler } from "../src/timers.js";

const AASA_PATH = "/.well-known/apple-app-site-association";

const roots: string[] = [];

function server(withClient: boolean) {
  let clientRoot: string | null = null;
  if (withClient) {
    clientRoot = mkdtempSync(join(tmpdir(), "daifugo-client-"));
    roots.push(clientRoot);
    writeFileSync(join(clientRoot, "index.html"), "<!doctype html><div id=root></div>");
  }
  return buildServer({
    repo: new InMemoryRoomRepository(),
    scheduler: new ManualScheduler(),
    clientRoot,
  }).app;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("apple-app-site-association", () => {
  it("is served as JSON, ahead of the SPA fallback", async () => {
    const app = server(true);
    const response = await app.inject({ method: "GET", url: AASA_PATH });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    await app.close();
  });

  it("claims the room-code path for the app, and nothing wider", async () => {
    const app = server(true);
    const detail = response(await app.inject({ method: "GET", url: AASA_PATH }));

    expect(detail.appIDs).toEqual(["2FVQPZ94T9.org.ccrawford.daifugo"]);
    expect(detail.components.map((component) => component["/"])).toEqual(["/???"]);
    await app.close();
  });

  it("is served by an API-only image too", async () => {
    const app = server(false);

    expect((await app.inject({ method: "GET", url: AASA_PATH })).statusCode).toBe(200);
    await app.close();
  });
});

interface Detail {
  appIDs: string[];
  components: { "/": string }[];
}

function response(injected: { json: () => unknown }): Detail {
  const body = injected.json() as { applinks: { details: Detail[] } };
  expect(body.applinks.details).toHaveLength(1);
  return body.applinks.details[0]!;
}
