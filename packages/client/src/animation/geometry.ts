/**
 * Where an animation travels, in the table's own pixels.
 *
 * Measuring the DOM would be more exact and much worse: the seat chips are laid
 * out by flexbox inside three bands, so a rect is only available after paint, and
 * the client's tests run without a layout engine. The frame is fixed at 844x390
 * (§10.1) and each edge holds at most three chips, so a direction per edge is
 * enough for a card to visibly leave for the right side of the table — which is
 * what §10.9 asks for — and it is arithmetic a test can check.
 *
 * Offsets are relative to the centre of the trick area, positive x rightwards and
 * positive y downwards, matching CSS `translate`.
 */
import {
  HAND_ROW_HEIGHT,
  MIDDLE_HEIGHT,
  SIDE_COLUMN_WIDTH,
  TOP_STRIP_HEIGHT,
  TRICK_AREA_WIDTH,
  type SeatEdge,
} from "../layout/tableLayout";

export interface TravelVector {
  x: number;
  y: number;
}

/** Half the trick area plus half a side column: the middle of a side chip. */
const SIDE_X = TRICK_AREA_WIDTH / 2 + SIDE_COLUMN_WIDTH / 2;
/** The top strip's midline, from the middle band's centre. */
const TOP_Y = -(MIDDLE_HEIGHT / 2 + TOP_STRIP_HEIGHT / 2);
/** The hand row's midline, the same way down. */
const SELF_Y = MIDDLE_HEIGHT / 2 + HAND_ROW_HEIGHT / 2;

export const SEAT_TRAVEL: Readonly<Record<SeatEdge | "self", TravelVector>> = Object.freeze({
  left: { x: -SIDE_X, y: 0 },
  top: { x: 0, y: TOP_Y },
  right: { x: SIDE_X, y: 0 },
  self: { x: 0, y: SELF_Y },
});

/**
 * The discard edge cards sweep off to (§10.9).
 *
 * The graveyard has no chip of its own — it is the corner past the left seat
 * column, below the table's own line — so the sweep is the one direction here
 * that is not a seat.
 */
export const GRAVEYARD_TRAVEL: TravelVector = Object.freeze({ x: -SIDE_X - 80, y: SELF_Y });

/** A seat's direction, or the centre when the ring does not place that player. */
export function travelTo(edge: SeatEdge | "self" | null): TravelVector {
  return edge === null ? { x: 0, y: 0 } : SEAT_TRAVEL[edge];
}

/** The vector as the custom properties `styles.css` animates against. */
export function travelCssVariables(from: TravelVector, to: TravelVector): Record<string, string> {
  return {
    "--anim-from-x": `${from.x}px`,
    "--anim-from-y": `${from.y}px`,
    "--anim-to-x": `${to.x}px`,
    "--anim-to-y": `${to.y}px`,
  };
}
