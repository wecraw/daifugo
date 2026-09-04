/**
 * The fan of §10.2, and the weighted layout of §10.3, as numbers rather than CSS.
 *
 * Everything here is a pure function of a card count and a weight per card, for
 * the same reason `tableLayout.ts` is: the acceptance criterion of #18 — an
 * 18-card hand keeping at least a 26px exposed edge per card — is arithmetic, and
 * jsdom has no layout engine to measure it with. `Hand.tsx` applies what these
 * return and owns none of the figures.
 *
 * The step formula is §10.2's:
 *
 * ```
 * step = min(cardWidth * 0.62, (W - cardWidth) / (n - 1))
 * ```
 *
 * with the weights of §10.3 replacing the `n - 1` denominator: each card's
 * exposed strip is `unit * weight`, so an unplayable card at 0.55 gives up strip
 * and the space flows to the playable cards beside it. With every weight at 1.0
 * the two collapse to the same number, which is the check the tests make.
 *
 * The one addition is the tap floor. A dimmed card is still a tap target — §10.3
 * dims, it does not disable — so a strip that the weighting pushed under the 26px
 * threshold is raised back to it whenever the whole fan still fits `W`. At 18
 * cards it always does: the widest the fan ever gets is 64 + 17 x 39.68 = 738px
 * against the 780 the hand row has, so the weighting only ever bites on a hand
 * larger than a 54-card deck can deal.
 */
import { CARD_HEIGHT, CARD_WIDTH, HAND_REGION_WIDTH } from "./tableLayout";

export { CARD_HEIGHT, CARD_WIDTH };

/** §10.2: a card never gives up more than this fraction of itself. */
export const STEP_RATIO = 0.62;

/** The tap threshold of §10.2, and the acceptance criterion of #18. */
export const MIN_EXPOSED_EDGE = 26;

/** §10.2: hit targets are the exposed strip, with 6px of vertical slop. */
export const HIT_SLOP_Y = 6;

/** Fan rotation: `(i - (n-1)/2) * (16 / (n-1))` degrees, capped at +/-8 (§10.2). */
export const FAN_SPREAD_DEGREES = 16;
export const MAX_FAN_ROTATION = 8;

/** The centre card sits about this far above the ends, on a shallow parabola. */
export const CENTRE_RISE = 10;

/** §10.3: layout weights, and how an unplayable card renders. */
export const PLAYABLE_WEIGHT = 1;
export const UNPLAYABLE_WEIGHT = 0.55;
export const UNPLAYABLE_SCALE = 0.72;
export const UNPLAYABLE_SATURATION = 0.3;
export const UNPLAYABLE_DROP = 6;

/** §10.4: what selection does to a card, and the spring that gets it there. */
export const SELECTION_LIFT = 26;
export const SELECTION_SCALE = 1.06;
export const SPRING_STIFFNESS = 400;
export const SPRING_DAMPING = 30;

/** §10.7: how long the "no legal play, passing" card stays up. */
export const AUTO_PASS_DELAY_MS = 1200;

/** The uniform step of §10.2, i.e. the weighted step with every weight at 1.0. */
export function baseStep(
  count: number,
  width: number = HAND_REGION_WIDTH,
  cardWidth: number = CARD_WIDTH,
): number {
  if (count <= 1) return 0;
  return Math.min(cardWidth * STEP_RATIO, (width - cardWidth) / (count - 1));
}

/** Fan rotation in degrees for card `index` of `count` (§10.2). */
export function fanRotation(index: number, count: number): number {
  if (count <= 1) return 0;
  const offset = index - (count - 1) / 2;
  const spread = (offset * FAN_SPREAD_DEGREES) / (count - 1);
  return Math.max(-MAX_FAN_ROTATION, Math.min(MAX_FAN_ROTATION, spread));
}

/** Shallow parabolic rise in px: `CENTRE_RISE` at the centre, 0 at both ends. */
export function fanRise(index: number, count: number): number {
  if (count <= 2) return 0;
  const centre = (count - 1) / 2;
  const normalised = (index - centre) / centre;
  return CENTRE_RISE * (1 - normalised * normalised);
}

/** Where one card sits in the fan, and what strip of it takes the tap. */
export interface HandCardLayout {
  index: number;
  /** Left edge of the 64x90 card box, px from the left edge of the fan. */
  x: number;
  rotation: number;
  /** How far above the baseline the card sits, before selection or dimming. */
  rise: number;
  weight: number;
  playable: boolean;
  /** The exposed strip that takes the tap; the last card claims its full width. */
  hitLeft: number;
  hitWidth: number;
  /** Later cards overlap earlier ones, so the fan reads left to right. */
  zIndex: number;
}

export interface HandFanLayout {
  cards: HandCardLayout[];
  /** Total px the fan occupies, so the row can centre it. */
  width: number;
}

/**
 * The fan for `weights`, one weight per card in hand order (§10.2, §10.3).
 *
 * Only the first `n - 1` weights buy anything: a card's weight sets the strip it
 * exposes to the left of the card that overlaps it, and nothing overlaps the
 * rightmost card, which is why §10.2 gives that one the full width as its hit
 * target.
 */
export function layoutHand(
  weights: readonly number[],
  width: number = HAND_REGION_WIDTH,
  cardWidth: number = CARD_WIDTH,
): HandFanLayout {
  const count = weights.length;
  if (count === 0) return { cards: [], width: 0 };

  const maxStep = cardWidth * STEP_RATIO;
  const strips = weights.slice(0, -1);
  const totalWeight = strips.reduce((sum, weight) => sum + weight, 0);
  const unit = totalWeight === 0 ? maxStep : Math.min(maxStep, (width - cardWidth) / totalWeight);

  const floor = Math.min(MIN_EXPOSED_EDGE, maxStep);
  const weighted = strips.map((weight) => unit * weight);
  const raised = weighted.map((step) => Math.max(step, floor));
  const steps = cardWidth + sum(raised) <= width ? raised : weighted;

  const cards: HandCardLayout[] = [];
  let x = 0;
  for (let index = 0; index < count; index++) {
    const step = steps[index];
    cards.push({
      index,
      x,
      rotation: fanRotation(index, count),
      rise: fanRise(index, count),
      weight: weights[index] ?? PLAYABLE_WEIGHT,
      playable: (weights[index] ?? PLAYABLE_WEIGHT) >= PLAYABLE_WEIGHT,
      hitLeft: x,
      hitWidth: step ?? cardWidth,
      zIndex: index,
    });
    x += step ?? 0;
  }

  return { cards, width: cardWidth + sum(steps) };
}

/** The weight of §10.3 for a card the turn-start legal set does or does not hold. */
export function weightOf(playable: boolean): number {
  return playable ? PLAYABLE_WEIGHT : UNPLAYABLE_WEIGHT;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
