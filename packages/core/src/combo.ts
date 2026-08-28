/**
 * Combo parsing and joker binding resolution (§5.3–§5.5).
 *
 * This is the only place a raw set of `Card`s becomes a `PlayCombo`. Everything
 * downstream — the evaluator, the nine house rules, the history log — reads the
 * *resolved* rank this file produces and never `card.isJoker` (§5.4), so a joker
 * bound to an 8 fires 8-giri without a single rule file knowing jokers exist.
 *
 * N-of-a-kind is the only shape in the game (§5.3). There are no sequences, so
 * `PlayCombo` carries no combo type: the shape is `cards.length` plus one
 * resolved rank, and a selection that does not collapse to a single rank is
 * simply rejected.
 *
 * The client sends explicit bindings; the server validates them and never trusts
 * them (§5.5). When they are absent the default rule picks the strongest legal
 * binding here, on the server, so both sides agree without a round trip.
 */
import { RANKS, SUITS } from "./deck.js";
import type { ErrorCode } from "./i18n-keys.js";
import { compareStrength, isStronger, strengthOf } from "./strength.js";
import type { Card, JokerBinding, PlayCombo, Rank, Result, Suit } from "./types.js";
import { err, ok } from "./types.js";

const RANK_SET: ReadonlySet<unknown> = new Set<unknown>(RANKS);
const SUIT_SET: ReadonlySet<unknown> = new Set<unknown>(SUITS);

/** Deterministic suit tie-break for default resolution. Not a strength order. */
const SUIT_RANK: Readonly<Record<Suit, number>> = Object.freeze({ S: 0, H: 1, D: 2, C: 3 });

/** What the trick top and orientation are, as far as parsing needs to know. */
export interface ComboContext {
  /** The combo currently on top of the trick, or null when leading. */
  top?: PlayCombo | null;
  /** `effectiveInverted` (§5.2). Decides which binding is "strongest". */
  inverted?: boolean;
  /**
   * An extra legality filter applied while enumerating default bindings (§5.5
   * step 2). Combo parsing knows only about count and strength; the evaluator
   * (§10.3) owns the suit lock and the Spade-3 exception and passes them in here,
   * which keeps `combo.ts` at the bottom of the dependency chain.
   */
  isLegal?: (combo: PlayCombo) => boolean;
}

const NO_BINDINGS: ReadonlyMap<string, JokerBinding> = new Map();

/**
 * Parse a selection into a `PlayCombo`, validating supplied bindings or resolving
 * them by the default rule when they are absent.
 *
 * `undefined` bindings request the default; an empty array is an explicit "no
 * joker is bound", which is how a client plays a joker pure over the default's
 * suggestion — under revolution the default binds a led joker to a 3 (§5.5), so
 * without this distinction a deliberate pure play would be unreachable (§10.5).
 */
export function parseCombo(
  cards: readonly Card[],
  bindings?: readonly JokerBinding[],
  context: ComboContext = {},
): Result<PlayCombo, ErrorCode> {
  if (cards.length === 0) return err("EMPTY_SELECTION");
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    return err("DUPLICATE_CARD_IDS");
  }

  // The rank the non-jokers force, checked before anything joker-related: this
  // failure does not depend on a binding, and MIXED_RANKS is the honest reason.
  const naturals = cards.filter((card) => !card.isJoker);
  const forcedRank = naturals[0]?.rank ?? null;
  if (naturals.some((card) => card.rank !== forcedRank)) return err("MIXED_RANKS");

  // Count precedes binding resolution because §5.5 constrains the enumeration by
  // the trick top: with an impossible count, every binding is illegal, and
  // NO_LEGAL_BINDING would be a worse answer than the real reason.
  const top = context.top ?? null;
  if (top !== null && top.cards.length !== cards.length) return err("COMBO_COUNT_MISMATCH");

  if (bindings === undefined) {
    return resolveDefaultBindings(cards, naturals, forcedRank, context);
  }

  const validated = validateBindings(cards, bindings);
  if (!validated.ok) return validated;

  const shapeError = checkShape(cards, validated.value);
  if (shapeError !== null) return err(shapeError);

  return ok(makeCombo(cards, validated.value));
}

