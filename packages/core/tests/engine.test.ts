/**
 * §12.2 interaction tests 11-20, plus the round lifecycle §7 hangs off (§3, §9).
 *
 * Every action goes through `act`, which asserts card conservation, the
 * `turnOrder` invariant, and the `stateVersion` increment after each one (§12.3
 * tests 21-23) — not only in the tests that are about them.
 */
import { describe, expect, it } from "vitest";
import { DECK_SIZE, openingLeaderId } from "../src/deck.js";
import { createGameState } from "../src/engine.js";
import type { Player } from "../src/types.js";
import { activeId, handIds, table } from "./fixtures.js";
import { act, assertInvariants, countCards, reject } from "./invariants.js";

function roster(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `P${index}`,
    role: null,
    seatIndex: index,
    isReady: true,
    isConnected: true,
  }));
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

describe("START_GAME (§3, §8.2)", () => {
  const lobby = createGameState({ roomId: "room", hostId: "p0", players: roster(4) });

  it("deals the whole deck and opens on the 3 of Diamonds (§3.3, §3.4)", () => {
    const state = act(lobby, { type: "START_GAME", seed: "seed-1" }, "p0");

    expect(state.status).toBe("IN_PROGRESS");
    expect(state.roundNumber).toBe(1);
    expect(countCards(state)).toBe(DECK_SIZE);
    expect(state.exchange).toBeNull();
    expect(activeId(state)).toBe(openingLeaderId(state.hands));
    expect(state.trickLeaderId).toBe(activeId(state));
  });

  it("is deterministic in the seed, which is the only randomness in core (§2)", () => {
    const a = act(lobby, { type: "START_GAME", seed: "seed-1" }, "p0");
    const b = act(lobby, { type: "START_GAME", seed: "seed-1" }, "p0");
    const c = act(lobby, { type: "START_GAME", seed: "seed-2" }, "p0");

    expect(handIds(a, "p0")).toEqual(handIds(b, "p0"));
    expect(handIds(a, "p0")).not.toEqual(handIds(c, "p0"));
  });

  it("is host-only, and will not restart a round in progress (§8.2)", () => {
    expect(reject(lobby, { type: "START_GAME", seed: "s" }, "p1")).toBe("NOT_HOST");
    const started = act(lobby, { type: "START_GAME", seed: "s" }, "p0");
    expect(reject(started, { type: "START_GAME", seed: "s" }, "p0")).toBe("GAME_ALREADY_STARTED");
  });

  it("needs three players (§0)", () => {
    const short = createGameState({ roomId: "room", hostId: "p0", players: roster(2) });
    expect(reject(short, { type: "START_GAME", seed: "s" }, "p0")).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("reseats around the finish order and enters the exchange from round 2 (§3.2, §4.2)", () => {
    const ended = table({
      hands: { p0: [], p1: ["S-4", "H-4"], p2: [], p3: [] },
      status: "ROUND_END",
      finished: ["p2", "p0", "p3"],
    });

    const state = act(ended, { type: "START_GAME", seed: "seed-2" }, "p0");

    // Finish order p2, p0, p3, p1: last place deals from seat 0, the winner sits
    // at N-1, and reading in turn order from the dealer gives it reversed (§3.2).
    expect(state.turnOrder).toEqual(["p1", "p3", "p0", "p2"]);
    expect(state.dealerId).toBe("p1");
    expect(state.players.map((player) => player.id)).toEqual(["p1", "p3", "p0", "p2"]);
    expect(state.status).toBe("EXCHANGE");
    expect(state.exchange?.required).toEqual({ p2: 2, p1: 2, p0: 1, p3: 1 });
    expect(state.exchange?.partner.p2).toBe("p1");
    expect(Object.keys(state.exchange?.forced ?? {}).sort()).toEqual(["p1", "p3"]);
  });
});

describe("UPDATE_RULES and SET_ROUND_LIMIT (§8.2, §10.11)", () => {
  const lobby = createGameState({ roomId: "room", hostId: "p0", players: roster(4) });

  it("are host-only", () => {
    expect(reject(lobby, { type: "UPDATE_RULES", config: { shibari: false } }, "p1")).toBe(
      "NOT_HOST",
    );
    expect(reject(lobby, { type: "SET_ROUND_LIMIT", limit: 5 }, "p1")).toBe("NOT_HOST");
  });

  it("merge a partial config and drop what is not a rule (§6)", () => {
    const state = act(lobby, { type: "UPDATE_RULES", config: { shibari: false } }, "p0");
    expect(state.config.shibari).toBe(false);
    expect(state.config.eightGiri).toBe(true);
  });

  it("take a positive whole round limit or null for endless (§9)", () => {
    expect(act(lobby, { type: "SET_ROUND_LIMIT", limit: 5 }, "p0").roundLimit).toBe(5);
    expect(act(lobby, { type: "SET_ROUND_LIMIT", limit: null }, "p0").roundLimit).toBeNull();
    expect(reject(lobby, { type: "SET_ROUND_LIMIT", limit: 0 }, "p0")).toBe("INVALID_ROUND_LIMIT");
    expect(reject(lobby, { type: "SET_ROUND_LIMIT", limit: 2.5 }, "p0")).toBe(
      "INVALID_ROUND_LIMIT",
    );
  });

  it("are refused mid-round: the toggles live in the lobby (§10.11)", () => {
    const playing = table({ hands: { p0: ["S-4"], p1: ["S-5"], p2: ["S-6"] } });
    expect(reject(playing, { type: "UPDATE_RULES", config: { kakumei: false } }, "p0")).toBe(
      "WRONG_STATUS",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* §12.2 test 11, 12, 17: the 7-pass halt and resume                          */
/* -------------------------------------------------------------------------- */

describe("7-pass halts the pipeline and resumes at Phase C (test 11, §7.2)", () => {
  const state = table({
    hands: {
      p0: ["S-7", "H-7", "D-7", "C-4", "S-2"],
      p1: ["H-9", "H-10"],
      p2: ["D-9"],
      p3: ["C-9"],
    },
  });
  const played = act(state, { type: "PLAY_CARDS", cardIds: ["S-7", "H-7", "D-7"] }, "p0");

  it("halts with a pending action and does not advance the turn", () => {
    expect(played.pendingAction).toEqual({
      type: "RESOLVE_7_PASS",
      count: 2,
      sourcePlayerId: "p0",
      targetPlayerId: "p1",
    });
    expect(activeId(played)).toBe("p0");
    expect(handIds(played, "p1")).toEqual(["H-9", "H-10"]);
  });

  it("blocks every other action while it stands (§8.0)", () => {
    expect(reject(played, { type: "PLAY_CARDS", cardIds: ["H-9"] }, "p1")).toBe(
      "PENDING_ACTION_BLOCKS",
    );
    expect(reject(played, { type: "PASS" }, "p0")).toBe("PENDING_ACTION_BLOCKS");
  });

  it("runs C, D, E and F on resume, against the post-transfer hand", () => {
    const resumed = act(played, { type: "SUBMIT_7_PASS", cardIds: ["C-4", "S-2"] }, "p0");

    expect(resumed.pendingAction).toBeNull();
    expect(handIds(resumed, "p0")).toEqual([]);
    expect(handIds(resumed, "p1")).toEqual(["H-9", "H-10", "C-4", "S-2"]);
    // Phase C: the transfer emptied the hand, so this is an agari (§7.3).
    expect(resumed.finishedPlayerIds).toEqual(["p0"]);
    // D and E are no-ops here rather than skipped: a combo resolves to one rank
    // (§5.3), and a rank of 7 is neither a trick ender nor a 5-skip.
    expect(resumed.currentTrick).toHaveLength(1);
    // Phase F advanced past the player who just went out.
    expect(activeId(resumed)).toBe("p1");
  });

  it("takes k = min(C, remaining) and refuses any other count (test 12, §6)", () => {
    const longer = table({
      hands: {
        p0: ["S-7", "H-7", "D-7", "C-4", "S-2", "S-3"],
        p1: ["H-9"],
        p2: ["D-9"],
        p3: ["C-9"],
      },
    });
    const halted = act(longer, { type: "PLAY_CARDS", cardIds: ["S-7", "H-7", "D-7"] }, "p0");

    expect(halted.pendingAction).toMatchObject({ count: 3 });
    expect(reject(halted, { type: "SUBMIT_7_PASS", cardIds: ["C-4"] }, "p0")).toBe(
      "WRONG_CARD_COUNT",
    );
    expect(reject(halted, { type: "SUBMIT_7_PASS", cardIds: ["C-4", "S-2", "S-3"] }, "p1")).toBe(
      "NOT_YOUR_TURN",
    );

    const resumed = act(halted, { type: "SUBMIT_7_PASS", cardIds: ["C-4", "S-2", "S-3"] }, "p0");
    expect(handIds(resumed, "p1")).toEqual(["H-9", "C-4", "S-2", "S-3"]);
    expect(activeId(resumed)).toBe("p1");
  });

  it("passes nothing when the 7 was the last card: k = 0 skips Phase B (§6)", () => {
    const last = table({
      hands: { p0: ["S-7"], p1: ["H-9"], p2: ["D-9"], p3: ["C-9"] },
    });
    const played7 = act(last, { type: "PLAY_CARDS", cardIds: ["S-7"] }, "p0");

    expect(played7.pendingAction).toBeNull();
    expect(played7.finishedPlayerIds).toEqual(["p0"]);
    expect(activeId(played7)).toBe("p1");
  });
});

describe("agari by 10-discard (test 17, §7.3)", () => {
  it("discards to the graveyard and the empty hand is a normal agari", () => {
    const state = table({
      hands: { p0: ["S-10", "C-4"], p1: ["H-9"], p2: ["D-9"], p3: ["C-9"] },
    });
    const played = act(state, { type: "PLAY_CARDS", cardIds: ["S-10"] }, "p0");
    expect(played.pendingAction).toEqual({ type: "RESOLVE_10_DISCARD", count: 1, playerId: "p0" });

    const resumed = act(played, { type: "SUBMIT_10_DISCARD", cardIds: ["C-4"] }, "p0");
    expect(handIds(resumed, "p0")).toEqual([]);
    expect(resumed.graveyard.some((card) => card.id === "C-4")).toBe(true);
    expect(resumed.finishedPlayerIds).toEqual(["p0"]);
    expect(activeId(resumed)).toBe("p1");
  });
});

/* -------------------------------------------------------------------------- */
/* §12.2 tests 13, 14: inversion and the suit lock                            */
/* -------------------------------------------------------------------------- */

describe("revolution and 11-back combine by XOR (test 13, §5.2)", () => {
  const state = table({
    // p0 keeps a card back so the Jack is not also an agari: this is about the
    // orientation flags, not about going out.
    hands: { p0: ["S-11", "C-2"], p1: ["H-10", "H-12"], p2: ["D-9"], p3: ["C-9"] },
    isRevolution: true,
  });

  it("an odd count of Jacks under revolution restores the upright order", () => {
    const played = act(state, { type: "PLAY_CARDS", cardIds: ["S-11"] }, "p0");
    expect(played.isRevolution).toBe(true);
    expect(played.trickInverted).toBe(true);

    // Upright again: the Queen beats the Jack and the Ten does not.
    expect(reject(played, { type: "PLAY_CARDS", cardIds: ["H-10"] }, "p1")).toBe("TOO_WEAK");
    const beaten = act(played, { type: "PLAY_CARDS", cardIds: ["H-12"] }, "p1");
    expect(beaten.currentTrick).toHaveLength(2);
  });

  it("resets `trickInverted` but not `isRevolution` when the trick clears (§7.4)", () => {
    const played = act(state, { type: "PLAY_CARDS", cardIds: ["S-11"] }, "p0");
    let cleared = played;
    for (const id of ["p1", "p2", "p3"]) cleared = act(cleared, { type: "PASS" }, id);

    expect(cleared.trickInverted).toBe(false);
    expect(cleared.isRevolution).toBe(true);
    expect(cleared.suitLock).toBeNull();
  });
});

describe("shibari plus revolution (test 14, §6)", () => {
  it("locks the suit multiset while the inverted order decides strength", () => {
    const state = table({
      hands: { p0: ["H-9"], p1: ["H-6"], p2: ["S-4", "H-4"], p3: ["C-9"] },
      isRevolution: true,
    });

    const led = act(state, { type: "PLAY_CARDS", cardIds: ["H-9"] }, "p0");
    const locked = act(led, { type: "PLAY_CARDS", cardIds: ["H-6"] }, "p1");
    expect(locked.suitLock).toEqual(["H"]);

    // The 4 of Spades is strong enough under revolution and still refused.
    expect(reject(locked, { type: "PLAY_CARDS", cardIds: ["S-4"] }, "p2")).toBe(
      "SUIT_LOCK_MISMATCH",
    );
    const followed = act(locked, { type: "PLAY_CARDS", cardIds: ["H-4"] }, "p2");
    expect(followed.suitLock).toEqual(["H"]);
  });
});

/* -------------------------------------------------------------------------- */
/* §12.2 tests 15, 16: 5-skip and 8-giri around a finished player             */
/* -------------------------------------------------------------------------- */

describe("5-skip wraps past finished players (test 15, §6)", () => {
  it("counts eligible seats only, so a finished seat costs the skip nothing", () => {
    const state = table({
      hands: { p0: ["S-5"], p1: [], p2: ["H-9"], p3: ["D-9"], p4: ["C-9"] },
      finished: ["p1"],
    });

    const played = act(state, { type: "PLAY_CARDS", cardIds: ["S-5"] }, "p0");
    expect(activeId(played)).toBe("p3");
  });
});

describe("8-giri played as the final card (test 16, §6, §7.4)", () => {
  it("clears the trick and hands the lead to the nearest eligible left neighbour", () => {
    const state = table({
      hands: { p0: ["S-8"], p1: ["H-9"], p2: ["D-9"], p3: ["C-9"] },
      trick: [{ playedBy: "p3", cards: ["S-6"] }],
      passed: ["p1", "p2"],
      active: "p0",
    });

    const played = act(state, { type: "PLAY_CARDS", cardIds: ["S-8"] }, "p0");

    expect(played.finishedPlayerIds).toEqual(["p0"]);
    expect(played.currentTrick).toEqual([]);
    expect(played.passedPlayerIds).toEqual([]);
    expect(played.trickLeaderId).toBe("p0");
    expect(activeId(played)).toBe("p1");
  });
});

/* -------------------------------------------------------------------------- */
/* §12.2 tests 18, 19, 20: passing                                            */
/* -------------------------------------------------------------------------- */

describe("a 7-pass target who then goes out (test 18, §7.3)", () => {
  it("wins with the card they were given, and the round ends behind them", () => {
    const start = table({
      hands: { p0: ["S-7", "C-4"], p1: ["D-9"], p2: ["H-6", "H-5"] },
      roundNumber: 2,
    });

    const halted = act(start, { type: "PLAY_CARDS", cardIds: ["S-7"] }, "p0");
    expect(halted.pendingAction).toMatchObject({ count: 1, targetPlayerId: "p1" });

    const resumed = act(halted, { type: "SUBMIT_7_PASS", cardIds: ["C-4"] }, "p0");
    expect(resumed.finishedPlayerIds).toEqual(["p0"]);
    expect(handIds(resumed, "p1")).toEqual(["D-9", "C-4"]);
    expect(activeId(resumed)).toBe("p1");

    const beaten = act(resumed, { type: "PLAY_CARDS", cardIds: ["D-9"] }, "p1");
    const passed = act(beaten, { type: "PASS" }, "p2");
    // p0 has finished and p2 has passed, so the trick returns to p1 (§7.5).
    expect(passed.currentTrick).toEqual([]);
    expect(activeId(passed)).toBe("p1");

    const out = act(passed, { type: "PLAY_CARDS", cardIds: ["C-4"] }, "p1");
    expect(out.finishedPlayerIds).toEqual(["p0", "p1"]);
    expect(out.status).toBe("ROUND_END");
    // N - finishPosition over p0, p1, p2 (§9).
    expect(out.points).toEqual({ p0: 2, p1: 1, p2: 0 });
    expect(out.players.map((player) => player.role?.kind)).toEqual([
      "DAI_FUGO",
      "HEIMIN",
      "DAI_HINMIN",
    ]);
  });
});

describe("all-pass clears the trick back to the leader (test 19, §7.5)", () => {
  it("returns the lead to `trickLeaderId` and unlocks everyone", () => {
    const state = table({
      hands: { p0: ["S-4"], p1: ["H-4"], p2: ["D-4"], p3: ["C-4"] },
      trick: [{ playedBy: "p0", cards: ["S-9"] }],
      active: "p1",
    });

    let passed = state;
    for (const id of ["p1", "p2", "p3"]) passed = act(passed, { type: "PASS" }, id);

    expect(passed.currentTrick).toEqual([]);
    expect(passed.passedPlayerIds).toEqual([]);
    expect(passed.trickLeaderId).toBe("p0");
    expect(activeId(passed)).toBe("p0");
  });
});

describe("the leader may not pass (test 20, §7.5)", () => {
  it("is refused with its own code, not a generic illegality (§8.0)", () => {
    const state = table({ hands: { p0: ["S-4"], p1: ["H-4"], p2: ["D-4"] } });
    expect(reject(state, { type: "PASS" }, "p0")).toBe("CANNOT_PASS_AS_LEADER");
  });

  it("still refuses a pass from a player whose turn it is not", () => {
    const state = table({
      hands: { p0: ["S-4"], p1: ["H-4"], p2: ["D-4"] },
      trick: [{ playedBy: "p0", cards: ["S-9"] }],
      active: "p1",
    });
    expect(reject(state, { type: "PASS" }, "p2")).toBe("NOT_YOUR_TURN");
  });
});

/* -------------------------------------------------------------------------- */
/* Round and match end (§9)                                                   */
/* -------------------------------------------------------------------------- */

describe("match end at the round limit (§9)", () => {
  it("ends the match rather than waiting for another deal", () => {
    const state = table({
      hands: { p0: ["S-4"], p1: [], p2: ["D-4"] },
      finished: ["p1"],
      roundNumber: 3,
      roundLimit: 3,
      points: { p0: 1, p1: 4, p2: 2 },
    });

    const out = act(state, { type: "PLAY_CARDS", cardIds: ["S-4"] }, "p0");
    expect(out.status).toBe("MATCH_END");
    expect(out.points).toEqual({ p0: 2, p1: 6, p2: 2 });
  });
});

/* -------------------------------------------------------------------------- */
/* §12.3 tests 21-23: the invariants themselves                               */
/* -------------------------------------------------------------------------- */

describe("invariants (§12.3)", () => {
  it("hold across a sequence of actions, not only at its end", () => {
    let state = table({
      hands: { p0: ["S-7", "C-4"], p1: ["H-9", "H-10"], p2: ["D-9"], p3: ["C-9"] },
    });
    const versions = [state.stateVersion];

    state = act(state, { type: "PLAY_CARDS", cardIds: ["S-7"] }, "p0");
    versions.push(state.stateVersion);
    state = act(state, { type: "SUBMIT_7_PASS", cardIds: ["C-4"] }, "p0");
    versions.push(state.stateVersion);
    state = act(state, { type: "PLAY_CARDS", cardIds: ["H-9"] }, "p1");
    versions.push(state.stateVersion);
    state = act(state, { type: "PASS" }, "p2");
    versions.push(state.stateVersion);

    // 21, 22 and 23 were asserted after every one of those by `act`; this pins
    // down the two that a single end-state snapshot could not show.
    expect(countCards(state)).toBe(DECK_SIZE);
    expect(state.turnOrder).toEqual(["p0", "p1", "p2", "p3"]);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("are not vacuous: a lost card fails invariant 21", () => {
    const state = table({ hands: { p0: ["S-4"], p1: ["H-4"], p2: ["D-4"] } });
    const lost = { ...state, stateVersion: state.stateVersion + 1, graveyard: [] };
    expect(() => assertInvariants(state, lost)).toThrow();
  });

  it("are not vacuous: a rewritten `turnOrder` fails invariant 22", () => {
    const state = table({ hands: { p0: ["S-4"], p1: ["H-4"], p2: ["D-4"] } });
    const shuffled = {
      ...state,
      stateVersion: state.stateVersion + 1,
      turnOrder: ["p2", "p1", "p0"],
    };
    expect(() => assertInvariants(state, shuffled)).toThrow();
  });
});
