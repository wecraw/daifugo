/**
 * Landscape lock (§0, §10.1).
 *
 * Two halves, because neither is sufficient alone: ask the Screen Orientation API
 * to lock landscape where it exists (it only succeeds in fullscreen on the phones
 * that implement it at all), and otherwise detect portrait and let the caller show
 * the rotate prompt. The prompt is the guarantee; the lock is the nicety.
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
