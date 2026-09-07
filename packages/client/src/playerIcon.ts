import { normalizePlayerIcon, PLAYER_ICONS } from "@daifugo/core";
import { PLAYER_ICON_STORAGE_KEY, readStored, writeStored } from "./storage";

export { PLAYER_ICON_STORAGE_KEY };

export function readStoredPlayerIcon(): string | undefined {
  const value = readStored(PLAYER_ICON_STORAGE_KEY);
  return value === null ? undefined : normalizePlayerIcon(value);
}

/** Assign and remember an icon the first time this player opens the app. */
export function readOrCreateStoredPlayerIcon(): string {
  const stored = readStoredPlayerIcon();
  if (stored !== undefined) return stored;

  const icon = PLAYER_ICONS[Math.floor(Math.random() * PLAYER_ICONS.length)]!;
  writeStoredPlayerIcon(icon);
  return icon;
}

export function writeStoredPlayerIcon(icon: string): void {
  // The current selection still works when storage is unavailable (`storage.ts`).
  writeStored(PLAYER_ICON_STORAGE_KEY, normalizePlayerIcon(icon));
}
