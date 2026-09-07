/**
 * The four things this client remembers between visits, and where they live.
 *
 * **On the web, this is `localStorage` and nothing more.** Reads and writes are
 * synchronous, because that is what the callers need: the seat (§8.1) is read in
 * a `useState` initialiser, before the first render, and an async read there
 * would mean a frame of "not seated" on every reload.
 *
 * **On iOS, `localStorage` alone is not durable enough to hold the seat.**
 * WKWebView keeps it across launches, but iOS is free to evict a web view's
 * site data under storage pressure, and it does so without asking. Losing the
 * remembered name is a retype; losing the resume token mid-match means the seat
 * cannot be reclaimed at all (§8.1), and the player comes back as a new one. So
 * on native the same values are mirrored into `@capacitor/preferences`
 * (`NSUserDefaults`), which is backed up and survives eviction, and
 * {@link hydrateStorage} copies them back into `localStorage` at boot before
 * React mounts.
 *
 * `localStorage` stays the single source of truth at runtime either way — the
 * mirror is write-behind, so no caller has to care which platform it is on.
 * Both sides fail quiet, as every storage call in this client already did: a
 * refused write costs a reconnect or a retype, never a crash.
 */
import { Preferences } from "@capacitor/preferences";
import { isNative } from "./native";

/** The seat this browser holds: room, name and resume token (§8.1). */
export const SESSION_STORAGE_KEY = "daifugo.session";
/** The name this browser plays under, across rooms and evenings. */
export const PLAYER_NAME_STORAGE_KEY = "daifugo.playerName";
/** The icon that name is shown under, chosen once and reused. */
export const PLAYER_ICON_STORAGE_KEY = "daifugo.playerIcon";
/** Sideways mode, for a phone whose rotation is locked (§10.1). */
export const SIDEWAYS_STORAGE_KEY = "daifugo.sideways";
/** Role-name terminology, client-side only (§11). */
export const TERMINOLOGY_STORAGE_KEY = "daifugo.terminology";

/**
 * Every key the native mirror carries. Adding a persisted key means adding it
 * here too, or it silently stops surviving an eviction on iOS — which is why
 * `storage.test.ts` asserts this list covers the keys the client actually uses.
 */
export const MIRRORED_KEYS = [
  SESSION_STORAGE_KEY,
  PLAYER_NAME_STORAGE_KEY,
  PLAYER_ICON_STORAGE_KEY,
  SIDEWAYS_STORAGE_KEY,
  TERMINOLOGY_STORAGE_KEY,
] as const;

/** Reads a persisted value, or null when there is none (or storage is refused). */
export function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Persists a value; `null` removes it. Mirrored to native storage on iOS. */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // A browser refusing storage costs a reconnect or a retype, not a crash.
  }
  mirrorToNative(key, value);
}

/** Write-behind to `NSUserDefaults`. Fire-and-forget: nothing waits on it. */
function mirrorToNative(key: string, value: string | null): void {
  if (!isNative()) return;
  const write = value === null ? Preferences.remove({ key }) : Preferences.set({ key, value });
  void write.catch(() => {
    // The `localStorage` write above already succeeded; the mirror is insurance.
  });
}

/**
 * True when there is a native mirror to read before the app can render. Lets
 * `main.tsx` keep the web path fully synchronous.
 */
export function needsHydration(): boolean {
  return isNative();
}

/**
 * Copies the native mirror back into `localStorage`. Must be awaited before the
 * first render, since the seat is read synchronously from there.
 *
 * `localStorage` wins where it still holds a value: it is the live copy, and the
 * mirror is only ever behind it. The mirror is read for keys `localStorage` has
 * lost — which, on a launch after iOS evicted the web view's data, is all of
 * them.
 */
export async function hydrateStorage(): Promise<void> {
  if (!needsHydration()) return;
  await Promise.all(
    MIRRORED_KEYS.map(async (key) => {
      try {
        if (readStored(key) !== null) return;
        const { value } = await Preferences.get({ key });
        if (typeof value === "string") globalThis.localStorage?.setItem(key, value);
      } catch {
        // A key that will not hydrate is a key the app asks for again.
      }
    }),
  );
}
