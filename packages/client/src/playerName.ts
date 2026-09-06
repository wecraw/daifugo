/**
 * The name this browser plays under, remembered across visits.
 *
 * The stored *seat* (`StoredSession`) already carries a name, but it is scoped to
 * one room and is thrown away whenever that seat dies — a failed join, "forget",
 * leaving the room. The name is not scoped to a room: someone who played last
 * night is the same person tonight, so it is persisted on its own key and
 * outlives every seat.
 *
 * Storage can throw (private windows, blocked site data), so both sides fail
 * quiet: a browser that refuses storage just asks for the name again.
 */

export const PLAYER_NAME_STORAGE_KEY = "daifugo.playerName";

/** The remembered name, or "" when there is none. */
export function readStoredPlayerName(): string {
  try {
    const raw = globalThis.localStorage?.getItem(PLAYER_NAME_STORAGE_KEY);
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

/** Remembers the name for the next visit. Blank names clear it. */
export function writeStoredPlayerName(name: string): void {
  const trimmed = name.trim();
  try {
    if (trimmed === "") globalThis.localStorage?.removeItem(PLAYER_NAME_STORAGE_KEY);
    else globalThis.localStorage?.setItem(PLAYER_NAME_STORAGE_KEY, trimmed);
  } catch {
    // A browser refusing storage costs a retype, not a crash.
  }
}
