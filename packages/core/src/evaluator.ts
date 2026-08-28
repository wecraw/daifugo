/**
 * The evaluator (§10.3): legality against the trick top, comparison under
 * `effectiveInverted`, the suit lock, and legal-move generation.
 *
 * This is the single source of truth shared by server and client. The server
 * validates a play with it and the client dims the hand, labels the disabled Play
 * button, and auto-passes with it, so the two can never disagree about what is
 * legal. Nothing here reads `GameState`: callers pass a `TrickContext`, built once
 * per turn, which keeps the XOR of §5.2 from being re-derived — or half-derived —
 * at each call site.
 *
 * Every rejection carries its own `ErrorCode` (§8.0). §10.6 renders the reason
 * inline on the disabled Play button, so `checkLegality` returns *why* rather than
 * a boolean, and there is deliberately no `ILLEGAL_PLAY` bucket to fall into.
 *
 * Legality reads the *resolved* rank the parser produced, never `card.isJoker`
 * (§5.4). The sole exception is the beater side of the Spade-3 counter, which is
 * the one place in the game where card identity matters.
 */
import { comboStrength, parseCombo } from "./combo.js";
import { DEFAULT_HOUSE_RULES } from "./config.js";
import { SPADE_3_ID } from "./deck.js";
import type { ErrorCode } from "./i18n-keys.js";
import { compareStrength, effectiveInverted, isStronger } from "./strength.js";
import type { Card, GameState, HouseRulesConfig, PlayCombo, Rank, Result, Suit } from "./types.js";
import { err, ok } from "./types.js";

/**
 * Everything about the trick that bears on legality.
 *
 * Every field is optional and defaults to the start-of-trick value, so a test or
 * a client can ask "what could I lead?" with `{}`. `config` defaults to all nine
 * rules on (§0).
 */
export interface TrickContext {
  /** The combo on top of the trick, or null when leading. */
  top?: PlayCombo | null;
  /** §5.2, both halves kept separate so the XOR happens in exactly one place. */
  isRevolution?: boolean;
  trickInverted?: boolean;
  /** The exact suit multiset a play must match (§6). Null outside a lock. */
  suitLock?: readonly Suit[] | null;
  config?: Readonly<HouseRulesConfig>;
}

/** The trick context of a live game state. The engine's bridge into this file. */
export function trickContextOf(
  state: Pick<GameState, "currentTrick" | "isRevolution" | "trickInverted" | "suitLock" | "config">,
): TrickContext {
  return {
    top: state.currentTrick[state.currentTrick.length - 1]?.combo ?? null,
    isRevolution: state.isRevolution,
    trickInverted: state.trickInverted,
    suitLock: state.suitLock,
    config: state.config,
  };
}

/** `effectiveInverted` for a context (§5.2). */
export function invertedIn(ctx: TrickContext): boolean {
  return effectiveInverted(ctx.isRevolution ?? false, ctx.trickInverted ?? false);
}

function configIn(ctx: TrickContext): Readonly<HouseRulesConfig> {
  return ctx.config ?? DEFAULT_HOUSE_RULES;
}

/* -------------------------------------------------------------------------- */
/* Legality                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Phase 0's legality checks against the trick top (§7.1), in spec order: count,
 * then strength, then the suit lock.
 *
 * The order is the reason this returns a `Result` rather than a boolean. A
 * selection can be wrong in several ways at once, and the code the player sees on
 * the Play button (§10.6) should name the first thing they would fix — "wrong
 * number of cards", not "not high enough", when it is both.
 *
 * Shape checks (mixed ranks, an unbound joker beside a numbered card) belong to
 * the parser and have already run: this takes a `PlayCombo`, which by
 * construction is a well-formed N-of-a-kind.
 */
export function checkLegality(
  candidate: PlayCombo,
  ctx: TrickContext = {},
): Result<PlayCombo, ErrorCode> {
  const top = ctx.top ?? null;
  if (top !== null) {
    if (top.cards.length !== candidate.cards.length) return err("COMBO_COUNT_MISMATCH");
    if (!canBeat(top, candidate, ctx)) return err("TOO_WEAK");
  }

  const lock = ctx.suitLock ?? null;
  if (lock !== null && !matchesSuitLock(candidate, lock)) return err("SUIT_LOCK_MISMATCH");

  return ok(candidate);
}

/**
 * Does `candidate` beat `top`?
 *
 * Count must match exactly and the resolved ranks are compared by strength index
 * under `effectiveInverted` (§5.1, §5.3). Equal strength does not beat. Leading —
 * a null top — is always allowed.
 *
 * The Spade-3 counter is the one addition, and it is not a strength adjustment:
 * it makes a specific card legal over a specific top, and it is checked before the
 * comparison because the comparison would say no.
 */
