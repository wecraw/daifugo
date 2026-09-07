/** Shared player-name rules used at both trust boundaries. */
export const PLAYER_NAME_MAX_LENGTH = 16;

/** Returns the canonical stored name, or `null` when it is invalid. */
export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name !== "" && name.length <= PLAYER_NAME_MAX_LENGTH ? name : null;
}
