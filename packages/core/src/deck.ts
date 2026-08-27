/**
 * Deck construction, the seeded PRNG, dealing, and seating rotation (§3).
 *
 * This is the only place randomness exists in core, and it is not ambient: every
 * function that needs it takes an `Rng` built from `START_GAME.seed` (§2). There
 * is no `Math.random` here and there must never be one — replaying a stored seed
 * has to reproduce a round exactly, which is what makes `applyAction` pure and
 * what makes a Firestore retry safe (§14).
 */
import type { Card, Rank, Suit } from "./types.js";

export const DECK_SIZE = 54;

/** Suit order for deck construction and tie-breaks. Never a strength order. */
export const SUITS: readonly Suit[] = Object.freeze<Suit[]>(["S", "H", "D", "C"]);

/** Every rank, listed in strength order (§5.1) so the built deck reads naturally. */
export const RANKS: readonly Rank[] = Object.freeze<Rank[]>([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2,
]);

export const JOKER_IDS: readonly string[] = Object.freeze(["JKR-1", "JKR-2"]);

/** The 3 of Spades: excluded from forced exchange selection (§4.3), beats a lone
 *  pure joker when the house rule is on (§6). */
export const SPADE_3_ID = "S-3";

/** The 3 of Diamonds: its holder leads the first trick of every round (§3.4). */
export const DIAMOND_3_ID = "D-3";

/** Card ids are `"<suit>-<rank>"` over the numeric rank, so a Jack is `"H-11"` (§2). */
export function cardId(suit: Suit, rank: Rank): string {
  return `${suit}-${rank}`;
}

/**
 * A fresh 54-card deck in a fixed order (§3.1). Shuffling is a separate step, so
 * the order here is only ever the shuffle's input.
 *
 * Cards are frozen. They are shared by reference across every state descended
 * from the deal, so a mutation would rewrite history as well as the present.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(Object.freeze({ id: cardId(suit, rank), suit, rank, isJoker: false }));
    }
  }
  for (const id of JOKER_IDS) {
    deck.push(Object.freeze({ id, suit: null, rank: null, isJoker: true }));
  }
  return deck;
}

/* -------------------------------------------------------------------------- */
/* Seeded PRNG                                                                */
/* -------------------------------------------------------------------------- */

/** Returns a float in [0, 1). Deterministic in the seed it was built from. */
export type Rng = () => number;

/**
 * cyrb128: spreads an arbitrary seed string over the four 32-bit words sfc32
 * wants. A short or low-entropy seed would otherwise leave most of the generator
 * state at its initial value.
 */
function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * Build the round's generator from `START_GAME.seed`.
 *
 * sfc32: small, fast, and — the reason it is here rather than anything cleverer —
 * expressed entirely in 32-bit integer ops, so it produces the identical stream on
 * every engine that runs this code. The server generates the seed with a CSPRNG
 * (§2); this generator's own statistical quality only has to be good enough to
 * shuffle 54 cards.
 */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  return function next(): number {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A uniform integer in `[0, boundExclusive)`. Returns 0 for a non-positive bound. */
export function randomInt(rng: Rng, boundExclusive: number): number {
  if (boundExclusive <= 0) return 0;
  return Math.floor(rng() * boundExclusive) % boundExclusive;
}

/** Fisher-Yates, descending, into a new array. The input is never mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const held = out[i] as T;
    out[i] = out[j] as T;
    out[j] = held;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Seating and dealing                                                        */
/* -------------------------------------------------------------------------- */

/** Round 1 only: seating is join order and the dealer is drawn from the seed (§3.2). */
export function pickDealerIndex(playerCount: number, rng: Rng): number {
  return randomInt(rng, playerCount);
}

/**
 * Seat order for the next round, given this round's finish order best-to-worst
 * (§3.2).
 *
 * The last-place finisher deals from `seatIndex 0`; the winner sits to the
 * dealer's right at `N-1`, the runner-up at `N-2`, and so on. Reading in turn
 * order from the dealer that is `last, (N-1)th, ..., 2nd, 1st` — the finish order
 * reversed. It is one line, but it is the line that makes §3.3 punish the winner:
 * they sit furthest from the dealer, so they are dealt last and get the short hand.
 *
 * `finishOrder` must already include the final remaining player and anyone who
 * left mid-round, both of whom rank at the bottom (§4.1, §7.7).
 */
export function reseat(finishOrder: readonly string[]): string[] {
  return [...finishOrder].reverse();
}

/**
 * Deal the whole deck one card at a time starting with the dealer and moving left
 * (§3.3).
 *
 * Hands come out uneven whenever the player count does not divide 54. That is the
 * rule, not a rounding artefact: do not compensate.
 */
export function deal(
  deck: readonly Card[],
  turnOrder: readonly string[],
  dealerIndex: number,
): Record<string, Card[]> {
  const hands: Record<string, Card[]> = {};
  const count = turnOrder.length;
  if (count === 0) return hands;

  for (const playerId of turnOrder) {
    hands[playerId] = [];
  }

  const start = ((dealerIndex % count) + count) % count;
  for (let i = 0; i < deck.length; i++) {
    const card = deck[i];
    if (card === undefined) continue;
    const playerId = turnOrder[(start + i) % count];
    if (playerId === undefined) continue;
    hands[playerId]?.push(card);
  }
  return hands;
}

/** The player holding `cardId`, or null if nobody does. */
export function findCardHolder(
  hands: Readonly<Record<string, Card[]>>,
  cardId: string,
): string | null {
  for (const [playerId, hand] of Object.entries(hands)) {
    if (hand.some((card) => card.id === cardId)) return playerId;
  }
  return null;
}

/**
 * The holder of the 3 of Diamonds, who leads the first trick of the round (§3.4).
 * Null only if the deal did not distribute the whole deck.
 */
export function openingLeaderId(hands: Readonly<Record<string, Card[]>>): string | null {
  return findCardHolder(hands, DIAMOND_3_ID);
}
