import { normalizePlayerIcon } from "@daifugo/core";

export const PLAYER_ICON_STORAGE_KEY = "daifugo.playerIcon";

export function readStoredPlayerIcon(): string | undefined {
  try {
    const value = globalThis.localStorage?.getItem(PLAYER_ICON_STORAGE_KEY);
    return value == null ? undefined : normalizePlayerIcon(value);
  } catch {
    return undefined;
  }
}

export function writeStoredPlayerIcon(icon: string): void {
  try {
    globalThis.localStorage?.setItem(PLAYER_ICON_STORAGE_KEY, normalizePlayerIcon(icon));
  } catch {
    // The current selection still works when storage is unavailable.
  }
}