export function canBeat(
  top: PlayCombo | null,
  candidate: PlayCombo,
  ctx: TrickContext = {},
): boolean {
  if (top === null) return true;
  if (top.cards.length !== candidate.cards.length) return false;
  if (spade3BeatsJoker(top, candidate, ctx)) return true;
  return isStronger(comboStrength(candidate), comboStrength(top), invertedIn(ctx));
}

/**
 * The 3 of Spades over a single pure joker (§6).
 *
 * On the **victim** side the check reads the binding, via `isPureJokerPlay`, and
 * never `card.isJoker`: a joker played as a 10 is a 10 and the 3 of Spades does
 * not beat it (§5.4). A pair of jokers is out of scope — the counter is a single's
 * privilege — and the count check above has already rejected a single against it.
 *
 * On the **beater** side the card id must be the true `S-3`. This is the sole
 * place in the game where card identity matters rather than resolved rank: a joker
 * bound to the 3 of Spades resolves to a 3 of spades in every observable way and
 * still does not qualify, because the counter is that card's privilege, not the
 * rank's (§5.4).
 *
 * Under revolution the exception is inert rather than absent: a 3 is the strongest
 * card while inverted and a pure joker the weakest (§5.2), so the comparison below
 * would have said yes anyway. Nothing needs to switch it off, and switching it off
 * would only add a branch that no play can distinguish.
 */
function spade3BeatsJoker(top: PlayCombo, candidate: PlayCombo, ctx: TrickContext): boolean {
  if (!configIn(ctx).spade3BeatsJoker) return false;
  if (top.cards.length !== 1 || !top.isPureJokerPlay) return false;
  if (candidate.cards.length !== 1) return false;
  const beater = candidate.cards[0];
  return beater !== undefined && beater.id === SPADE_3_ID;
}

/**
 * Does the combo's suit multiset match an active lock exactly (§6)?
 *
 * Exactly, not by overlap: hearts+spades satisfies a {H,S} lock, hearts+diamonds
 * does not. A pure joker contributes a null suit and wildcards through any lock,
 * so it fills whichever slot is left over. A *bound* joker is held to the suit it
 * was bound to, like every other rule that reads the resolved view (§5.4).
 *
 * Exported because the shibari rule (§6) sets the lock from the same notion of
 * "these two plays share a suit multiset" that this reads it with.
 */
export function matchesSuitLock(combo: PlayCombo, lock: readonly Suit[]): boolean {
  const remaining: (Suit | null)[] = [...lock];
  let wildcards = 0;

  for (const suit of combo.suits) {
    if (suit === null) {
      wildcards++;
      continue;
    }
    const index = remaining.indexOf(suit);
    if (index === -1) return false;
    remaining.splice(index, 1);
  }

  // Whatever the bound suits did not claim must be exactly covered by the pure
  // jokers, which also rejects a combo that is shorter or longer than the lock.
  return remaining.length === wildcards;
}

/* -------------------------------------------------------------------------- */
/* Legal-move generation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every legal play available from `hand` (§10.3), weakest first.
 *
 * Used by the timeout auto-play (§7.6), the client's weighted layout and dimming
 * (§10.3), the auto-pass check (§10.7), and the fuzz harness (§12.3), so it must
 * agree exactly with `checkLegality` — which it does by construction: every
 * candidate is run through it.
 *
 * With N-of-a-kind as the only shape (§5.3) there is no subset enumeration to do
 * over the hand as a whole. Group by rank, take the subsets *within* a rank — a
 * rank holds at most four cards, and the subsets differ only in suit, which the
 * suit lock can tell apart — then attach any subset of the jokers. The joker's
 * binding is resolved per card set by the parser's default rule (§5.5), so each
 * set yields at most one move: the strongest legal form of that selection. The
 * client's binding picker (§10.5) cycles the alternatives from there.
 *
 * The cost is therefore bounded by the hand's rank structure, not by 2^n: an
 * 18-card hand is a few hundred parses, well inside a per-turn budget.
 */
export function generateLegalMoves(hand: readonly Card[], ctx: TrickContext = {}): PlayCombo[] {
  const moves: PlayCombo[] = [];
  forEachLegalMove(hand, ctx, (move) => {
    moves.push(move);
    return true;
  });

  const inverted = invertedIn(ctx);
  return moves.sort((a, b) => {
    const byStrength = compareStrength(comboStrength(a), comboStrength(b), inverted);
    if (byStrength !== 0) return byStrength;
    const byCount = a.cards.length - b.cards.length;
    if (byCount !== 0) return byCount;
    return moveKey(a) < moveKey(b) ? -1 : 1;
  });
}

/**
 * Is any play legal at all?
 *
 * Distinct from "nothing good": auto-pass fires only on a genuinely empty legal
 * set (§10.7), so this stops at the first move rather than pricing the whole set.
 */
export function hasLegalMove(hand: readonly Card[], ctx: TrickContext = {}): boolean {
  let found = false;
  forEachLegalMove(hand, ctx, () => {
    found = true;
    return false;
  });
  return found;
}

