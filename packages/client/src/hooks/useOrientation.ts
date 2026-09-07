/**
 * Landscape lock (§0, §10.1).
 *
 * Three layers, because none is sufficient alone: ask the Screen Orientation API
 * to lock landscape where it exists (it only succeeds in fullscreen on the phones
 * that implement it at all), otherwise detect portrait and let the caller show the
 * rotate prompt, and where even rotating cannot help — a phone with its rotation
 * locked never reports landscape — let the player opt into sideways mode instead.
 * Sideways mode is the guarantee; the lock and the prompt are the nicer paths to
 * the same landscape frame.
 */
import { useEffect, useState } from "react";

const PORTRAIT_QUERY = "(orientation: portrait)";

export function isPortrait(): boolean {
  return globalThis.matchMedia?.(PORTRAIT_QUERY).matches ?? false;
}

/** Live `true` while the viewport is portrait. */
export function useIsPortrait(): boolean {
  const [portrait, setPortrait] = useState(isPortrait);

  useEffect(() => {
    const query = globalThis.matchMedia?.(PORTRAIT_QUERY);
    if (query === undefined) return;
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return portrait;
}

interface LockableOrientation {
  lock?: (orientation: string) => Promise<void>;
}

/**
 * Best-effort landscape lock. Rejects on every desktop browser and on iOS, which
 * is why the rotate prompt exists; the rejection is swallowed on purpose.
 */
export function useLandscapeLock(): void {
  useEffect(() => {
    const orientation = globalThis.screen?.orientation as LockableOrientation | undefined;
    void orientation?.lock?.("landscape").catch(() => {
      /* Unsupported outside fullscreen, or not implemented. The prompt covers it. */
    });
  }, []);
}

export const SIDEWAYS_STORAGE_KEY = "daifugo.sideways";

/**
 * Sideways mode: the escape hatch for a phone whose rotation is locked.
 *
 * Neither half of the landscape lock reaches that phone — the API lock is
 * unimplemented on iOS, and the rotate prompt is a dead end because the viewport
 * never reports landscape no matter how the device is held. So the prompt offers
 * to rotate the *app* instead, 90 degrees inside a portrait viewport, and the
 * choice is remembered: someone who plays with rotation locked plays that way
 * every night.
 *
 * The flag only takes effect in portrait. A player who later unlocks rotation and
 * turns the phone gets the real landscape layout with no setting to undo, which
 * is also the way back out of a sideways mode they did not mean to enter.
 *
 * Storage can throw (private windows, blocked site data), so both sides fail
 * quiet, exactly as `playerName.ts` does.
 */
export function readStoredSideways(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEWAYS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredSideways(sideways: boolean): void {
  try {
    if (sideways) globalThis.localStorage?.setItem(SIDEWAYS_STORAGE_KEY, "true");
    else globalThis.localStorage?.removeItem(SIDEWAYS_STORAGE_KEY);
  } catch {
    // A browser refusing storage costs one tap on the next visit, not a crash.
  }
}

/** `[opted in, opt in]`. The opt-out is rotating the device, not a control. */
export function useSidewaysMode(): [boolean, () => void] {
  const [sideways, setSideways] = useState(readStoredSideways);

  const enable = () => {
    writeStoredSideways(true);
    setSideways(true);
  };

  return [sideways, enable];
}
