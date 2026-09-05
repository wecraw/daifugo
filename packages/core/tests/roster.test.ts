/**
 * Roster changes (§7.7), and the finish order they land in (§4.1, §4.5).
 *
 * Joins and leaves queue and apply at a round boundary, so `turnOrder` is never
 * touched mid-round (§2). The one thing that happens immediately is the leaver
 * dropping out of the round they were in: their hand goes to the graveyard,
 * eligibility loses them, and they take a place in `droppedPlayerIds` — above a
 * miyako-ochi demotion, which is absolutely last (§4.5).
 */
import { describe, expect, it } from "vitest";
import { DECK_SIZE } from "../src/deck.js";
import { createGameState, queueJoin, queueLeave } from "../src/engine.js";
import { createExchangeState } from "../src/roles.js";
import type { GameState, Player, Role } from "../src/types.js";
import { activeId, handIds, table } from "./fixtures.js";
import { act, assertInvariants, countCards } from "./invariants.js";

const DAI_HINMIN: Role = { kind: "DAI_HINMIN" };
const DAI_FUGO: Role = { kind: "DAI_FUGO" };

function newcomer(id: string): Player {
  return { id, name: id.toUpperCase(), role: null, seatIndex: 0, isReady: true, isConnected: true };
}

function join(state: GameState, id: string): GameState {
  const result = queueJoin(state, newcomer(id));
  if (!result.ok) throw new Error(`unexpected ${result.error} from a join`);
  assertInvariants(state, result.value);
  return result.value;
}

function leave(state: GameState, id: string): GameState {
  const result = queueLeave(state, id);
  if (!result.ok) throw new Error(`unexpected ${result.error} from a leave`);
  assertInvariants(state, result.value);
  return result.value;
}

function lobby(count: number): GameState {
  return createGameState({
    roomId: "room",
    hostId: "p0",
    players: Array.from({ length: count }, (_, index) => newcomer(`p${index}`)),
  });
}

/* -------------------------------------------------------------------------- */
/* The lobby: no round to wait for                                            */
/* -------------------------------------------------------------------------- */

describe("the lobby roster (§7.7)", () => {
  it("seats an arrival and clears a departure immediately", () => {
    const joined = join(lobby(3), "p3");
    expect(joined.turnOrder).toEqual(["p0", "p1", "p2", "p3"]);
    expect(joined.points.p3).toBe(0);
    expect(joined.pendingJoins).toEqual([]);

    const left = leave(joined, "p1");
    expect(left.turnOrder).toEqual(["p0", "p2", "p3"]);
    expect(left.players.map((player) => player.seatIndex)).toEqual([0, 1, 2]);
    expect(left.hands.p1).toBeUndefined();
  });

  it("refuses a duplicate name and a ninth seat (§8.0)", () => {
    expect(queueJoin(lobby(8), newcomer("p8"))).toMatchObject({ error: "ROOM_FULL" });

    const taken = { ...newcomer("p9"), name: "P1" };
    expect(queueJoin(lobby(3), taken)).toMatchObject({ error: "NAME_TAKEN" });
  });

  it("hands the host on when the host leaves (§8.2)", () => {
    const left = leave(lobby(3), "p0");

    expect(left.hostId).toBe("p1");
    expect(left.history.map((entry) => entry.key)).toContain("history.hostTransferred");
  });

  it("refuses a leave from someone who was never in the room", () => {
    expect(queueLeave(lobby(3), "ghost")).toMatchObject({ error: "PLAYER_NOT_FOUND" });
  });
});

/* -------------------------------------------------------------------------- */
/* MATCH_END: terminal, so nobody queues for a round that will never come     */
/* -------------------------------------------------------------------------- */

describe("a join once the match has ended (§7.7)", () => {
  it("is refused instead of queued", () => {
    const over = { ...lobby(3), status: "MATCH_END" as const };
    expect(queueJoin(over, newcomer("p3"))).toMatchObject({ error: "WRONG_STATUS" });
  });
});

/* -------------------------------------------------------------------------- */
/* Mid-round: the leaver finishes last (§7.7, test 29)                        */
/* -------------------------------------------------------------------------- */

