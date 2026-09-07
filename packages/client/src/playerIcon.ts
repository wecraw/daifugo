import { normalizePlayerIcon } from "@daifugo/core";
import { PLAYER_ICON_STORAGE_KEY, readStored, writeStored } from "./storage";

export { PLAYER_ICON_STORAGE_KEY };

export function readStoredPlayerIcon(): string | undefined {
  const value = readStored(PLAYER_ICON_STORAGE_KEY);
  return value === null ? undefined : normalizePlayerIcon(value);
}

export function writeStoredPlayerIcon(icon: string): void {
  // The current selection still works when storage is unavailable (`storage.ts`).
  writeStored(PLAYER_ICON_STORAGE_KEY, normalizePlayerIcon(icon));
}