/** Visit each legal move. `visit` returns false to stop the search. */
function forEachLegalMove(
  hand: readonly Card[],
  ctx: TrickContext,
  visit: (move: PlayCombo) => boolean,
): void {
  const requiredCount = ctx.top?.cards.length ?? null;
  const jokers = hand.filter((card) => card.isJoker);
  const jokerSubsets = subsets(jokers);
  const isLegal = (combo: PlayCombo): boolean => checkLegality(combo, ctx).ok;
  const comboContext = { top: ctx.top ?? null, inverted: invertedIn(ctx), isLegal };

  const tryCards = (selection: readonly Card[]): boolean => {
    if (selection.length === 0) return true;
    if (requiredCount !== null && selection.length !== requiredCount) return true;
    const parsed = parseCombo(orderByHand(selection, hand), undefined, comboContext);
    if (!parsed.ok || !isLegal(parsed.value)) return true;
    return visit(parsed.value);
  };

  for (const group of groupByRank(hand).values()) {
    for (const naturals of subsets(group)) {
      if (naturals.length === 0) continue;
      for (const withJokers of jokerSubsets) {
        if (!tryCards([...naturals, ...withJokers])) return;
      }
    }
  }

  // Joker-only selections: a lone joker, or the pair of them (§5.3). They have no
  // rank group to hang off, so they are enumerated once here.
  for (const jokerSet of jokerSubsets) {
    if (!tryCards(jokerSet)) return;
  }
}

/** Naturals grouped by rank, in first-seen order. Jokers have no rank to group by. */
function groupByRank(hand: readonly Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();
  for (const card of hand) {
    if (card.isJoker || card.rank === null) continue;
    const group = groups.get(card.rank);
    if (group === undefined) groups.set(card.rank, [card]);
    else group.push(card);
  }
  return groups;
}

/** Every subset, including the empty one. Only ever called on 4 cards or fewer. */
function subsets(cards: readonly Card[]): Card[][] {
  let result: Card[][] = [[]];
  for (const card of cards) {
    result = result.flatMap((prefix) => [prefix, [...prefix, card]]);
  }
  return result;
}

/** Cards in the order they sit in the hand, so a generated move reads naturally. */
function orderByHand(selection: readonly Card[], hand: readonly Card[]): Card[] {
  return hand.filter((card) => selection.includes(card));
}

/** A total order over card sets, so equally strong moves come out deterministically. */
function moveKey(combo: PlayCombo): string {
  return combo.cards
    .map((card) => card.id)
    .sort()
    .join(",");
}

/* -------------------------------------------------------------------------- */
/* Memoisation (§10.3)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The cache key of §10.3: `(hand, trickTop, isRevolution, trickInverted,
 * suitLock)`.
 *
 * The hand is keyed as a *set* — sorted card ids — because a re-sort of the
 * player's hand (§10.8) does not change what is legal. The top is keyed by its
 * resolved view as well as its cards, since a joker played bound and the same
 * joker played pure are different tops.
 *
 * `spade3BeatsJoker` joins the five because it is the one config flag that
 * changes a legality answer here. It is constant for a round, so it never causes
 * a miss in practice; leaving it out would make the cache wrong across a rules
 * change in the lobby, which is cheaper to prevent than to debug.
 */
export function legalMovesKey(hand: readonly Card[], ctx: TrickContext = {}): string {
  const cardIds = hand
    .map((card) => card.id)
    .sort()
    .join(",");
  const lock = ctx.suitLock === null || ctx.suitLock === undefined ? "-" : ctx.suitLock.join("");
  return [
    cardIds,
    topKey(ctx.top ?? null),
    ctx.isRevolution === true ? "R" : "-",
    ctx.trickInverted === true ? "J" : "-",
    lock,
    configIn(ctx).spade3BeatsJoker ? "S3" : "-",
  ].join("|");
}

function topKey(top: PlayCombo | null): string {
  if (top === null) return "-";
  const rank = top.resolvedRank === null ? "JKR" : String(top.resolvedRank);
  return `${moveKey(top)}:${rank}:${top.suits.map((suit) => suit ?? "*").join("")}`;
}

/**
 * A memoised `generateLegalMoves`, for the client to hold across a turn (§10.3).
 *
 * The cached array is returned by reference and must not be mutated — the combos
 * in it are frozen; the array is shared. Core itself keeps no module-level cache:
 * `applyAction` is pure, and a cache that outlived a call would be state hiding
 * inside a reducer.
 */
export function createLegalMoveCache(): (
  hand: readonly Card[],
  ctx?: TrickContext,
) => readonly PlayCombo[] {
  const cache = new Map<string, readonly PlayCombo[]>();
  return (hand, ctx = {}) => {
    const key = legalMovesKey(hand, ctx);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const moves = Object.freeze(generateLegalMoves(hand, ctx));
    cache.set(key, moves);
    return moves;
  };
}
