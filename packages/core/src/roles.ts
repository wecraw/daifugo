/**
 * Roles, exchange pairing, and forced selection (§4).
 *
 * Everything here is a function of the round's finish order. Roles are derived
 * from `finishedPlayerIds` plus whoever was still holding cards (§4.1), pairing is
 * derived from the roles' positions in that same order (§4.2), and the poor side's
 * selection is derived from their hand (§4.3). Nothing is stored that could drift
 * from the order it came from.
 *
 * Strength is read in the **standard** orientation throughout: revolution does not
 * survive the round it fired in, so the round that is about to start is upright
 * whatever happened in the one that just ended (§4.3).
 *
 * The exchange is simultaneous. Every function that touches submissions returns a
 * new `ExchangeState` or a new hands map rather than mutating one, so the engine
 * can apply the whole table in a single `stateVersion` bump (§2) and card
 * conservation is checkable at one place: `applyExchange`.
 */
import { SPADE_3_ID } from "./deck.js";
import { takeFromHand } from "./hand.js";
import type { ErrorCode } from "./i18n-keys.js";
import { sortByStrength } from "./strength.js";
import type { Card, ExchangeState, Result, Role } from "./types.js";
import { err, ok } from "./types.js";

/** §4.4: 60 seconds on entry to `EXCHANGE`, the same as a turn (§7.6). */
export const EXCHANGE_DURATION_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Roles (§4.1)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The round's finish order, best first: everyone who went out, in the order they
 * did, then whoever was still holding cards, then the dropped block (§4.1).
 *
 * The three bands are what make the order total. Normally only one player is
 * still holding cards and they are last place; the filter rather than a lookup is
 * so that a state caught mid-sweep still produces an order over every seat.
 *
 * `droppedPlayerIds` are the players who left the round without an agari — a
 * miyako-ochi demotion (§4.5) or a mid-round leave (§7.7). They rank below
 * everyone who still held cards, **whatever those hands looked like**: a demoted
 * DAI_FUGO holding eleven cards is still above nobody. The block arrives already
 * ordered best-placed first, so it is appended as it stands and its last element
 * is dead last — the engine owns keeping a miyako-ochi entry there when a later
 * leave inserts into the same block.
 *
 * An id in both lists is taken as dropped: the drop is the later, and lower, of
 * the two facts.
 */
export function finishOrderOf(
  finishedPlayerIds: readonly string[],
  turnOrder: readonly string[],
  droppedPlayerIds: readonly string[] = [],
): string[] {
  const dropped = droppedPlayerIds.filter((id) => turnOrder.includes(id));
  const finished = finishedPlayerIds.filter(
    (id) => turnOrder.includes(id) && !dropped.includes(id),
  );
  const holding = turnOrder.filter((id) => !finished.includes(id) && !dropped.includes(id));
  return [...finished, ...holding, ...dropped];
}

/**
 * The §4.1 table. `finishOrder` is best-to-worst and must already include the
 * final remaining player — `finishOrderOf` is how you get one.
 *
 * `FUGO` and `HINMIN` exist only from N = 4; at N = 3 the table collapses to
 * `DAI_FUGO`, `HEIMIN rank 1`, `DAI_HINMIN`. `HEIMIN.rank` counts from the top and
 * is 1-indexed, so it is the position within the middle band rather than the seat.
 */
export function assignRoles(finishOrder: readonly string[]): Record<string, Role> {
  const count = finishOrder.length;
  const named = count >= 4 ? 2 : 1; // ranks at each end that get a name of their own
  const roles: Record<string, Role> = {};

  finishOrder.forEach((playerId, index) => {
    const fromBottom = count - 1 - index;
    if (index === 0) roles[playerId] = { kind: "DAI_FUGO" };
    else if (fromBottom === 0) roles[playerId] = { kind: "DAI_HINMIN" };
    else if (index === 1 && named === 2) roles[playerId] = { kind: "FUGO" };
    else if (fromBottom === 1 && named === 2) roles[playerId] = { kind: "HINMIN" };
    else roles[playerId] = { kind: "HEIMIN", rank: index - named + 1 };
  });

  return roles;
}

/* -------------------------------------------------------------------------- */
/* Pairing (§4.2)                                                             */
/* -------------------------------------------------------------------------- */

export interface ExchangePair {
  /** The i-th player from the top. Chooses freely (§4.3). */
  richId: string;
  /** The i-th player from the bottom. Gives their strongest, forced (§4.3). */
  poorId: string;
  /** Cards moving in **each** direction. */
  count: number;
}

