/**
 * The 844x390 landscape frame of §10.1, as numbers rather than as CSS.
 *
 * The three bands — 56px top strip, ~218px middle, 116px hand row — have to add
 * up to the viewport exactly, and the hand region has to be the `W ≈ 780` that
 * §10.2's step formula is derived from. Keeping the figures here rather than in
 * `styles.css` makes both of those arithmetic a test can assert; `GameTable`
 * pushes them into CSS custom properties so there is still only one source.
 *
 * Seat distribution lives here for the same reason: which edge each opponent
 * takes is the part of "holds at 3 and 8 players" that can be checked without a
 * layout engine.
 */
import type { PublicGameState } from "@daifugo/core";
import { hasDropped, hasFinished, hasPassed, isInRound, type SeatingContext } from "@daifugo/core";

export const VIEWPORT_WIDTH = 844;
export const VIEWPORT_HEIGHT = 390;

/** Seats, history log and the turn clock (§10.1). */
export const TOP_STRIP_HEIGHT = 56;
/** Trick area and banners, flanked by the left and right seat columns. */
export const MIDDLE_HEIGHT = 218;
/** The single fanned row of §10.2, plus the action column beside it. */
export const HAND_ROW_HEIGHT = 116;

/**
 * The action column is on the right edge rather than a bottom bar (§10.1), and
 * its width is what leaves the hand the `W ≈ 780` of §10.2.
 */
export const ACTION_COLUMN_WIDTH = 64;
export const HAND_REGION_WIDTH = VIEWPORT_WIDTH - ACTION_COLUMN_WIDTH;

/** The left and right seat columns of the middle band: two chips each, stacked. */
export const SIDE_COLUMN_WIDTH = 108;
export const TRICK_AREA_WIDTH = VIEWPORT_WIDTH - SIDE_COLUMN_WIDTH * 2;

/** Card 64 x 90 (§10.2). The trick renders them smaller; the hand does not. */
export const CARD_WIDTH = 64;
export const CARD_HEIGHT = 90;

/**
 * The trick stack's own arithmetic (§10.9).
 *
 * The band is not wide enough for every legal trick: seven triples at an
 * eight-player table are ~888px of cards against the ~606px the centre column
 * has. Since the newest play is the one everyone has to beat, it is the one that
 * may never be clipped — so the plays tuck further under one another as the
 * trick grows, and once even the tightest overlap will not fit, the oldest plays
 * drop off the left instead. `fitTrickStack` decides both; the stylesheet only
 * applies the number it returns.
 */
/** `.game-table__middle`'s own padding (0.4rem) and column gaps (0.3rem). */
const MIDDLE_PADDING_X = 6.4;
const MIDDLE_COLUMN_GAP = 4.8;
export const TRICK_STACK_WIDTH = TRICK_AREA_WIDTH - 2 * (MIDDLE_PADDING_X + MIDDLE_COLUMN_GAP);

/** `.card-face--trick` is the hand's card at 0.7, with a 0.15rem gap beside it. */
export const TRICK_CARD_WIDTH = CARD_WIDTH * 0.7;
const TRICK_CARD_GAP = 2.4;

/** The resting overlap between plays (0.9rem), and how far it may tighten. */
export const TRICK_PLAY_OVERLAP = 14.4;
export const MAX_TRICK_PLAY_OVERLAP = TRICK_CARD_WIDTH * 0.75;

/**
 * The player label under the newest play is up to 9rem wide and centred on it,
 * so it hangs past a narrow play by about half that on each side. The stack has
 * to leave that room or the name is the thing that gets cut.
 */
const TRICK_LABEL_OVERHANG = 52;

/** Which plays of a trick the band can show, and how tightly they must sit. */
export interface TrickStackFit {
  /** Index of the oldest play still rendered; earlier ones do not fit. */
  firstVisibleIndex: number;
  /** Px each play tucks under the one that beat it. */
  overlap: number;
}

/** Width of one play, laid out as `.trick-area__cards`. */
function trickPlayWidth(cards: number): number {
  return cards * TRICK_CARD_WIDTH + Math.max(0, cards - 1) * TRICK_CARD_GAP;
}

/**
 * Fit `cardCounts` — the current trick, oldest play first — into `available`.
 *
 * Tighten the overlap first, because a trick that still shows every play is
 * worth more than one that reads prettily; drop from the oldest end only once
 * the tightest overlap has run out. The newest play always survives both.
 */
export function fitTrickStack(
  cardCounts: readonly number[],
  available: number = TRICK_STACK_WIDTH,
): TrickStackFit {
  const room = available - 2 * TRICK_LABEL_OVERHANG;
  for (let first = 0; first < cardCounts.length; first += 1) {
    const shown = cardCounts.slice(first);
    const total = shown.reduce((sum, count) => sum + trickPlayWidth(count), 0);
    const gaps = shown.length - 1;
    if (gaps === 0) return { firstVisibleIndex: first, overlap: TRICK_PLAY_OVERLAP };
    const overlap = Math.min(
      MAX_TRICK_PLAY_OVERLAP,
      Math.max(TRICK_PLAY_OVERLAP, (total - room) / gaps),
    );
    if (total - overlap * gaps <= room) return { firstVisibleIndex: first, overlap };
  }
  return { firstVisibleIndex: 0, overlap: TRICK_PLAY_OVERLAP };
}

export type SeatEdge = "left" | "top" | "right";