/** Strength index of a combo's resolved rank (§5.1). Pure jokers score 13. */
export function comboStrength(combo: PlayCombo): number {
  return strengthOf(combo.resolvedRank);
}

/* -------------------------------------------------------------------------- */
/* Validation of client-supplied bindings                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bindings arrive over the wire, so every field is checked against the deck: an
 * unknown card id, a binding on a numbered card, a rank of 14, or two bindings on
 * one joker are all rejected rather than normalised (§5.5).
 */
function validateBindings(
  cards: readonly Card[],
  bindings: readonly JokerBinding[],
): Result<ReadonlyMap<string, JokerBinding>, ErrorCode> {
  const byCardId = new Map<string, JokerBinding>();
  for (const binding of bindings) {
    const card = cards.find((c) => c.id === binding.cardId);
    if (card === undefined || !card.isJoker) return err("INVALID_BINDING");
    if (!RANK_SET.has(binding.rank) || !SUIT_SET.has(binding.suit)) return err("INVALID_BINDING");
    if (byCardId.has(binding.cardId)) return err("DUPLICATE_BINDING");
    byCardId.set(binding.cardId, {
      cardId: binding.cardId,
      rank: binding.rank,
      suit: binding.suit,
    });
  }
  return ok(byCardId);
}

/**
 * Every card must resolve to one rank (§5.3).
 *
 * A pure joker's rank is "joker", not a number, so it may sit beside another pure
 * joker and nothing else. Alongside anything ranked — a numbered card or a *bound*
 * joker — the fix is to bind it, which is what `JOKER_MUST_BE_BOUND` says.
 */
