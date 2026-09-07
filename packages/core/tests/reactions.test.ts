/**
 * The quick-react vocabulary. Ids only: the phrases are the client's (§11), and
 * nothing here may leak into game state.
 */
import { describe, expect, it } from "vitest";
import {
  REACTION_COOLDOWN_MS,
  REACTION_IDS,
  REACTION_MENU_SIZE,
  isReactionId,
} from "../src/reactions.js";

describe("quick reactions", () => {
  it("offers a pool worth drawing from, with no duplicates", () => {
    expect(new Set(REACTION_IDS).size).toBe(REACTION_IDS.length);
    expect(REACTION_IDS.length).toBeGreaterThanOrEqual(20);
  });

  it("draws fewer than the pool holds, so the menu varies", () => {
    expect(REACTION_MENU_SIZE).toBeLessThan(REACTION_IDS.length);
    expect(REACTION_MENU_SIZE).toBeGreaterThan(0);
  });

  it("carries no copy: an id is an identifier, not a phrase", () => {
    for (const id of REACTION_IDS) expect(id).toMatch(/^[a-zA-Z]+$/);
  });

  it("accepts only ids from the pool", () => {
    for (const id of REACTION_IDS) expect(isReactionId(id)).toBe(true);
    for (const value of ["", "GET BENT", "getbent", 1, null, undefined, {}]) {
      expect(isReactionId(value)).toBe(false);
    }
  });

  it("rate-limits at a gap a human can still talk through", () => {
    expect(REACTION_COOLDOWN_MS).toBeGreaterThan(0);
    expect(REACTION_COOLDOWN_MS).toBeLessThanOrEqual(5000);
  });
});
