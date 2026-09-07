/**
 * The name this browser plays under, remembered across visits.
 *
 * The stored *seat* (`StoredSession`) already carries a name, but it is scoped to
 * one room and is thrown away whenever that seat dies — a failed join, "forget",
 * leaving the room. The name is not scoped to a room: someone who played last
 * night is the same person tonight, so it is persisted on its own key and
 * outlives every seat.
 *
 * Storage fails quiet (`storage.ts`), so a browser that refuses it just asks for
 * the name again.
 */
import { PLAYER_NAME_STORAGE_KEY, readStored, writeStored } from "./storage";

export { PLAYER_NAME_STORAGE_KEY };

/** The remembered name, or "" when there is none. */
export function readStoredPlayerName(): string {
  return readStored(PLAYER_NAME_STORAGE_KEY)?.trim() ?? "";
}

/** Remembers the name for the next visit. Blank names clear it. */
export function writeStoredPlayerName(name: string): void {
  const trimmed = name.trim();
  writeStored(PLAYER_NAME_STORAGE_KEY, trimmed === "" ? null : trimmed);
}