function checkShape(
  cards: readonly Card[],
  bindingByCardId: ReadonlyMap<string, JokerBinding>,
): ErrorCode | null {
  let rank: Rank | null = null;
  let sawRanked = false;
  let sawPureJoker = false;

  for (const card of cards) {
    const binding = card.isJoker ? bindingByCardId.get(card.id) : undefined;
    if (card.isJoker && binding === undefined) {
      sawPureJoker = true;
      continue;
    }
    const resolved = binding !== undefined ? binding.rank : card.rank;
    if (sawRanked && rank !== resolved) return "MIXED_RANKS";
    rank = resolved;
    sawRanked = true;
  }

  if (sawPureJoker && sawRanked) return "JOKER_MUST_BE_BOUND";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Default resolution (§5.5)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The strongest legal binding.
 *
 * 1. The rank is whatever the non-joker cards force; an all-joker play may take
 *    any rank, or stay pure.
 * 2. Enumerate every binding that produces a legal play — the count is already
 *    fixed, so "legal" here is "beats the top", plus the caller's filter.
 * 3. Take the greatest effective strength. Pure counts as a candidate and wins
 *    ties (it can only tie with itself, but the rule is written out so a future
 *    change to the strength table cannot quietly reorder it).
 *
 * Raw strength is the *only* criterion. The default deliberately ignores §6: it
 * will not pick a 7 to fish for a 7-pass, or avoid an 8 to dodge 8-giri. It is a
 * recommendation the client pre-selects in the binding picker and the player
 * overrides by sending explicit bindings (§10), so guessing at intent here would
 * only make the suggestion harder to predict.
 *
 * Leading a lone joker therefore resolves to pure in the standard orientation,
 * where pure is the strongest card there is - and to a 3 under revolution, where
 * pure is the weakest (§5.2) and the 3 is the strongest.
 */
function resolveDefaultBindings(
  cards: readonly Card[],
  naturals: readonly Card[],
  forcedRank: Rank | null,
  context: ComboContext,
): Result<PlayCombo, ErrorCode> {
  const jokers = cards.filter((card) => card.isJoker);
  if (jokers.length === 0) return ok(makeCombo(cards, NO_BINDINGS));

  const top = context.top ?? null;
  const inverted = context.inverted ?? false;
  const allJokers = naturals.length === 0;

  // Pure is a candidate only when every card is a joker: a pure joker's rank is
  // "joker", so it cannot join a numbered card (§5.3).
  const candidates: PlayCombo[] = allJokers ? [makeCombo(cards, NO_BINDINGS)] : [];

  const rankCandidates: readonly Rank[] = forcedRank === null ? RANKS : [forcedRank];
  for (const rank of rankCandidates) {
    for (const suits of suitAssignments(jokers.length)) {
      const byCardId = new Map<string, JokerBinding>();
      jokers.forEach((joker, index) => {
        byCardId.set(joker.id, { cardId: joker.id, rank, suit: suits[index] as Suit });
      });
      candidates.push(makeCombo(cards, byCardId));
    }
  }

  const legal = candidates.filter((candidate) =>
    isLegalCandidate(candidate, top, inverted, context),
  );
  const best = legal.sort((a, b) => compareCandidates(a, b, inverted))[0];
  return best === undefined ? err("NO_LEGAL_BINDING") : ok(best);
}

function isLegalCandidate(
  candidate: PlayCombo,
  top: PlayCombo | null,
  inverted: boolean,
  context: ComboContext,
): boolean {
  if (top !== null && !isStronger(comboStrength(candidate), comboStrength(top), inverted)) {
    return false;
  }
  return context.isLegal?.(candidate) ?? true;
}

/** Best first: effective strength, then pure, then a total tie-break on suits. */
function compareCandidates(a: PlayCombo, b: PlayCombo, inverted: boolean): number {
  const byStrength = compareStrength(comboStrength(b), comboStrength(a), inverted);
  if (byStrength !== 0) return byStrength;
  if (a.isPureJokerPlay !== b.isPureJokerPlay) return a.isPureJokerPlay ? -1 : 1;

  // Suits never affect strength, so every remaining candidate is equally strong
  // and the choice is arbitrary — but it must be a *function of the selection*,
  // because two servers replaying one seed have to bind identically (§14). Prefer
  // suits the combo does not already hold, so a joker beside the 8 of hearts does
  // not come down as a second 8 of hearts, then order S, H, D, C.
  const byDuplication = duplicatedSuits(a) - duplicatedSuits(b);
  if (byDuplication !== 0) return byDuplication;
  return suitOrderKey(a) - suitOrderKey(b);
}

/** How many suits in the combo appear more than once. */
function duplicatedSuits(combo: PlayCombo): number {
  const seen = new Set<Suit | null>();
  let duplicates = 0;
  for (const suit of combo.suits) {
    if (seen.has(suit)) duplicates++;
    seen.add(suit);
  }
  return duplicates;
}

/** Bound suits read as a base-4 number, low digit first. Pure jokers contribute 0. */
function suitOrderKey(combo: PlayCombo): number {
  let key = 0;
  let place = 1;
  for (const binding of combo.bindings) {
    key += SUIT_RANK[binding.suit] * place;
    place *= SUITS.length;
  }
  return key;
}

/** Every assignment of suits to `count` jokers, in S, H, D, C order. */
function suitAssignments(count: number): Suit[][] {
  let assignments: Suit[][] = [[]];
  for (let i = 0; i < count; i++) {
    assignments = assignments.flatMap((prefix) => SUITS.map((suit) => [...prefix, suit]));
  }
  return assignments;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the combo. Callers have already established that it is well-formed.
 *
 * The result is frozen, cards and all: `applyAction` is pure and a combo is
 * shared by reference across every state descended from the play that made it.
 */
function makeCombo(
  cards: readonly Card[],
  bindingByCardId: ReadonlyMap<string, JokerBinding>,
): PlayCombo {
  const bindings: JokerBinding[] = [];
  const suits: (Suit | null)[] = [];
  let resolvedRank: Rank | null = null;
  let isPureJokerPlay = true;

  for (const card of cards) {
    const binding = card.isJoker ? bindingByCardId.get(card.id) : undefined;
    if (card.isJoker && binding === undefined) {
      suits.push(null);
      continue;
    }
    isPureJokerPlay = false;
    if (binding !== undefined) {
      bindings.push(Object.freeze({ ...binding }));
      suits.push(binding.suit);
      resolvedRank = binding.rank;
    } else {
      suits.push(card.suit);
      resolvedRank = card.rank;
    }
  }

  return Object.freeze({
    cards: Object.freeze([...cards]) as Card[],
    bindings: Object.freeze(bindings) as JokerBinding[],
    resolvedRank,
    suits: Object.freeze(suits) as (Suit | null)[],
    isPureJokerPlay,
  });
}
