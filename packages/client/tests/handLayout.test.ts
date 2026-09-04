/**
 * The hand's arithmetic: the fan of §10.2, the weighted layout of §10.3, and the
 * sort of §10.8.
 *
 * The acceptance criterion of #18 — an 18-card hand keeping at least a 26px
 * exposed edge per card — is the first test here, because jsdom cannot measure it
 * on a rendered row and it is arithmetic anyway.
 */
import { describe, expect, it } from "vitest";
import type { Card } from "@daifugo/core";
import { HAND_REGION_WIDTH } from "../src/layout/tableLayout";
import {
  CARD_WIDTH,
  MAX_FAN_ROTATION,
  MIN_EXPOSED_EDGE,
  PLAYABLE_WEIGHT,
  STEP_RATIO,
  UNPLAYABLE_WEIGHT,
  baseStep,
  fanRise,
  fanRotation,
  layoutHand,
  weightOf,
} from "../src/layout/handLayout";
import {
  DEFAULT_HAND_SORT,
  nextHandSort,
  readHandSort,
  sortHand,
  writeHandSort,
} from "../src/hand/sort";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

/** The exposed strip of every card: each card's hit width, the last one included. */
function strips(weights: number[]): number[] {
  return layoutHand(weights).cards.map((slot) => slot.hitWidth);
}

describe("hand geometry (§10.2)", () => {
  it("keeps a 26px exposed edge on every card of an 18-card hand", () => {
    for (const playable of [18, 12, 6, 0]) {
      const weights = Array.from({ length: 18 }, (_, index) => weightOf(index < playable));
      for (const strip of strips(weights)) {
        expect(strip).toBeGreaterThanOrEqual(MIN_EXPOSED_EDGE);
      }
    }
  });

  it("is the step of §10.2 when every card is playable", () => {
    const weights = Array.from({ length: 18 }, () => PLAYABLE_WEIGHT);
    const step = baseStep(18);
    expect(step).toBeCloseTo(
      Math.min(CARD_WIDTH * STEP_RATIO, (HAND_REGION_WIDTH - CARD_WIDTH) / 17),
    );
    for (const slot of layoutHand(weights).cards.slice(0, -1)) {
      expect(slot.hitWidth).toBeCloseTo(step);
    }
  });

  it("gives the rightmost card the full width, since nothing overlaps it", () => {
    const { cards } = layoutHand(Array.from({ length: 5 }, () => PLAYABLE_WEIGHT));
    expect(cards[4]?.hitWidth).toBe(CARD_WIDTH);
    expect(cards[0]?.hitWidth).toBeLessThan(CARD_WIDTH);
  });

  it("never lets the fan overflow the hand region", () => {
    for (let count = 1; count <= 20; count++) {
      const weights = Array.from({ length: count }, (_, index) => weightOf(index % 3 === 0));
      expect(layoutHand(weights).width).toBeLessThanOrEqual(HAND_REGION_WIDTH);
    }
  });

  it("caps the fan rotation at 8 degrees and keeps it symmetric", () => {
    for (const count of [2, 5, 18]) {
      const angles = Array.from({ length: count }, (_, index) => fanRotation(index, count));
      for (const angle of angles) expect(Math.abs(angle)).toBeLessThanOrEqual(MAX_FAN_ROTATION);
      expect(angles[0]).toBeCloseTo(-(angles[count - 1] ?? 0));
    }
    expect(fanRotation(0, 1)).toBe(0);
  });

  it("raises the centre of the fan about 10px above its ends", () => {
    const count = 9;
    expect(fanRise(0, count)).toBeCloseTo(0);
    expect(fanRise(count - 1, count)).toBeCloseTo(0);
    expect(fanRise(4, count)).toBeCloseTo(10);
  });
});

describe("weighted layout (§10.3)", () => {
  it("spends the freed space on the playable cards", () => {
    // Wide enough that the step is the width-limited one, so the weights bite.
    const width = 500;
    const count = 18;
    const allPlayable = layoutHand(
      Array.from({ length: count }, () => PLAYABLE_WEIGHT),
      width,
    );
    const mixed = layoutHand(
      Array.from({ length: count }, (_, index) => weightOf(index < 9)),
      width,
    );
    expect(mixed.cards[0]?.hitWidth ?? 0).toBeGreaterThan(allPlayable.cards[0]?.hitWidth ?? 0);
    expect(mixed.cards[10]?.hitWidth ?? 0).toBeLessThan(mixed.cards[0]?.hitWidth ?? 0);
  });

  it("weights an unplayable card at 0.55 and a playable one at 1.0", () => {
    expect(weightOf(true)).toBe(PLAYABLE_WEIGHT);
    expect(weightOf(false)).toBe(UNPLAYABLE_WEIGHT);
    expect(layoutHand([UNPLAYABLE_WEIGHT, PLAYABLE_WEIGHT]).cards[0]?.playable).toBe(false);
  });
});

describe("sorting (§10.8)", () => {
  const hand = [
    card("H-3", "H", 3),
    card("S-2", "S", 2),
    card("C-7", "C", 7),
    card("JKR-1", null, null),
    card("S-7", "S", 7),
  ];

  it("sorts rank-then-suit weakest first, and reverses under revolution", () => {
    const upright = sortHand(hand, "rank", false).map((each) => each.id);
    expect(upright).toEqual(["H-3", "S-7", "C-7", "S-2", "JKR-1"]);
    // The strengths reverse; the suit tie-break does not, so the two 7s keep
    // their S-before-C order inside the reversed run.
    expect(sortHand(hand, "rank", true).map((each) => each.id)).toEqual([
      "JKR-1",
      "S-2",
      "S-7",
      "C-7",
      "H-3",
    ]);
  });

  it("sorts suit-then-rank with the jokers last", () => {
    expect(sortHand(hand, "suit", false).map((each) => each.id)).toEqual([
      "S-7",
      "S-2",
      "H-3",
      "C-7",
      "JKR-1",
    ]);
  });

  it("persists the preference and defaults without one", () => {
    expect(readHandSort()).toBe(DEFAULT_HAND_SORT);
    writeHandSort(nextHandSort(DEFAULT_HAND_SORT));
    expect(readHandSort()).toBe("suit");
    expect(nextHandSort("suit")).toBe("rank");
  });
});
