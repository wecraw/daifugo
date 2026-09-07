/**
 * Where the server is (§14), and the one build-time knob the native app needs.
 *
 * **The web build has no configuration and never will.** `VITE_SERVER_URL` is
 * unset there, `SERVER_ORIGIN` is `""`, and every call below resolves to the
 * same origin-relative path the client has always used — `io()` with no URL, and
 * `fetch("/rooms")`. Dev keeps going through the Vite proxy.
 *
 * **The iOS build has to name the server.** Its pages come from
 * `capacitor://localhost`, so an origin-relative call would ask the app bundle
 * for `/rooms`. `npm run build:ios` builds in Vite's `native` mode, which reads
 * `.env.native` and bakes the deployed HTTPS origin in here. The build script
 * refuses to run without it rather than shipping an app that silently cannot
 * reach the server.
 *
 * `VITE_PUBLIC_WEB_URL` is the same idea for the invite link: the code lives in
 * the URL path (`roomUrl.ts`), and `capacitor://localhost/ABC` is not a link a
 * friend can open. It defaults to the server origin, since the server is also
 * what serves the web client.
 */

/** Trailing slashes are stripped so callers can always append an absolute path. */
function normalize(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

/** The server's origin, or `""` when it is the page's own (the web build). */
export const SERVER_ORIGIN = normalize(import.meta.env.VITE_SERVER_URL);

/** Where the web client is reachable, for links meant to leave the device. */
export const PUBLIC_WEB_ORIGIN = normalize(import.meta.env.VITE_PUBLIC_WEB_URL) || SERVER_ORIGIN;

/** An absolute path (`/rooms`) resolved against the server. */
export function serverUrl(path: string): string {
  return `${SERVER_ORIGIN}${path}`;
}

/**
 * The URL for the Socket.IO client, or `undefined` for "this page's origin" —
 * which is the argument `io()` wants when there is nothing to configure.
 */
export function socketUrl(): string | undefined {
  return SERVER_ORIGIN === "" ? undefined : SERVER_ORIGIN;
}

/**
 * The invite link for a room code: an `https://` URL wherever one is
 * configured, and otherwise the page's own origin, which is what the web build
 * has always shared.
 */
export function inviteUrl(roomCode: string): string {
  const base = PUBLIC_WEB_ORIGIN !== "" ? PUBLIC_WEB_ORIGIN : (globalThis.location?.origin ?? "");
  return `${base}/${roomCode}`;
}
