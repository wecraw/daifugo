/**
 * What the hand may play (§10.3, §10.5, §10.6), asked of core's evaluator.
 *
 * The point of these is that the client never invents an answer: every set here
 * is checked against `generateLegalMoves` / `parseCombo` directly, so a drift
 * between what the row dims and what the server would accept fails here rather
 * than mid-round.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUSE_RULES,
  generateLegalMoves,
  parseCombo,
  type Card,
  type PlayCombo,
  type PublicGameState,
  type TrickContext,
} from "@daifugo/core";
import {
  bindingOptions,
  continuationIds,
  passBlocker,
  playableIds,
  resolveSelection,
  turnBlocker,
} from "../src/hand/legality";
import { publicState, player } from "./publicState";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

/** A combo built the way core builds one, so it can stand as a trick top. */
function top(cards: Card[]): PlayCombo {
  const parsed = parseCombo(cards);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const HAND = [card("S-5", "S", 5), card("H-5", "H", 5), card("C-9", "C", 9), card("D-13", "D", 13)];

describe("the playable set (§10.3)", () => {
  it("is exactly the cards core's legal moves use", () => {
    const ctx: TrickContext = { top: top([card("S-7", "S", 7)]) };
    const moves = generateLegalMoves(HAND, ctx);
    expect(playableIds(moves)).toEqual(new Set(["C-9", "D-13"]));
  });

  it("narrows to the cards that can still join the selection", () => {
    const moves = generateLegalMoves(HAND, {});
    expect(continuationIds(moves, [])).toEqual(playableIds(moves));
    // One 5 selected leaves the other 5 lit and nothing else: the only legal
    // continuation of that selection is the pair.
    expect(continuationIds(moves, ["S-5"])).toEqual(new Set(["S-5", "H-5"]));
  });
});

describe("selection legality (§10.6)", () => {
  it("names the reason rather than bucketing it", () => {
    const ctx: TrickContext = { top: top([card("S-11", "S", 11)]) };
    expect(resolveSelection([], null, ctx)).toEqual({ ok: false, error: "EMPTY_SELECTION" });
    expect(resolveSelection([card("C-9", "C", 9)], null, ctx)).toEqual({
      ok: false,
      error: "TOO_WEAK",
    });
    expect(resolveSelection([card("S-5", "S", 5), card("H-5", "H", 5)], null, ctx)).toEqual({
      ok: false,
      error: "COMBO_COUNT_MISMATCH",
    });
    expect(resolveSelection([card("S-5", "S", 5), card("C-9", "C", 9)], null, {})).toEqual({
      ok: false,
      error: "MIXED_RANKS",
    });
  });

  it("accepts what core accepts", () => {
    const result = resolveSelection([card("D-13", "D", 13)], null, {
      top: top([card("S-11", "S", 11)]),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a play the suit lock does not match (§6)", () => {
    const ctx: TrickContext = { top: top([card("S-11", "S", 11)]), suitLock: ["H"] };
    expect(resolveSelection([card("S-13", "S", 13)], null, ctx)).toEqual({
      ok: false,
      error: "SUIT_LOCK_MISMATCH",
    });
  });
});

describe("joker bindings (§10.5)", () => {
  const joker = card("JKR-1", null, null);

  it("offers the strongest legal binding first — the one the server would pick", () => {
    const selection = [card("S-8", "S", 8), joker];
    const options = bindingOptions(selection, {});
    const core = parseCombo(selection, undefined, { top: null, inverted: false });
    expect(core.ok).toBe(true);
    expect(options[0]?.combo).toEqual(core.ok ? core.value : null);
  });

  it("stays cyclable when leading, where every rank is legal", () => {
    const options = bindingOptions([joker], {});
    // Pure plus one option per rank: the badge has something to cycle through.
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]?.bindings).toEqual([]);
  });

  it("defaults a led joker to a 3 under revolution, and still offers pure (§5.5)", () => {
    const options = bindingOptions([joker], { isRevolution: true });
    expect(options[0]?.combo.resolvedRank).toBe(3);
    expect(options.some((option) => option.bindings.length === 0)).toBe(true);
  });

  it("keeps the suit that would set a lock as its own choice (§6)", () => {
    // A heart on the table: binding the joker to a heart locks the trick to
    // hearts, any other suit does not — so those are two different plays and the
    // badge has to be able to reach both.
    const ctx: TrickContext = { top: top([card("H-5", "H", 5)]) };
    const options = bindingOptions([joker], ctx);
    const sixes = options.filter((option) => option.combo.resolvedRank === 6);
    expect(sixes).toHaveLength(2);
    expect(sixes.some((option) => option.combo.suits[0] === "H")).toBe(true);
    expect(sixes.some((option) => option.combo.suits[0] !== "H")).toBe(true);
  });

  it("collapses the suits nothing can tell apart", () => {
    // Leading: no play to match, so no lock can be established and the suits
    // differ in nothing. One option per rank, plus pure.
    const options = bindingOptions([joker], {});
    const ranks = options.map((option) => option.combo.resolvedRank);
    expect(new Set(ranks).size).toBe(ranks.length);

    // Same table with shibari off: the lock variant is not a choice any more.
    const heartTop: TrickContext = { top: top([card("H-5", "H", 5)]) };
    const off = bindingOptions([joker], {
      ...heartTop,
      config: { ...DEFAULT_HOUSE_RULES, shibari: false },
    });
    expect(off.filter((option) => option.combo.resolvedRank === 6)).toHaveLength(1);
  });

  it("offers only the rank the naturals force", () => {
    const options = bindingOptions([card("S-8", "S", 8), joker], {});
    expect(new Set(options.map((option) => option.combo.resolvedRank))).toEqual(new Set([8]));
    expect(options).toHaveLength(1);
  });

  it("offers nothing to a selection that holds no joker", () => {
    expect(bindingOptions([card("S-8", "S", 8)], {})).toEqual([]);
  });

  it("keeps only bindings that are actually legal", () => {
    const ctx: TrickContext = { top: top([card("S-11", "S", 11)]) };
    const options = bindingOptions([joker], ctx);
    for (const option of options) {
      expect(resolveSelection([joker], option, ctx).ok).toBe(true);
    }
    expect(options.every((option) => option.combo.resolvedRank !== 3)).toBe(true);
  });
});

describe("what the table will not take right now", () => {
  function room(overrides: Partial<PublicGameState> = {}): PublicGameState {
    const players = [player("p_1", "Will"), player("p_2", "Alex")];
    return publicState({
      status: "IN_PROGRESS",
      players,
      turnOrder: ["p_1", "p_2"],
      activePlayerIndex: 0,
      myPlayerId: "p_1",
      ...overrides,
    });
  }

  it("reports the engine's own guards, in its order (§7.1, §7.5)", () => {
    expect(turnBlocker(room())).toBeNull();
    expect(turnBlocker(room({ status: "LOBBY" }))).toBe("WRONG_STATUS");
    expect(turnBlocker(room({ activePlayerIndex: 1 }))).toBe("NOT_YOUR_TURN");
    expect(
      turnBlocker(
        room({ pendingAction: { type: "RESOLVE_10_DISCARD", count: 1, playerId: "p_1" } }),
      ),
    ).toBe("PENDING_ACTION_BLOCKS");
  });

  it("will not let the leader pass (§7.5)", () => {
    expect(passBlocker(room())).toBe("CANNOT_PASS_AS_LEADER");
    const trick = [{ combo: top([card("S-7", "S", 7)]), playedBy: "p_2" }];
    expect(passBlocker(room({ currentTrick: trick }))).toBeNull();
    expect(passBlocker(room({ currentTrick: trick, passedPlayerIds: ["p_1"] }))).toBe(
      "ALREADY_PASSED",
    );
  });
});
