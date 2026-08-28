/**
 * The invariant assertion helper (§12.3, tests 21-23).
 *
 * Every engine test drives the game through `act`, which applies one action and
 * asserts all three invariants against the state it came from. Asserting after
 * *every* action rather than only in the dedicated invariant tests is the point:
 * a conservation break is found in the change that caused it, in the phase that
 * caused it, rather than several issues later in a fuzz run.
 *
 * 21. Card conservation: `sum(hands) + trick + graveyard === 54`.
 * 22. `turnOrder` is never mutated mid-round, and its length always equals the
 *     player count.
 * 23. `stateVersion` strictly increases.
 */
import { expect } from "vitest";
import { applyAction } from "../src/engine.js";
import { DECK_SIZE } from "../src/deck.js";
import type { ErrorCode } from "../src/i18n-keys.js";
import type { ClientAction, GameState } from "../src/types.js";

/** Every card the state can account for: hands, the trick, and the graveyard. */
export function countCards(state: GameState): number {
  const inHands = Object.values(state.hands).reduce((sum, hand) => sum + hand.length, 0);
  const inTrick = state.currentTrick.reduce((sum, play) => sum + play.combo.cards.length, 0);
  return inHands + inTrick + state.graveyard.length;
}

/** Every card id the state holds, for spotting a duplicate as well as a loss. */
export function cardIds(state: GameState): string[] {
  return [
    ...Object.values(state.hands).flatMap((hand) => hand.map((card) => card.id)),
    ...state.currentTrick.flatMap((play) => play.combo.cards.map((card) => card.id)),
    ...state.graveyard.map((card) => card.id),
  ].sort();
}

/**
 * Invariants 21-23 across one transition.
 *
 * `turnOrder` is compared elementwise unless the action crossed a round boundary
 * — a deal is exactly when reseating is allowed to rewrite it (§3.2) — which is
 * detected by the round number changing rather than by trusting the action type.
 */
export function assertInvariants(before: GameState, after: GameState): void {
  // 21. A room in `LOBBY` has not been dealt, so it holds no cards at all; every
  // state from the deal onward holds all 54, each exactly once.
  if (after.status !== "LOBBY") {
    expect(countCards(after)).toBe(DECK_SIZE);
    expect(new Set(cardIds(after)).size).toBe(DECK_SIZE);
  }

  // 22
  expect(after.turnOrder).toHaveLength(after.players.length);
  if (after.roundNumber === before.roundNumber) {
    expect(after.turnOrder).toEqual(before.turnOrder);
  } else {
    expect([...after.turnOrder].sort()).toEqual([...before.turnOrder].sort());
  }

  // 23
  expect(after.stateVersion).toBeGreaterThan(before.stateVersion);
}

/**
 * Apply an action, assert the invariants, and return the new state.
 *
 * Fails loudly on an `ErrorCode`: a test that expects a rejection uses `reject`,
 * so an unexpected one never silently leaves the state unadvanced.
 */
export function act(state: GameState, action: ClientAction, playerId: string): GameState {
  const result = applyAction(state, action, playerId);
  if (!result.ok) throw new Error(`unexpected ${result.error} from ${action.type}`);
  assertInvariants(state, result.value);
  return result.value;
}

/** Apply an action expecting it to be refused, and return the code (§8.0). */
export function reject(state: GameState, action: ClientAction, playerId: string): ErrorCode {
  const result = applyAction(state, action, playerId);
  if (result.ok) throw new Error(`expected ${action.type} to be refused`);
  return result.error;
}
