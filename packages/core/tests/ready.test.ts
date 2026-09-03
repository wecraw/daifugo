/**
 * Readiness and the deal gate (§8.6, §12.2 test 20a).
 *
 * `SET_READY` is the one action that is nobody's to send but the sender's, and
 * the only one whose whole purpose is to be read by `START_GAME`. The exemptions
 * are what the tests are really about: the host, whose start click is their own
 * readiness, and a disconnected player, who cannot press anything and must not
 * hold the table until the §8.3 grace expires.
 */
import { describe, expect, it } from "vitest";
import { createDeck } from "../src/deck.js";
import { createGameState, unreadyPlayerIds } from "../src/engine.js";
import type { GameState, Player } from "../src/types.js";
import { act, reject } from "./invariants.js";

function roster(count: number, overrides: Partial<Player> = {}): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `P${index}`,
    role: null,
    seatIndex: index,
    isReady: false,
    isConnected: true,
    ...overrides,
  }));
}

function lobby(players: Player[] = roster(4)): GameState {
  return createGameState({ roomId: "room", hostId: "p0", players });
}

function readyOf(state: GameState, playerId: string): boolean {
  return [...state.players, ...state.pendingJoins].find((p) => p.id === playerId)?.isReady ?? false;
}

describe("SET_READY (§8.6)", () => {
  it("sets the sender's flag and nobody else's", () => {
    const state = act(lobby(), { type: "SET_READY", ready: true }, "p1");

    expect(readyOf(state, "p1")).toBe(true);
    expect(readyOf(state, "p2")).toBe(false);
  });

  it("is idempotent, and un-readies just as well", () => {
    const once = act(lobby(), { type: "SET_READY", ready: true }, "p1");
    const twice = act(once, { type: "SET_READY", ready: true }, "p1");
    // The write still commits: the version bump is what carries the broadcast.
    expect(twice.stateVersion).toBe(once.stateVersion + 1);
    expect(readyOf(act(twice, { type: "SET_READY", ready: false }, "p1"), "p1")).toBe(false);
  });

  it("reaches a player still waiting in pendingJoins (§7.7)", () => {
    // Someone who joined mid-round waits in the queue until the next deal — the
    // very deal their readiness gates — so the flag has to be writable there.
    const queued: Player = {
      id: "p4",
      name: "P4",
      role: null,
      seatIndex: 4,
      isReady: false,
      isConnected: true,
    };
    const between: GameState = {
      ...lobby(roster(4, { isReady: true })),
      status: "ROUND_END",
      roundNumber: 1,
      pendingJoins: [queued],
      // A round that ended: every card is off the hands and on the table, which
      // is what keeps the conservation check in `act` happy (§12.3).
      graveyard: createDeck(),
    };

    expect(unreadyPlayerIds(between)).toEqual(["p4"]);
    expect(reject(between, { type: "START_GAME", seed: "s" }, "p0")).toBe("PLAYERS_NOT_READY");

    const ready = act(between, { type: "SET_READY", ready: true }, "p4");
    expect(readyOf(ready, "p4")).toBe(true);
    expect(unreadyPlayerIds(ready)).toEqual([]);
  });

  it("is refused outside the two statuses a deal can follow", () => {
    const dealt = act(lobby(roster(4, { isReady: true })), { type: "START_GAME", seed: "s" }, "p0");
    expect(reject(dealt, { type: "SET_READY", ready: true }, "p1")).toBe("WRONG_STATUS");
  });

  it("is refused for someone with no seat", () => {
    expect(reject(lobby(), { type: "SET_READY", ready: true }, "nobody")).toBe("PLAYER_NOT_FOUND");
  });
});

describe("the deal gate (§8.6)", () => {
  it("refuses START_GAME while a connected non-host seat is unready", () => {
    const state = lobby();
    expect(unreadyPlayerIds(state)).toEqual(["p1", "p2", "p3"]);
    expect(reject(state, { type: "START_GAME", seed: "s" }, "p0")).toBe("PLAYERS_NOT_READY");
  });

  it("exempts the host, whose start click is their own readiness", () => {
    let state = lobby();
    for (const id of ["p1", "p2", "p3"]) state = act(state, { type: "SET_READY", ready: true }, id);

    expect(readyOf(state, "p0")).toBe(false);
    expect(unreadyPlayerIds(state)).toEqual([]);
    expect(act(state, { type: "START_GAME", seed: "s" }, "p0").status).toBe("IN_PROGRESS");
  });

  it("exempts a disconnected player rather than stalling on the grace period (§8.3)", () => {
    const players = roster(4, { isReady: true }).map((player) =>
      player.id === "p3" ? { ...player, isReady: false, isConnected: false } : player,
    );
    const state = lobby(players);

    expect(unreadyPlayerIds(state)).toEqual([]);
    expect(act(state, { type: "START_GAME", seed: "s" }, "p0").status).toBe("IN_PROGRESS");
  });

  it("clears the roster's flags on the deal, so the next lobby readies again", () => {
    let state = lobby();
    for (const id of ["p1", "p2", "p3"]) state = act(state, { type: "SET_READY", ready: true }, id);
    const dealt = act(state, { type: "START_GAME", seed: "s" }, "p0");

    expect(dealt.players.every((player) => !player.isReady)).toBe(true);
  });
});
