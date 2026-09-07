/**
 * The web build's half of `serverUrl.ts` (§14).
 *
 * `VITE_SERVER_URL` is unset here, exactly as it is in the deployed web build, so
 * what these assert is that nothing about the origin-relative code path moved:
 * `io()` still gets no URL, `/rooms` is still `/rooms`, and the invite link is
 * still this page's origin plus the code. The native side of the same module is
 * a build-time constant and has no runtime to test — `scripts/check-native-env.mjs`
 * is what guards it, before the bundle exists.
 */
import { describe, expect, it } from "vitest";
import {
  PUBLIC_WEB_ORIGIN,
  SERVER_ORIGIN,
  inviteUrl,
  serverUrl,
  socketUrl,
} from "../src/serverUrl";

describe("serverUrl (web build)", () => {
  it("has no configured origin", () => {
    expect(SERVER_ORIGIN).toBe("");
    expect(PUBLIC_WEB_ORIGIN).toBe("");
  });

  it("leaves server paths origin-relative", () => {
    expect(serverUrl("/rooms")).toBe("/rooms");
  });

  it("gives the socket no URL, which means the page's own origin", () => {
    expect(socketUrl()).toBeUndefined();
  });

  it("builds the invite link off the page's origin", () => {
    expect(inviteUrl("ABC")).toBe(`${window.location.origin}/ABC`);
  });
});