/**
 * The i-th from the top paired with the i-th from the bottom, for
 * `i = 1 .. floor(N/2)`, exchanging `count(i) = floor(N/2) - i + 1` cards each way.
 *
 * At odd N the loop simply never reaches the exact middle seat, which is what
 * "the middle player exchanges nothing" means — they are absent from the result
 * rather than present with a count of zero, so `required` never carries a player
 * who owes nothing.
 *
 * Top pair first, so the result reads down the §4.2 table.
 */
export function exchangePairs(finishOrder: readonly string[]): ExchangePair[] {
  const count = finishOrder.length;
  const pairCount = Math.floor(count / 2);
  const pairs: ExchangePair[] = [];

  for (let i = 1; i <= pairCount; i++) {
    const richId = finishOrder[i - 1];
    const poorId = finishOrder[count - i];
    if (richId === undefined || poorId === undefined) continue;
    pairs.push({ richId, poorId, count: pairCount - i + 1 });
  }

  return pairs;
}

/* -------------------------------------------------------------------------- */
/* Selection (§4.3, §4.4)                                                     */
/* -------------------------------------------------------------------------- */

/** Strongest first. Standard orientation: revolution does not carry over (§4.3). */
function strongestFirst(hand: readonly Card[]): Card[] {
  return sortByStrength(hand).reverse();
}

/**
 * The poor side's forced give: their `count` strongest cards, with the 3 of Spades
 * excluded (§4.3).
 *
 * The exclusion is the point of the rule — the 3 of Spades is the one card that
 * beats a lone joker (§5.4), so handing it up with the rest of the hand would make
 * the counter unreachable from the bottom of the table. It is unconditional: a
 * hand with fewer eligible cards than the count yields a short list rather than
 * reaching for the protected card.
 *
 * That short list cannot arise from a legal deal — the exchange runs on full
 * hands, so the smallest is 6 cards against a largest count of 4 — so the engine
 * is entitled to treat `forced[p].length < required[p]` as the bug it would be.
 *
 * Returned strongest first: §10 renders this read-only to the poor player, and the
 * first card is the one they most want to see going.
 */
export function forcedSelection(hand: readonly Card[], count: number): string[] {
  return strongestFirst(hand)
    .filter((card) => card.id !== SPADE_3_ID)
    .slice(0, count)
    .map((card) => card.id);
}

/**
 * The rich side's auto-give on expiry: their `count` weakest cards (§4.4).
 *
 * No exclusion here. The rich player may give anything, so the 3 of Spades is a
 * legal — and, being the weakest card in the standard order, the likeliest — thing
 * for the timer to hand over.
 *
 * Returned weakest first.
 */
export function weakestSelection(hand: readonly Card[], count: number): string[] {
  return sortByStrength(hand)
    .slice(0, count)
    .map((card) => card.id);
}

/* -------------------------------------------------------------------------- */
/* The phase (§4.3, §4.4)                                                     */
/* -------------------------------------------------------------------------- */

/** Round 1 has no previous round to derive roles from, so it has no exchange (§4.3). */
export function needsExchange(roundNumber: number): boolean {
  return roundNumber > 1;
}

/**
 * The exchange state at phase start (§4.3).
 *
 * Both sides appear in `required` and `partner` — the transfer is symmetric and
 * the counts are equal — but only the poor side appears in `forced`, which is what
 * makes `forced` the test for "this player has nothing to submit".
 */
export function createExchangeState(
  finishOrder: readonly string[],
  hands: Readonly<Record<string, readonly Card[]>>,
): ExchangeState {
  const required: Record<string, number> = {};
  const partner: Record<string, string> = {};
  const forced: Record<string, string[]> = {};

  for (const pair of exchangePairs(finishOrder)) {
    required[pair.richId] = pair.count;
    required[pair.poorId] = pair.count;
    partner[pair.richId] = pair.poorId;
    partner[pair.poorId] = pair.richId;
    forced[pair.poorId] = forcedSelection(hands[pair.poorId] ?? [], pair.count);
  }

  return { required, partner, forced, submitted: {} };
}

/** True for the poor side of a pair, whose cards were chosen for them (§4.3). */
export function isForced(exchange: ExchangeState, playerId: string): boolean {
  return exchange.forced[playerId] !== undefined;
}

/** The rich side: everyone the phase is still waiting on. */
export function richPlayerIds(exchange: ExchangeState): string[] {
  return Object.keys(exchange.required).filter((id) => !isForced(exchange, id));
}

/** Every rich player has chosen, so the transfer can apply immediately (§4.3). */
export function isExchangeComplete(exchange: ExchangeState): boolean {
  return richPlayerIds(exchange).every((id) => exchange.submitted[id] !== undefined);
}

