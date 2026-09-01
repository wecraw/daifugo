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

/** The ids a deal is entitled to seat: everyone staying, plus everyone arriving (§7.7). */
function rosterAfterChanges(state: GameState): string[] {
  const leaving = new Set(state.pendingLeaves);
  const staying = state.turnOrder.filter((id) => !leaving.has(id));
  const arriving = state.pendingJoins
    .map((player) => player.id)
    .filter((id) => !leaving.has(id) && !staying.includes(id));
  return [...staying, ...arriving];
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
 * Invariants 21-23 across one transition, as a list of human-readable failures.
 *
 * Separate from `assertInvariants` because the fuzz harness (§12.3 test 24) needs
 * the same three checks without `expect`: a fuzz failure has to be *reported*
 * with its seed and action log rather than thrown out of whichever action
 * happened to break it, and shrinking replays a candidate log expecting the same
 * failure text back.
 *
 * `turnOrder` is compared elementwise unless the action crossed a round boundary
 * — a deal is exactly when reseating is allowed to rewrite it (§3.2) — which is
 * detected by the round number changing rather than by trusting the action type.
 */
export function transitionErrors(before: GameState, after: GameState): string[] {
  const errors: string[] = [];

  // 21. A room in `LOBBY` has not been dealt, so it holds no cards at all; every
  // state from the deal onward holds all 54, each exactly once.
  if (after.status !== "LOBBY") {
    const count = countCards(after);
    if (count !== DECK_SIZE) {
      errors.push(`invariant 21: hands + trick + graveyard is ${count}, not ${DECK_SIZE}`);
    }
    const ids = cardIds(after);
    if (new Set(ids).size !== ids.length) {
      errors.push(`invariant 21: a card id appears twice (${duplicates(ids).join(" ")})`);
    }
  }

  // 22
  if (after.turnOrder.length !== after.players.length) {
    errors.push(
      `invariant 22: turnOrder has ${after.turnOrder.length} seats for ${after.players.length} players`,
    );
  }
  if (before.status === "LOBBY" && after.status === "LOBBY") {
    // The lobby is not a round: seats come and go as players arrive and leave.
  } else if (after.roundNumber === before.roundNumber) {
    if (after.turnOrder.join(",") !== before.turnOrder.join(",")) {
      errors.push(
        `invariant 22: turnOrder was rewritten mid-round, ${before.turnOrder.join(",")} -> ${after.turnOrder.join(",")}`,
      );
    }
  } else {
    // A deal is the one point reseating may rewrite `turnOrder` (§3.2), and the
    // one boundary at which a queued join or leave applies (§7.7). Anything else
    // appearing or disappearing is the bug this invariant is here to catch.
    const dealt = [...after.turnOrder].sort().join(",");
    const entitled = rosterAfterChanges(before).sort().join(",");
    if (dealt !== entitled) {
      errors.push(`invariant 22: the deal seated ${dealt}, but the roster was ${entitled}`);
    }
  }

  // 23
  if (after.stateVersion <= before.stateVersion) {
    errors.push(
      `invariant 23: stateVersion did not increase (${before.stateVersion} -> ${after.stateVersion})`,
    );
  }

  return errors;
}

/** The ids appearing more than once, for a readable conservation failure. */
function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return [...twice];
}

/** Invariants 21-23 across one transition, as assertions (§12.3). */
export function assertInvariants(before: GameState, after: GameState): void {
  expect(transitionErrors(before, after)).toEqual([]);
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
