/** Shared allowlist keeps player icons compact and safe for every client. */
export const PLAYER_ICONS = [
  "🙂",
  "😎",
  "🤠",
  "🤖",
  "👻",
  "👽",
  "🐱",
  "🐶",
  "🦊",
  "🐼",
  "🐸",
  "🐵",
  "🦁",
  "🐯",
  "🐨",
  "🐙",
  "🦄",
  "🐲",
  "🦋",
  "🌻",
  "🍀",
  "🍄",
  "🔥",
  "⭐",
] as const;

export const DEFAULT_PLAYER_ICON = PLAYER_ICONS[0];

export function normalizePlayerIcon(value: unknown): string {
  return typeof value === "string" && PLAYER_ICONS.some((icon) => icon === value)
    ? value
    : DEFAULT_PLAYER_ICON;
}
