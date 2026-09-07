/**
 * The room code in the browser's address bar (§8).
 *
 * The client is a single page served at the origin root, so the whole of the
 * "route" is the room code: `/ABC` while seated, `/` otherwise. Sharing the URL
 * is the same act as reading the code aloud — a friend who opens it lands on the
 * menu with the code already filled in, or straight in the room when this
 * browser already knows their name (§8.1).
 *
 * `replaceState`, never `pushState`: the room is not a history entry. Back out of
 * a room and the browser should leave the app, not walk backwards through the
 * seats this tab has held.
 */

/** Join codes are 3 uppercase letters (`generateJoinCode`, server-side). */
const ROOM_CODE_PATTERN = /^[A-Z]{3}$/;

/** The room code a URL path names, or null when it names none. */
export function readRoomCodeFromPath(pathname: string): string | null {
  const segment = pathname.split("/").filter((part) => part !== "").pop();
  if (segment === undefined) return null;
  const code = segment.toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

/**
 * The room code a whole URL names, or null when it names none.
 *
 * This is the universal-link entry point: iOS hands the app the tapped
 * `https://…/ABC` outright rather than navigating the web view to it (§14), so
 * the path has to be pulled back out of an absolute URL. A string that is not a
 * URL at all is simply not a room code.
 */
export function readRoomCodeFromUrl(url: string): string | null {
  try {
    return readRoomCodeFromPath(new URL(url).pathname);
  } catch {
    return null;
  }
}

/** The code in the address bar at load, before any sync has rewritten it. */
export function readRoomCodeFromLocation(): string | null {
  try {
    const pathname = globalThis.location?.pathname;
    return typeof pathname === "string" ? readRoomCodeFromPath(pathname) : null;
  } catch {
    return null;
  }
}

/** Points the address bar at `code`, or back at the root when it is null. */
export function syncRoomCodeToUrl(code: string | null): void {
  try {
    const location = globalThis.location;
    const history = globalThis.history;
    if (location === undefined || history === undefined) return;
    const target = code === null ? "/" : `/${code}`;
    if (location.pathname === target) return;
    history.replaceState(history.state, "", `${target}${location.search}${location.hash}`);
  } catch {
    // A browser refusing history rewrites costs a shareable URL, not a crash.
  }
}