describe("a mid-round leave (§7.7)", () => {
  const state = table({
    hands: { p0: ["S-9", "H-4"], p1: ["D-6", "D-7"], p2: ["C-8"], p3: ["C-11"] },
    active: "p0",
  });

  it("drops the leaver, banks their hand, and runs the round on", () => {
    const left = leave(state, "p1");

    expect(left.droppedPlayerIds).toEqual(["p1"]);
    expect(handIds(left, "p1")).toEqual([]);
    expect(left.graveyard.some((card) => card.id === "D-6")).toBe(true);
    expect(countCards(left)).toBe(DECK_SIZE);
    expect(left.status).toBe("IN_PROGRESS");
    expect(left.turnOrder).toEqual(["p0", "p1", "p2", "p3"]);
    expect(left.pendingLeaves).toEqual(["p1"]);
  });

  it("is never advanced to, and never a 7-pass target (§7.5)", () => {
    const left = leave(state, "p1");
    const played = act(left, { type: "PLAY_CARDS", cardIds: ["H-4"] }, "p0");

    expect(activeId(played)).toBe("p2");
  });

  it("hands the turn on when the departing player was to act", () => {
    const left = leave(state, "p0");

    expect(left.droppedPlayerIds).toEqual(["p0"]);
    expect(activeId(left)).toBe("p1");
  });

  it("ends the round when only one player is left holding cards", () => {
    const three = table({
      hands: { p0: [], p1: ["D-6"], p2: ["C-8"] },
      finished: ["p0"],
      active: "p1",
    });
    const left = leave(three, "p2");

    expect(left.status).toBe("ROUND_END");
    // p0 out first, p1 the last one holding cards, p2 bottom of the order.
    expect(left.points).toMatchObject({ p0: 2, p1: 1, p2: 0 });
  });

  it("resumes the pipeline when the player owing a pending action leaves (§7.2)", () => {
    const owing = act(
      table({ hands: { p0: ["S-7", "H-4", "D-2"], p1: ["C-5"], p2: ["C-8"] } }),
      { type: "PLAY_CARDS", cardIds: ["S-7"] },
      "p0",
    );
    expect(owing.pendingAction).not.toBeNull();

    const left = leave(owing, "p0");

    expect(left.pendingAction).toBeNull();
    expect(left.finishedPlayerIds).toEqual([]);
    expect(left.droppedPlayerIds).toEqual(["p0"]);
    expect(activeId(left)).toBe("p1");
  });

  it("sends a player who leaves after their agari to the bottom anyway (§7.7)", () => {
    // p0 already went out; the round is still running for p1 and p2.
    const won = table({
      hands: { p0: [], p1: ["D-6"], p2: ["C-8"] },
      finished: ["p0"],
      active: "p1",
    });
    const left = leave(won, "p0");

    // A mid-round leave finishes last whatever they had already earned, and
    // `finishOrderOf` reads an id in both lists as dropped.
    expect(left.droppedPlayerIds).toEqual(["p0"]);
    expect(left.finishedPlayerIds).toEqual(["p0"]);
    expect(left.status).toBe("IN_PROGRESS");
    expect(countCards(left)).toBe(DECK_SIZE);

    const ended = act(left, { type: "PLAY_CARDS", cardIds: ["D-6"] }, "p1");

    expect(ended.status).toBe("ROUND_END");
    expect(ended.points).toMatchObject({ p1: 2, p2: 1, p0: 0 });
    expect(ended.players.find((player) => player.id === "p0")?.role).toEqual(DAI_HINMIN);
  });

  it("retargets an owed 7-pass when its recipient leaves (§7.2, §6)", () => {
    const owing = act(
      table({ hands: { p0: ["S-7", "H-4", "D-2"], p1: ["C-5"], p2: ["C-8"], p3: ["C-9"] } }),
      { type: "PLAY_CARDS", cardIds: ["S-7"] },
      "p0",
    );
    expect(owing.pendingAction).toMatchObject({ type: "RESOLVE_7_PASS", targetPlayerId: "p1" });

    const left = leave(owing, "p1");

    // The cards cannot follow p1 into a departed seat, so the transfer moves on to
    // the nearest player still in the round to p0's left.
    expect(left.pendingAction).toMatchObject({ type: "RESOLVE_7_PASS", targetPlayerId: "p2" });

    const submitted = act(left, { type: "SUBMIT_7_PASS", cardIds: ["H-4"] }, "p0");

    expect(handIds(submitted, "p2")).toEqual(["C-8", "H-4"]);
    expect(handIds(submitted, "p1")).toEqual([]);
    expect(countCards(submitted)).toBe(DECK_SIZE);
  });

  it("drops an owed 7-pass when its recipient was the last player to give to", () => {
    const owing = act(
      table({ hands: { p0: ["S-7", "H-4", "D-2"], p1: ["C-5"], p2: [] }, finished: ["p2"] }),
      { type: "PLAY_CARDS", cardIds: ["S-7"] },
      "p0",
    );
    expect(owing.pendingAction).toMatchObject({ type: "RESOLVE_7_PASS", targetPlayerId: "p1" });

    const left = leave(owing, "p1");

    // Nobody is left in the round to receive: the pipeline runs on exactly as it
    // would have had Phase B never set the pending action, and p0 is the last
    // player holding cards, so the round ends.
    expect(left.pendingAction).toBeNull();
    expect(left.status).toBe("ROUND_END");
    expect(handIds(left, "p0")).toEqual(["H-4", "D-2"]);
    expect(left.points).toMatchObject({ p2: 2, p0: 1, p1: 0 });
    expect(countCards(left)).toBe(DECK_SIZE);
  });

  it("dissolves the pair when a player leaves during the exchange (§4.3)", () => {
    const dealt = table({
      hands: { p0: ["S-4", "H-13"], p1: ["D-6"], p2: ["C-8", "C-9"] },
      status: "EXCHANGE",
    });
    const state = { ...dealt, exchange: createExchangeState(["p0", "p1", "p2"], dealt.hands) };
    const left = leave(state, "p2");

    // p0 had nobody left to give to, so the phase completes with no transfer.
    expect(left.status).toBe("IN_PROGRESS");
    expect(left.exchange).toBeNull();
    expect(handIds(left, "p0")).toEqual(["S-4", "H-13"]);
    expect(countCards(left)).toBe(DECK_SIZE);
  });
});

