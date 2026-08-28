/**
 * Walking `turnOrder` (§7).
 *
 * `turnOrder` is never mutated mid-round and always holds every player, finished
 * and departed included (§2). Eligibility is therefore *derived* here rather than
 * enforced by removal: "eligible" means not finished and not in `passedPlayerIds`
 * (§7.5), and every seat advance in the game is a walk over that predicate.
 *
 * Two different predicates matter and they are not interchangeable. 5-skip counts
 * *eligible* seats, so a player who has already passed costs the skip nothing
 * (§6). 7-pass targets the nearest *non-finished* player, passed or not, because a
 * passed player is still in the round and will pick the cards up next trick (§6).
 * Keeping both here, rather than inlining a loop at each call site, is what stops
 * the two from quietly converging.
 */
import type { GameState } from "./types.js";

/** The parts of a state a seat walk reads. */
export interface SeatingContext {
  turnOrder: readonly string[];
  finishedPlayerIds: readonly string[];
  /** Absent is the same as empty: a fresh trick has nobody locked out. */
  passedPlayerIds?: readonly string[];
}

/** The seating context of a live game state. */
export function seatingOf(
  state: Pick<GameState, "turnOrder" | "finishedPlayerIds" | "passedPlayerIds">,
): SeatingContext {
  return {
    turnOrder: state.turnOrder,
    finishedPlayerIds: state.finishedPlayerIds,
    passedPlayerIds: state.passedPlayerIds,
  };
}

export function hasFinished(playerId: string, seating: SeatingContext): boolean {
  return seating.finishedPlayerIds.includes(playerId);
}

export function hasPassed(playerId: string, seating: SeatingContext): boolean {
  return seating.passedPlayerIds?.includes(playerId) ?? false;
}

/** Not finished and not passed: still owed a turn in this trick (§7.5). */
export function isEligible(playerId: string, seating: SeatingContext): boolean {
  return !hasFinished(playerId, seating) && !hasPassed(playerId, seating);
}

export function eligiblePlayerIds(seating: SeatingContext): string[] {
  return seating.turnOrder.filter((id) => isEligible(id, seating));
}

export function nonFinishedPlayerIds(seating: SeatingContext): string[] {
  return seating.turnOrder.filter((id) => !hasFinished(id, seating));
}

/** Index into `turnOrder`, or -1. Seat order is the play order, left-hand first. */
export function seatIndexOf(playerId: string, seating: SeatingContext): number {
  return seating.turnOrder.indexOf(playerId);
}

/**
 * The next seat to the left of `fromIndex` satisfying `predicate`, or null when
 * no seat at the table does.
 *
 * The walk starts at `fromIndex + 1`, so it never returns `fromIndex` itself
 * unless a full lap comes back to it — which is the honest answer when the player
 * at `fromIndex` is the last one standing.
 */
export function nextSeatWhere(
  seating: SeatingContext,
  fromIndex: number,
  predicate: (playerId: string) => boolean,
): number | null {
  const count = seating.turnOrder.length;
  if (count === 0) return null;
  for (let offset = 1; offset <= count; offset++) {
    const index = (((fromIndex + offset) % count) + count) % count;
    const playerId = seating.turnOrder[index];
    if (playerId !== undefined && predicate(playerId)) return index;
  }
  return null;
}

/** `nextSeatWhere`, repeated `steps` times. Null if the walk ever runs out. */
export function advanceSeats(
  seating: SeatingContext,
  fromIndex: number,
  steps: number,
  predicate: (playerId: string) => boolean,
): number | null {
  let index = fromIndex;
  for (let taken = 0; taken < steps; taken++) {
    const next = nextSeatWhere(seating, index, predicate);
    if (next === null) return null;
    index = next;
  }
  return index;
}

/** The next eligible seat (§7.1 Phase F). */
export function nextEligibleIndex(
  seating: SeatingContext,
  fromIndex: number,
  steps = 1,
): number | null {
  return advanceSeats(seating, fromIndex, steps, (id) => isEligible(id, seating));
}

/** The next seat still in the round, passed or not (§6 7-pass, §7.4). */
export function nextNonFinishedIndex(
  seating: SeatingContext,
  fromIndex: number,
  steps = 1,
): number | null {
  return advanceSeats(seating, fromIndex, steps, (id) => !hasFinished(id, seating));
}
