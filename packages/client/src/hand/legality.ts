/**
 * What the hand may do this turn, asked of the same `@daifugo/core` evaluator the
 * server validates with (§10.3).
 *
 * Nothing here re-implements a rule. The playable set, the reason a selection is
 * illegal, and the joker bindings a selection may take all come out of
 * `generateLegalMoves`, `checkLegality` and `parseCombo`, so the dimming, the
 * disabled Play button (§10.6) and the auto-pass (§10.7) can never disagree with
 * what the server would say about the same selection.
 *
 * The one judgement call is the binding picker (§10.5). A lone joker led under no
 * lock has 52 legal bindings, and cycling 52 badges is not a UI. Since suit never
 * affects strength (§5.1) and core's own default already picks the suit for a
 * given rank, the options are deduplicated **by resolved rank**, each rank
 * represented by the assignment core's tie-break would choose. What the player
 * cycles is therefore "what rank does this joker stand for", which is the choice
 * §5.5 is actually about, and option 0 is exactly the combo the server would
 * resolve by default — a test pins that.
 */
import {
  DEFAULT_HOUSE_RULES,
  RANKS,
  SUITS,
  checkLegality,
  comboStrength,
  compareStrength,
  err,
  invertedIn,
  parseCombo,
  shibariLock,
  type Card,
  type ComboContext,
  type ErrorCode,
  type JokerBinding,
  type PlayCombo,
  type PublicGameState,
  type Result,
  type Suit,
  type TrickContext,
} from "@daifugo/core";

/**
 * Why the table will not take an action from this seat right now, or null.
 *
 * The client renders these disabled rather than sending and being refused — the
 * same principle §10.11 applies to the host panel — so the codes here are the
 * engine's own guards on `PLAY_CARDS` and `PASS` (§7.1, §7.5), in its order.
 */
export function turnBlocker(room: PublicGameState): ErrorCode | null {
  if (room.status !== "IN_PROGRESS") return "WRONG_STATUS";
  if (room.pendingAction !== null) return "PENDING_ACTION_BLOCKS";
  if (room.turnOrder[room.activePlayerIndex] !== room.myPlayerId) return "NOT_YOUR_TURN";
  return null;
}

/** Why `pass` would be refused (§7.5), or null. Leading is the interesting one. */
export function passBlocker(room: PublicGameState): ErrorCode | null {
  const blocked = turnBlocker(room);
  if (blocked !== null) return blocked;
  if (room.currentTrick.length === 0) return "CANNOT_PASS_AS_LEADER";
  if (room.passedPlayerIds.includes(room.myPlayerId)) return "ALREADY_PASSED";
  return null;
}

/** Every card that appears in at least one legal move (§10.3). */
export function playableIds(moves: readonly PlayCombo[]): Set<string> {
  const ids = new Set<string>();
  for (const move of moves) {
    for (const card of move.cards) ids.add(card.id);
  }
  return ids;
}

/**
 * The cards that can still join `selection` and land on a legal play (§10.3).
 *
 * This is what narrows *within* a turn: picking one 8 leaves the other 8s and the
 * jokers lit and everything else dark. An empty selection narrows nothing, so it
 * is the full playable set. Selected cards stay in the set — a selection you can
 * play is not a card you must un-pick.
 */
export function continuationIds(
  moves: readonly PlayCombo[],
  selection: readonly string[],
): Set<string> {
  if (selection.length === 0) return playableIds(moves);
  const ids = new Set<string>();
  for (const move of moves) {
    const inMove = new Set(move.cards.map((card) => card.id));
    if (!selection.every((id) => inMove.has(id))) continue;
    for (const id of inMove) ids.add(id);
  }
  return ids;
}

/** One entry of the binding picker (§10.5): what to send, and what it resolves to. */
export interface BindingOption {
  /** Explicit bindings for `playCards`. Empty is an explicit pure joker play (§5.5). */
  bindings: JokerBinding[];
  combo: PlayCombo;
}

/**
 * The legal bindings for `cards`, strongest first, one per distinguishable choice.
 *
 * Empty when the selection holds no joker — there is nothing to choose — and also
 * when no binding of it is legal at all, which the caller reports through
 * `resolveSelection` rather than as an empty badge.
 */
