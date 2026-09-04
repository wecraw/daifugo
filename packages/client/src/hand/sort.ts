/**
 * Hand sorting (§10.8): rank-then-suit or suit-then-rank, persisted.
 *
 * Rank sort follows the **current effective order** (§5.2), so the hand visibly
 * reverses when revolution flips the table. That reversal is deliberate feedback,
 * which is why the comparator is core's `compareCards` under `effectiveInverted`
 * rather than a fixed 3-to-2 order the client keeps for itself: what the hand
 * shows and what beats what are the same fact.
 *
 * The preference is client-side only, like the language (§11), and a browser that
 * refuses storage costs the preference, not the toggle.
 */
import { SUITS, compareCards, type Card } from "@daifugo/core";

export const HAND_SORT_STORAGE_KEY = "daifugo.handSort";

/** `rank` is rank-then-suit, `suit` is suit-then-rank (§10.8). */
export type HandSortMode = "rank" | "suit";

export const DEFAULT_HAND_SORT: HandSortMode = "rank";

export function isHandSortMode(value: unknown): value is HandSortMode {
  return value === "rank" || value === "suit";
}

export function readHandSort(): HandSortMode {
  try {
    const stored = globalThis.localStorage?.getItem(HAND_SORT_STORAGE_KEY);
    return isHandSortMode(stored) ? stored : DEFAULT_HAND_SORT;
  } catch {
    return DEFAULT_HAND_SORT;
  }
}

export function writeHandSort(mode: HandSortMode): void {
  try {
    globalThis.localStorage?.setItem(HAND_SORT_STORAGE_KEY, mode);
  } catch {
    // Persistence is a convenience; the toggle still works without it.
  }
}

export function nextHandSort(mode: HandSortMode): HandSortMode {
  return mode === "rank" ? "suit" : "rank";
}

/** Suits in pip order, with the jokers — which have no suit — last. */
const SUIT_COLUMN: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(SUITS.map((suit, index) => [suit, index])),
);

/**
 * The hand as it should read, weakest first within each grouping.
 *
 * Both modes order by strength under `inverted`, so both reverse on revolution;
 * they differ only in whether suit or strength is the outer key.
 */
export function sortHand(cards: readonly Card[], mode: HandSortMode, inverted: boolean): Card[] {
  const sorted = [...cards].sort((a, b) => compareCards(a, b, inverted));
  if (mode === "rank") return sorted;
  return sorted.sort((a, b) => columnOf(a) - columnOf(b));
}

function columnOf(card: Card): number {
  return card.suit === null ? SUITS.length : (SUIT_COLUMN[card.suit] ?? SUITS.length);
}
