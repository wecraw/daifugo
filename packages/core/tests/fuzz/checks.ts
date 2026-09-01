/**
 * The properties the fuzz harness holds a random match to, beyond invariants
 * 21-23 (§12.3 test 24, §4.5).
 *
 * Invariants 21-23 live in `tests/invariants.ts` because every engine test
 * asserts them too. What is here is the set a hand-written test cannot cover the
 * same way: statements about *any* reachable state and *any* round end, which
 * only become checkable when something is generating states nobody wrote down.
 *
 * Everything returns a list of human-readable failures rather than throwing.
 * Shrinking replays a candidate log and asks whether the same failure comes back
 * (`harness.ts`), so a failure has to be a comparable value, not an exception.
 */
import { activePlayerId } from "../../src/engine.js";
import { finishOrderOf } from "../../src/roles.js";
import { hasDropped, isInRound, seatingOf } from "../../src/turnOrder.js";
import type { GameState } from "../../src/types.js";

/**
 * What must hold of a single state, whatever path reached it.
 *
 * Two facts, both of which a demotion (§4.5) or a mid-round leave (§7.7) is the
 * likeliest way to break. A player who is out of the round holds no cards — their
 * hand went to the graveyard, which is what keeps conservation at 54 while they
 * stop playing — and nothing in the round points at them: not the turn, not a
 * 7-pass target, not the owner of a pending action nobody could answer.
 */
export function stateErrors(state: GameState): string[] {
  const errors: string[] = [];
  if (state.status === "LOBBY") return errors;

  const seating = seatingOf(state);
  for (const id of state.turnOrder) {
    const held = state.hands[id]?.length ?? 0;
    if (!isInRound(id, seating) && held > 0) {
      errors.push(`${id} is out of the round but still holds ${held} cards`);
    }
  }

  if (state.status !== "IN_PROGRESS") return errors;

  const active = activePlayerId(state);
  if (active === null) errors.push("the round is in progress with no active seat");
  else if (!isInRound(active, seating)) {
    errors.push(`the turn advanced to ${active}, who is out of the round`);
  }

  const pending = state.pendingAction;
  if (pending !== null) {
    const owner = pending.type === "RESOLVE_7_PASS" ? pending.sourcePlayerId : pending.playerId;
    if (!state.turnOrder.includes(owner)) {
      errors.push(`${pending.type} is owed by ${owner}, who is not at the table`);
    }
    if (pending.type === "RESOLVE_7_PASS" && !isInRound(pending.targetPlayerId, seating)) {
      errors.push(`7-pass targets ${pending.targetPlayerId}, who is out of the round`);
    }
  }

  return errors;
}

/**
 * What must hold of the finish order the moment a round ends (§4.1, §4.5).
 *
 * `demotedIds` are the players miyako-ochi threw out during *this* round, read
 * from the history the harness watched go by. The demotion is the one placement
 * the spec makes absolute: dead last, below even a player who left afterwards
 * (§7.7), so it is asserted separately from the dropped block as a whole.
 */
export function roundEndErrors(
  before: GameState,
  after: GameState,
  demotedIds: readonly string[],
): string[] {
  const ended = before.status === "IN_PROGRESS" || before.status === "EXCHANGE";
  const isEnd = after.status === "ROUND_END" || after.status === "MATCH_END";
  if (!ended || !isEnd) return [];

  const errors: string[] = [];
  const order = finishOrderOf(after.finishedPlayerIds, after.turnOrder, after.droppedPlayerIds);

  if ([...order].sort().join(",") !== [...after.turnOrder].sort().join(",")) {
    errors.push(
      `the finish order ${order.join(",")} is not a permutation of the roster ${after.turnOrder.join(",")}`,
    );
  }

  const seating = seatingOf(after);
  const held = order.filter((id) => !hasDropped(id, seating));
  const lowestHolder = held.length === 0 ? -1 : order.indexOf(held[held.length - 1] ?? "");
  for (const id of order.filter((player) => hasDropped(player, seating))) {
    if (order.indexOf(id) < lowestHolder) {
      errors.push(`${id} was dropped but finished above a player who still held cards`);
    }
  }

  const last = order[order.length - 1];
  for (const demoted of demotedIds) {
    if (!after.turnOrder.includes(demoted)) continue;
    if (last !== demoted) {
      errors.push(`miyako-ochi demoted ${demoted}, but ${String(last)} finished last`);
    }
  }

  return errors;
}