/**
 * How many seats each edge can hold without overflowing. The top strip shares
 * its 56px with the history log and the clock, so three chips is its limit; the
 * side columns are 218px tall, which takes two.
 */
export const SEAT_CAPACITY: Readonly<Record<SeatEdge, number>> = Object.freeze({
  left: 2,
  top: 3,
  right: 2,
});

/** 8 players (§0) is 7 opponents, which is exactly the capacity above. */
export const MAX_OPPONENTS = SEAT_CAPACITY.left + SEAT_CAPACITY.top + SEAT_CAPACITY.right;

/**
 * Which edge each opponent takes, indexed by their distance around the table.
 *
 * The order is the ring: up the left edge, across the top left-to-right, then
 * down the right edge. Opponent 0 is the player to the viewer's left — the next
 * seat in `turnOrder` — so play visibly travels left, over the top, and back
 * down the right side to the hand row.
 *
 * The split per count is a table rather than a formula because the two
 * constraints pull against each other: keep the sides balanced, and do not put a
 * third chip on an edge that only fits two.
 */
const SEAT_EDGES: readonly (readonly SeatEdge[])[] = [
  [],
  ["top"],
  ["left", "right"],
  ["left", "top", "right"],
  ["left", "top", "top", "right"],
  ["left", "top", "top", "top", "right"],
  ["left", "left", "top", "top", "right", "right"],
  ["left", "left", "top", "top", "top", "right", "right"],
];

/**
 * The edge for each opponent, in ring order. A count past the table's capacity
 * cannot happen at 8 players, but rather than drop a seat the overflow lands on
 * the top edge, where it is visible and obviously wrong.
 */
export function distributeSeats(opponentCount: number): SeatEdge[] {
  const known = SEAT_EDGES[opponentCount];
  if (known !== undefined) return [...known];
  const overflow: SeatEdge[] = Array.from({ length: opponentCount - MAX_OPPONENTS }, () => "top");
  return [...(SEAT_EDGES[MAX_OPPONENTS] ?? []), ...overflow];
}

/**
 * Everyone but the viewer, starting with the seat to their left.
 *
 * `turnOrder` is the play order and is never mutated mid-round, so it is what
 * decides where a seat sits — a finished or demoted player keeps their chair
 * (§7.7, §4.5). Before the deal there is no turn order yet, and seat order is
 * the honest fallback.
 */
export function opponentIds(
  room: Pick<PublicGameState, "turnOrder" | "players" | "myPlayerId">,
): string[] {
  const order = room.turnOrder.length > 0 ? room.turnOrder : room.players.map((seat) => seat.id);
  const mine = order.indexOf(room.myPlayerId);
  if (mine === -1) return order.filter((id) => id !== room.myPlayerId);
  return Array.from(
    { length: order.length - 1 },
    (_, offset) => order[(mine + 1 + offset) % order.length] ?? "",
  );
}

/** What a seat chip says about a player's standing in the round. */
export type SeatStatus = "playing" | "passed" | "finished" | "dropped";

/**
 * Asked of core rather than re-derived. Eligibility is a function of
 * `turnOrder` plus the finished, dropped and passed lists (§7.5), and the client
 * must not invent a second answer to it.
 *
 * Dropped is asked first because a player who leaves after going out stays in
 * both lists, and core reads that pair as dropped — the later and lower of the
 * two facts (§7.7). Reporting their old place back would contradict the finish
 * order the round actually scores.
 */
export function seatStatus(playerId: string, seating: SeatingContext): SeatStatus {
  if (hasDropped(playerId, seating)) return "dropped";
  if (hasFinished(playerId, seating)) return "finished";
  if (isInRound(playerId, seating) && hasPassed(playerId, seating)) return "passed";
  return "playing";
}

/** 1-indexed place in the agari order, or null for a player still holding cards. */
export function finishPositionOf(
  playerId: string,
  finishedPlayerIds: readonly string[],
): number | null {
  const index = finishedPlayerIds.indexOf(playerId);
  return index === -1 ? null : index + 1;
}

/** The frame above, as the custom properties `styles.css` lays the table out with. */
export function tableCssVariables(): Record<string, string> {
  return {
    "--top-strip-height": `${TOP_STRIP_HEIGHT}px`,
    "--middle-height": `${MIDDLE_HEIGHT}px`,
    "--hand-row-height": `${HAND_ROW_HEIGHT}px`,
    "--action-column-width": `${ACTION_COLUMN_WIDTH}px`,
    "--side-column-width": `${SIDE_COLUMN_WIDTH}px`,
    "--card-width": `${CARD_WIDTH}px`,
    "--card-height": `${CARD_HEIGHT}px`,
  };
}

/**
 * Which edge a seat sits on, from the viewer's own point of view.
 *
 * The animation layer needs a direction to send cards in — towards the recipient
 * of a 7-pass, away from a demoted seat — and the ring above is what decides it.
 * `"self"` is the hand row, which is where the viewer's own cards live rather
 * than a chip; `null` is a player the ring does not place, which at a table of
 * three to eight seats means a spectator's id or a stale one.
 */
export function seatEdgeOf(
  room: Pick<PublicGameState, "turnOrder" | "players" | "myPlayerId">,
  playerId: string,
): SeatEdge | "self" | null {
  if (playerId === room.myPlayerId) return "self";
  const opponents = opponentIds(room);
  const index = opponents.indexOf(playerId);
  if (index === -1) return null;
  return distributeSeats(opponents.length)[index] ?? null;
}