export function bindingOptions(cards: readonly Card[], ctx: TrickContext): BindingOption[] {
  const jokers = cards.filter((card) => card.isJoker);
  if (jokers.length === 0) return [];

  const comboContext = comboContextOf(ctx);
  const inverted = invertedIn(ctx);
  const candidates: BindingOption[] = [];

  const consider = (bindings: JokerBinding[]): void => {
    const parsed = parseCombo(cards, bindings, comboContext);
    if (!parsed.ok || !checkLegality(parsed.value, ctx).ok) return;
    candidates.push({ bindings, combo: parsed.value });
  };

  // Pure is a candidate only when every card is a joker (§5.3).
  if (jokers.length === cards.length) consider([]);

  const forced = cards.find((card) => !card.isJoker)?.rank ?? null;
  for (const rank of forced === null ? RANKS : [forced]) {
    for (const suits of suitAssignments(jokers.length)) {
      consider(
        jokers.map((joker, index) => ({ cardId: joker.id, rank, suit: suits[index] as Suit })),
      );
    }
  }

  const distinct = new Map<string, BindingOption>();
  for (const candidate of candidates) {
    const key = choiceKey(candidate.combo, ctx);
    const held = distinct.get(key);
    if (held === undefined || preferSuits(candidate.combo, held.combo) < 0) {
      distinct.set(key, candidate);
    }
  }

  // Strongest first; within one rank, core's own default (the `preferSuits`
  // minimum) leads and the lock-setting variant sits next to it.
  return [...distinct.values()].sort((a, b) => {
    const byStrength = compareStrength(comboStrength(b.combo), comboStrength(a.combo), inverted);
    return byStrength !== 0 ? byStrength : preferSuits(a.combo, b.combo);
  });
}

/**
 * What actually makes two bindings of the same cards different plays.
 *
 * The rank, always — and whether the play establishes a suit lock, which is the
 * *only* other thing a joker's bound suit can change. Strength never depends on
 * suit (§5.1), every house rule reads the resolved rank (§5.4), the Spade-3
 * counter matches a card id rather than a binding (§5.4), and under an existing
 * lock the legal assignments all match that same multiset. That leaves shibari:
 * binding a joker to the top's suits locks the trick, any other suit does not
 * (§6), so those are two choices and everything else at that rank is one.
 *
 * Which is what keeps the badge cyclable: a lone joker led has 52 legal bindings
 * and 13 distinguishable ones, and a player who wants the lock is one tap away
 * rather than lost in a suit cycle nothing else can tell apart.
 */
function choiceKey(combo: PlayCombo, ctx: TrickContext): string {
  const rank = combo.resolvedRank === null ? "pure" : String(combo.resolvedRank);
  const existing = ctx.suitLock ?? null;
  const locks =
    existing === null &&
    shibariLock(ctx.top ?? null, combo, null, ctx.config ?? DEFAULT_HOUSE_RULES) !== null;
  return `${rank}|${locks ? "lock" : "-"}`;
}

/**
 * The combo a selection would play, or why it cannot be played (§10.6).
 *
 * `option` is the player's choice from the binding picker; without one the
 * default rule of §5.5 resolves the bindings, which is what the server does with
 * a `playCards` that carries none.
 */
export function resolveSelection(
  cards: readonly Card[],
  option: BindingOption | null,
  ctx: TrickContext,
): Result<PlayCombo, ErrorCode> {
  if (cards.length === 0) return err("EMPTY_SELECTION");
  if (option !== null) return checkLegality(option.combo, ctx);
  const parsed = parseCombo(cards, undefined, comboContextOf(ctx));
  if (!parsed.ok) return parsed;
  return checkLegality(parsed.value, ctx);
}

/** The parser's view of the trick, with the evaluator's legality filter (§5.5). */
function comboContextOf(ctx: TrickContext): ComboContext {
  return {
    top: ctx.top ?? null,
    inverted: invertedIn(ctx),
    isLegal: (combo: PlayCombo) => checkLegality(combo, ctx).ok,
  };
}

/**
 * Core's tie-break between two equally strong bindings (§5.5): prefer the one
 * that duplicates fewer suits already in the combo, then S, H, D, C order.
 * Mirrored rather than imported so the badge's default is the binding the server
 * resolves when the client sends none.
 */
function preferSuits(a: PlayCombo, b: PlayCombo): number {
  const byDuplication = duplicatedSuits(a) - duplicatedSuits(b);
  if (byDuplication !== 0) return byDuplication;
  return suitOrderKey(a) - suitOrderKey(b);
}

function duplicatedSuits(combo: PlayCombo): number {
  const seen = new Set<Suit | null>();
  let duplicates = 0;
  for (const suit of combo.suits) {
    if (seen.has(suit)) duplicates++;
    seen.add(suit);
  }
  return duplicates;
}

const SUIT_RANK: Readonly<Record<Suit, number>> = Object.freeze({ S: 0, H: 1, D: 2, C: 3 });

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
  for (let index = 0; index < count; index++) {
    assignments = assignments.flatMap((prefix) => SUITS.map((suit) => [...prefix, suit]));
  }
  return assignments;
}
