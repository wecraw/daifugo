/**
 * Shared fixtures for the rule tests (§12.1).
 *
 * Combos are always built through the parser, never by hand: a `PlayCombo`
 * assembled literally could carry a resolved rank no real play could produce, and
 * every rule reads the resolved view (§5.4).
 */
import { parseCombo } from "../src/combo.js";
import { createDeck } from "../src/deck.js";
import type { SeatingContext } from "../src/turnOrder.js";
import type { Card, JokerBinding, PlayCombo, Rank, Suit } from "../src/types.js";

const DECK = createDeck();

export function card(id: string): Card {
  const found = DECK.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no such card: ${id}`);
  return found;
}

export function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

export function bind(cardId: string, rank: Rank, suit: Suit): JokerBinding {
  return { cardId, rank, suit };
}

/** Parse a selection, failing the fixture loudly rather than the assertion. */
export function combo(ids: string[], bindings?: JokerBinding[]): PlayCombo {
  const result = parseCombo(cards(...ids), bindings);
  if (!result.ok) throw new Error(`bad fixture: ${result.error}`);
  return result.value;
}

export interface SeatingOptions {
  finished?: string[];
  passed?: string[];
}

/** A seating context over `p0..p{n-1}`, with optional finished and passed sets. */
export function seatsOf(count: number, options: SeatingOptions = {}): SeatingContext {
  return {
    turnOrder: Array.from({ length: count }, (_, i) => `p${i}`),
    finishedPlayerIds: options.finished ?? [],
    passedPlayerIds: options.passed ?? [],
  };
}
