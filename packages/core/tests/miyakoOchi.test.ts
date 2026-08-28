/**
 * §12.6 tests 37-41: miyako-ochi (都落ち, §4.5).
 *
 * The previous round's `DAI_HINMIN` winning throws the previous round's
 * `DAI_FUGO` out of the capital, in last place, whatever their hand held. It is
 * always on, it reads the *carried* roles on `Player.role` rather than a resolved
 * rank, and it fires inside Phase C — so it fires for an agari reached by 7-pass
 * or 10-discard as readily as for one reached by a play (§7.3).
 *
 * Every action runs through `act`, so card conservation is asserted across the
 * demotion rather than exempted from it: the demoted hand moves to the graveyard
 * and the total stays at 54 (§12.3).
 */
import { describe, expect, it } from "vitest";
import { act, countCards } from "./invariants.js";
import { activeId, handIds, table } from "./fixtures.js";
import type { Role } from "../src/types.js";

const DAI_HINMIN: Role = { kind: "DAI_HINMIN" };
const DAI_FUGO: Role = { kind: "DAI_FUGO" };
const HEIMIN: Role = { kind: "HEIMIN", rank: 1 };
const HINMIN: Role = { kind: "HINMIN" };

/** p0 carries `DAI_HINMIN` and leads their last card; p1 carries `DAI_FUGO`. */
function demotionTable(overrides: Parameters<typeof table>[0]) {
  return table({
    roles: { p0: DAI_HINMIN, p1: DAI_FUGO, p2: HEIMIN, p3: HINMIN },
    roundNumber: 2,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* 37: the demotion itself                                                    */
/* -------------------------------------------------------------------------- */

describe("the demotion (test 37, §4.5)", () => {
  const before = demotionTable({
    hands: { p0: ["S-3"], p1: ["H-9", "H-10", "H-11"], p2: ["D-9"], p3: ["C-9"] },
  });
  const after = act(before, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

  it("drops the previous DAI_FUGO and empties their hand", () => {
    expect(after.finishedPlayerIds).toEqual(["p0"]);
    expect(after.droppedPlayerIds).toEqual(["p1"]);
    expect(handIds(after, "p1")).toEqual([]);
  });

  it("moves exactly that hand to the graveyard, conservation intact", () => {
    expect(after.graveyard.length - before.graveyard.length).toBe(3);
    for (const id of ["H-9", "H-10", "H-11"]) {
      expect(after.graveyard.some((card) => card.id === id)).toBe(true);
    }
    expect(countCards(after)).toBe(54);
  });

  it("leaves `turnOrder` alone and the round running (§2)", () => {
    expect(after.turnOrder).toEqual(["p0", "p1", "p2", "p3"]);
    expect(after.status).toBe("IN_PROGRESS");
    expect(activeId(after)).toBe("p2");
  });

  it("records a public history line with the card count, not the cards (§11)", () => {
    const entry = after.history.find((line) => line.key === "history.miyakoOchi");
    expect(entry?.params).toEqual({ player: "p0", target: "p1", count: 3 });
    expect(entry?.privateCardParams).toBeUndefined();
    expect(entry?.visibleTo).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 38: the four non-triggers                                                  */
/* -------------------------------------------------------------------------- */

describe("non-triggers (test 38, §4.5)", () => {
  const hands = { p0: ["S-3"], p1: ["H-9", "H-10"], p2: ["D-9"], p3: ["C-9"] };

  it("never fires in round 1, where every carried role is null", () => {
    const state = table({ hands, roundNumber: 1 });
    const after = act(state, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

    expect(after.droppedPlayerIds).toEqual([]);
    expect(handIds(after, "p1")).toEqual(["H-9", "H-10"]);
    expect(after.status).toBe("IN_PROGRESS");
  });

  it("does not fire when the winner carried any other role", () => {
    const state = demotionTable({ hands, roles: { p0: HINMIN, p1: DAI_FUGO } });
    const after = act(state, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

    expect(after.droppedPlayerIds).toEqual([]);
    expect(handIds(after, "p1")).toEqual(["H-9", "H-10"]);
  });

  it("does not fire on a 2nd-or-later agari", () => {
    const state = demotionTable({
      hands: { p0: ["S-3"], p1: ["H-9", "H-10"], p2: [], p3: ["C-9"] },
      finished: ["p2"],
    });
    const after = act(state, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

    expect(after.finishedPlayerIds).toEqual(["p2", "p0"]);
    expect(after.droppedPlayerIds).toEqual([]);
    expect(handIds(after, "p1")).toEqual(["H-9", "H-10"]);
  });

  it("no-ops when the previous DAI_FUGO has already left the room (§7.7)", () => {
    const state = demotionTable({
      hands: { p0: ["S-3"], p1: [], p2: ["D-9"], p3: ["C-9"] },
      dropped: ["p1"],
    });
    const after = act(state, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

    // Already at the bottom: the list is untouched rather than doubled up.
    expect(after.droppedPlayerIds).toEqual(["p1"]);
    expect(after.status).toBe("IN_PROGRESS");
  });
});

/* -------------------------------------------------------------------------- */
/* 39: agari via 7-pass, onto the demoted player                              */
/* -------------------------------------------------------------------------- */

describe("agari via 7-pass (test 39, §7.3)", () => {
  const before = demotionTable({
    hands: { p0: ["S-7", "C-4"], p1: ["H-9", "H-10"], p2: ["D-9"], p3: ["C-9"] },
  });

  it("fires from Phase C on the resume, with the target as the demoted player", () => {
    const halted = act(before, { type: "PLAY_CARDS", cardIds: ["S-7"] }, "p0");
    expect(halted.pendingAction).toMatchObject({ count: 1, targetPlayerId: "p1" });
    expect(halted.droppedPlayerIds).toEqual([]);

    const after = act(halted, { type: "SUBMIT_7_PASS", cardIds: ["C-4"] }, "p0");

    expect(after.finishedPlayerIds).toEqual(["p0"]);
    expect(after.droppedPlayerIds).toEqual(["p1"]);
    // The cards p1 was just given go to the graveyard with the rest of the hand.
    expect(handIds(after, "p1")).toEqual([]);
    expect(after.graveyard.some((card) => card.id === "C-4")).toBe(true);
    expect(after.graveyard.length - before.graveyard.length).toBe(3);
    expect(countCards(after)).toBe(54);
  });
});

/* -------------------------------------------------------------------------- */
/* 40: N = 3, where the demotion ends the round                               */
/* -------------------------------------------------------------------------- */

describe("N = 3 (test 40, §4.1, §9)", () => {
  it("ends the round immediately and scores the demoted player zero", () => {
    const state = table({
      hands: { p0: ["S-3"], p1: ["H-9", "H-10"], p2: ["D-9"] },
      roles: { p0: DAI_HINMIN, p1: DAI_FUGO, p2: HEIMIN },
      roundNumber: 2,
      points: { p0: 0, p1: 4, p2: 2 },
    });

    const after = act(state, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

    expect(after.status).toBe("ROUND_END");
    expect(after.droppedPlayerIds).toEqual(["p1"]);
    // Final order: the winner, the one remaining player, then the demoted player.
    expect(after.points).toEqual({ p0: 2, p1: 4, p2: 3 });
    expect(after.players.map((player) => player.role)).toEqual([
      { kind: "DAI_FUGO" },
      { kind: "DAI_HINMIN" },
      { kind: "HEIMIN", rank: 1 },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* 41: post-demotion eligibility                                              */
/* -------------------------------------------------------------------------- */

describe("post-demotion eligibility (test 41, §4.5, §7.5)", () => {
  const start = table({
    hands: {
      p0: ["S-3"],
      p1: ["H-9", "H-10", "H-11"],
      p2: ["S-5", "C-6"],
      p3: ["D-9"],
      p4: ["S-7", "C-8"],
    },
    roles: { p0: DAI_HINMIN, p1: DAI_FUGO, p2: HEIMIN, p3: HINMIN, p4: HEIMIN },
    roundNumber: 2,
  });
  const demoted = act(start, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");

  it("is never advanced to", () => {
    expect(demoted.droppedPlayerIds).toEqual(["p1"]);
    expect(activeId(demoted)).toBe("p2");
    expect(demoted.turnOrder).toHaveLength(5);
  });

  it("is not counted by 5-skip (§6)", () => {
    // One 5 skips one *eligible* seat: p3. p1 is dropped and costs nothing.
    const skipped = act(demoted, { type: "PLAY_CARDS", cardIds: ["S-5"] }, "p2");
    expect(activeId(skipped)).toBe("p4");
  });

  it("is not a 7-pass target (§6)", () => {
    const skipped = act(demoted, { type: "PLAY_CARDS", cardIds: ["S-5"] }, "p2");
    const halted = act(skipped, { type: "PLAY_CARDS", cardIds: ["S-7"] }, "p4");

    // Left of p4 sits p0, who has finished, then p1, who is dropped.
    expect(halted.pendingAction).toMatchObject({ count: 1, targetPlayerId: "p2" });
  });

  it("is skipped as the `clearTrick` leader (§7.4)", () => {
    // p1 led the trick and was demoted while their play stood on the table.
    const state = table({
      hands: { p0: [], p1: [], p2: ["H-4"], p3: ["D-4"], p4: ["C-4"] },
      roles: { p0: DAI_HINMIN, p1: DAI_FUGO },
      finished: ["p0"],
      dropped: ["p1"],
      trick: [{ playedBy: "p1", cards: ["S-9"] }],
      trickLeaderId: "p1",
      active: "p2",
    });

    // The clear is measured against the trick leader, not a count of remaining
    // eligible seats (§7.5): p1 is dropped and so is not one of them, and p4 is
    // owed the turn in which they could beat the card still on the table.
    const two = act(state, { type: "PASS" }, "p2");
    const three = act(two, { type: "PASS" }, "p3");
    expect(three.currentTrick).toHaveLength(1);
    expect(activeId(three)).toBe("p4");

    const passed = act(three, { type: "PASS" }, "p4");

    expect(passed.currentTrick).toEqual([]);
    expect(passed.trickLeaderId).toBe("p1");
    expect(activeId(passed)).toBe("p2");
    expect(passed.turnOrder).toHaveLength(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Downstream: the next round (§3.2, §4.1)                                    */
/* -------------------------------------------------------------------------- */

describe("the round after a demotion (§4.5 downstream)", () => {
  // Test 42's other half — a mid-round leave after a demotion sitting above the
  // demoted player, not below — lives with the rest of §7.7 in `roster.test.ts`.

  it("makes the demoted player dealer at seat 0 and the winner DAI_FUGO at N-1", () => {
    const state = table({
      hands: { p0: ["S-3"], p1: ["H-9", "H-10"], p2: ["D-9"] },
      roles: { p0: DAI_HINMIN, p1: DAI_FUGO, p2: HEIMIN },
      roundNumber: 2,
    });

    const ended = act(state, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");
    const dealt = act(ended, { type: "START_GAME", seed: "seed-3" }, "p0");

    expect(dealt.turnOrder).toEqual(["p1", "p2", "p0"]);
    expect(dealt.dealerId).toBe("p1");
    expect(dealt.players.find((player) => player.id === "p0")?.seatIndex).toBe(2);
    // The two swap the top and bottom roles outright, so the exchange pairs them.
    expect(dealt.status).toBe("EXCHANGE");
    expect(dealt.exchange?.partner.p0).toBe("p1");
    expect(dealt.exchange?.required).toEqual({ p0: 1, p1: 1 });
  });
});