/**
 * Record a rich player's `EXCHANGE_CARDS` choice, returning a new state.
 *
 * Each rejection carries its own code (§8.0): the poor side is told their
 * selection is forced rather than merely refused, and a second submission is
 * distinguished from a wrong count, because §10.6 renders the reason.
 */
export function submitExchange(
  exchange: ExchangeState,
  playerId: string,
  cardIds: readonly string[],
  hand: readonly Card[],
): Result<ExchangeState, ErrorCode> {
  const required = exchange.required[playerId];
  if (required === undefined) return err("NOT_EXCHANGE_PARTICIPANT");
  if (isForced(exchange, playerId)) return err("EXCHANGE_FORCED");
  if (exchange.submitted[playerId] !== undefined) return err("EXCHANGE_ALREADY_SUBMITTED");
  if (cardIds.length !== required) return err("WRONG_CARD_COUNT");

  const split = takeFromHand(hand, cardIds);
  if (!split.ok) return split;

  return ok({
    ...exchange,
    submitted: { ...exchange.submitted, [playerId]: [...cardIds] },
  });
}

/**
 * Fill in the weakest cards for every rich player who has not submitted (§4.4),
 * returning a new state. Anyone who did submit is left exactly as they were.
 *
 * The engine calls this when `TICK` crosses the deadline, then applies, so the
 * auto-given ids exist on the state to write `history.exchangeAutoGave` from.
 */
export function autoFillExchange(
  exchange: ExchangeState,
  hands: Readonly<Record<string, readonly Card[]>>,
): ExchangeState {
  const submitted: Record<string, string[]> = { ...exchange.submitted };

  for (const playerId of richPlayerIds(exchange)) {
    if (submitted[playerId] !== undefined) continue;
    submitted[playerId] = weakestSelection(hands[playerId] ?? [], exchange.required[playerId] ?? 0);
  }

  return { ...exchange, submitted };
}

/**
 * Apply every transfer at once, returning new hands (§4.3).
 *
 * Atomic in the sense the spec means: each hand is read once, in its pre-exchange
 * form, before anything is written, so a pair cannot see the cards it is about to
 * be given while choosing what to hand over. `takeFromHand` partitions each hand
 * exactly, so `sum(hands)` is unchanged and card conservation holds by
 * construction.
 *
 * A rich player with nothing on record is treated as a deadline expiry and gives
 * their weakest cards (§4.4) — that is the only way an unsubmitted player can
 * reach application, since submission from all of them is what otherwise triggers
 * it. Players outside the exchange, and the middle seat at odd N, keep their hand
 * by identity.
 *
 * Iteration is over the participant ids in sorted order, so the result is a
 * function of the state's contents and not of the key order a serialization round
 * trip happened to produce: two servers replaying one action must write identical
 * hands (§14).
 */
export function applyExchange(
  exchange: ExchangeState,
  hands: Readonly<Record<string, readonly Card[]>>,
): Result<Record<string, Card[]>, ErrorCode> {
  const participants = Object.keys(exchange.required).sort();
  const given: Record<string, Card[]> = {};
  const next: Record<string, Card[]> = {};

  for (const [playerId, hand] of Object.entries(hands)) {
    next[playerId] = [...hand];
  }

  for (const playerId of participants) {
    const hand = hands[playerId] ?? [];
    const cardIds =
      exchange.forced[playerId] ??
      exchange.submitted[playerId] ??
      weakestSelection(hand, exchange.required[playerId] ?? 0);

    const split = takeFromHand(hand, cardIds);
    if (!split.ok) return split;
    given[playerId] = split.value.selected;
    next[playerId] = split.value.remaining;
  }

  for (const playerId of participants) {
    const recipient = exchange.partner[playerId];
    const cards = given[playerId];
    if (recipient === undefined || cards === undefined) continue;
    next[recipient] = [...(next[recipient] ?? []), ...cards];
  }

  return ok(next);
}

/* -------------------------------------------------------------------------- */
/* Scoring (§9)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The round's points: `N - finishPosition` over the §4.1 finish order, so the
 * winner of a 5-player round scores 4 and last place scores 0.
 *
 * Position is 1-indexed, which is what makes last place score nothing — including
 * a player demoted by miyako-ochi (§4.5), who is last place whatever their hand
 * held. The result is this round's award alone; the engine adds it onto the
 * standings it carries across the match.
 */
export function roundPoints(finishOrder: readonly string[]): Record<string, number> {
  const count = finishOrder.length;
  const points: Record<string, number> = {};
  finishOrder.forEach((playerId, index) => {
    points[playerId] = count - (index + 1);
  });
  return points;
}