/* -------------------------------------------------------------------------- */
/* The boundary: the next deal uses the post-change roster (§7.7)             */
/* -------------------------------------------------------------------------- */

describe("a leave from someone who has not been seated yet (§7.7)", () => {
  it("cancels the arrival instead of dropping anyone from the round", () => {
    const playing = table({ hands: { p0: ["S-4"], p1: ["H-4"], p2: ["D-4"] } });
    const queued = join(playing, "p3");
    expect(queued.pendingJoins.map((player) => player.id)).toEqual(["p3"]);

    const cancelled = leave(queued, "p3");
    expect(cancelled.pendingJoins).toEqual([]);
    // Nothing else in the state knows about them: no seat, no pending leave to
    // apply at the boundary, and no hand to bank.
    expect(cancelled.pendingLeaves).toEqual([]);
    expect(cancelled.droppedPlayerIds).toEqual([]);
    expect(cancelled.turnOrder).toEqual(["p0", "p1", "p2"]);
  });
});

describe("the round boundary (§7.7, §3.2, §4.2)", () => {
  // p2 and p3 are out; p0 plays their last card and p1 is left holding theirs, so
  // the finish order of the round just ended is p2, p3, p0, p1.
  const ended = act(
    table({
      hands: { p0: ["S-3"], p1: ["H-4"], p2: [], p3: [] },
      finished: ["p2", "p3"],
      active: "p0",
    }),
    { type: "PLAY_CARDS", cardIds: ["S-3"] },
    "p0",
  );

  it("applies a queued join, seating the newcomer at the bottom of the order", () => {
    const joined = join(ended, "p4");
    expect(joined.pendingJoins).toHaveLength(1);
    expect(joined.turnOrder).toEqual(["p0", "p1", "p2", "p3"]);

    const dealt = act(joined, { type: "START_GAME", seed: "seed-r" }, "p0");

    // The newcomer has no finish position, so they enter below the order and deal
    // from seat 0; the winner still sits at N-1 (§3.2).
    expect(dealt.turnOrder).toEqual(["p4", "p1", "p0", "p3", "p2"]);
    expect(dealt.dealerId).toBe("p4");
    expect(dealt.players).toHaveLength(5);
    expect(dealt.pendingJoins).toEqual([]);
    expect(dealt.points.p4).toBe(0);
    // Pairing runs over the post-change roster at the §4.2 counts for N = 5, with
    // the middle seat sitting the exchange out.
    expect(dealt.exchange?.partner).toMatchObject({ p2: "p4", p3: "p1" });
    expect(dealt.exchange?.required).toMatchObject({ p2: 2, p4: 2, p3: 1, p1: 1 });
    expect(dealt.exchange?.required.p0).toBeUndefined();
  });

  it("applies a queued leave, reseating and pairing around what is left", () => {
    const left = leave(ended, "p1");
    expect(left.turnOrder).toEqual(["p0", "p1", "p2", "p3"]);
    expect(left.pendingLeaves).toEqual(["p1"]);

    const dealt = act(left, { type: "START_GAME", seed: "seed-r" }, "p0");

    expect(dealt.turnOrder).toEqual(["p0", "p3", "p2"]);
    expect(dealt.players.map((player) => player.id)).toEqual(["p0", "p3", "p2"]);
    expect(dealt.hands.p1).toBeUndefined();
    expect(dealt.points.p1).toBeUndefined();
    expect(dealt.pendingLeaves).toEqual([]);
    expect(dealt.exchange?.required).toEqual({ p2: 1, p0: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* Test 42: a leave after a demotion (§12.6, §4.5, §7.7)                      */
/* -------------------------------------------------------------------------- */

describe("a leave after a miyako-ochi demotion (test 42, §4.5)", () => {
  const demoted = act(
    table({
      hands: { p0: ["S-3"], p1: ["H-4", "H-5"], p2: ["D-4"], p3: ["C-4"] },
      roles: { p0: DAI_HINMIN, p1: DAI_FUGO },
      active: "p0",
    }),
    { type: "PLAY_CARDS", cardIds: ["S-3"] },
    "p0",
  );

  it("sits the leaver above the demoted player, who stays dead last", () => {
    expect(demoted.droppedPlayerIds).toEqual(["p1"]);

    const left = leave(demoted, "p2");

    expect(left.droppedPlayerIds).toEqual(["p2", "p1"]);
  });

  it("does not enter the demoted player twice when they then leave", () => {
    const left = leave(demoted, "p1");

    expect(left.droppedPlayerIds).toEqual(["p1"]);
    expect(left.pendingLeaves).toEqual(["p1"]);
    expect(countCards(left)).toBe(DECK_SIZE);
  });

  it("keeps them dead last even once they have left the room themselves", () => {
    // The demoted player leaving does not turn their demotion into an ordinary
    // mid-round leave: §4.5 puts them below everyone, and a leave that happens
    // afterwards is still a leave (§7.7). Found by the fuzz run (§12.3 test 24),
    // which reached it through a join, a demotion, and two departures.
    const both = leave(leave(demoted, "p1"), "p2");

    expect(both.droppedPlayerIds).toEqual(["p2", "p1"]);
    expect(both.status).toBe("ROUND_END");
    expect(both.points).toMatchObject({ p0: 3, p3: 2, p2: 1, p1: 0 });
  });

  it("carries that order into the finish order, the roles, and the points", () => {
    const left = leave(demoted, "p2");

    expect(left.status).toBe("ROUND_END");
    // p0 won, p3 was the last holding cards, then the leaver, then the demoted.
    expect(left.points).toMatchObject({ p0: 3, p3: 2, p2: 1, p1: 0 });
    expect(left.players.find((player) => player.id === "p1")?.role).toEqual(DAI_HINMIN);
    expect(left.players.find((player) => player.id === "p0")?.role).toEqual(DAI_FUGO);
  });
});
