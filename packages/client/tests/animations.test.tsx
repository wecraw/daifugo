/**
 * Animations and rule banners (#20, §10.9, §4.5).
 *
 * The client is never told what happened — it is handed a new `PublicGameState`
 * after every action (§8.4) — so the whole vocabulary is derived from the history
 * two consecutive states differ by. That derivation is a pure function, which is
 * where most of this file points: what the layer draws needs a browser to judge,
 * but *when* and *in what order* it draws does not.
 *
 * The two acceptance criteria are checked as such:
 *
 * - "never block input past their duration, and never delay the authoritative
 *   state" — the layer takes no pointer events, the new state is on screen in the
 *   same commit that queues the animation over it, and every entry leaves the DOM
 *   on its own timer;
 * - "the miyako-ochi sweep plays after the winner's agari animation" — the
 *   miyako-ochi entry is delayed by exactly the agari's duration, and nothing of
 *   it is in the DOM until that delay is spent.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history, type Card, type HistoryEntry, type PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import {
  AGARI_MS,
  GIRI_MS,
  MAX_DELTA_ENTRIES,
  MIYAKO_OCHI_MS,
  REVOLUTION_MS,
  SEVEN_PASS_MS,
  SKIP_MS,
  SKIP_STAGGER_MS,
  TRICK_SWEEP_MS,
  deriveTableAnimations,
  miyakoOchiTarget,
} from "../src/animation/events";
import { GRAVEYARD_TRAVEL, SEAT_TRAVEL, travelTo } from "../src/animation/geometry";
import { seatEdgeOf } from "../src/layout/tableLayout";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

function table(count: number, overrides: Partial<PublicGameState> = {}): PublicGameState {
  const players = Array.from({ length: count }, (_, index) =>
    player(`p_${index + 1}`, `Seat${index + 1}`, { seatIndex: index }),
  );
  return publicState({
    status: "IN_PROGRESS",
    players,
    turnOrder: players.map((seat) => seat.id),
    hands: Object.fromEntries(players.map((seat) => [seat.id, { cardCount: 4 }])),
    ...overrides,
  });
}

/** The state one action later: a bumped version and the entries it logged. */
function after(
  state: PublicGameState,
  added: readonly HistoryEntry[],
  overrides: Partial<PublicGameState> = {},
): PublicGameState {
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    history: [...state.history, ...added],
    ...overrides,
  };
}

describe("deriving what just happened (§10.9)", () => {
  it("animates nothing when no action was applied", () => {
    const room = table(4);
    expect(deriveTableAnimations(room, room)).toEqual([]);
    expect(deriveTableAnimations(room, { ...room, stateVersion: 2 })).toEqual([]);
  });

  it("animates nothing for another room's state", () => {
    const room = table(4);
    const other = after(room, [history("history.eightGiri", { player: "p_2" })], {
      roomId: "ZZZ999",
    });
    expect(deriveTableAnimations(room, other)).toEqual([]);
  });

  it("animates nothing for a resync, which is a state to draw and not a play", () => {
    const room = table(4);
    const flood = Array.from({ length: MAX_DELTA_ENTRIES + 1 }, () =>
      history("history.eightGiri", { player: "p_2" }),
    );
    expect(deriveTableAnimations(room, after(room, flood))).toEqual([]);
  });

  it("sweeps the whole trick, including the play that cleared it", () => {
    const three = card("S-3", "S", 3);
    const eight = card("H-8", "H", 8);
    const room = table(4, {
      currentTrick: [
        {
          combo: {
            cards: [three],
            bindings: [],
            resolvedRank: 3,
            suits: ["S"],
            isPureJokerPlay: false,
          },
          playedBy: "p_2",
        },
      ],
    });
    // The 8-giri went onto the trick and off it inside one action, so by the
    // time the client sees the state it is only in the graveyard (§7.4).
    const next = after(
      room,
      [
        history("history.played", { player: "p_3", cards: "H-8", count: 1 }),
        history("history.eightGiri", { player: "p_3" }),
        history("history.trickCleared", { leader: "p_3" }),
      ],
      { currentTrick: [], graveyard: [three, eight] },
    );

    const derived = deriveTableAnimations(room, next);
    const sweep = derived.find((entry) => entry.kind === "trickSweep");
    expect(sweep).toMatchObject({ delayMs: 0, durationMs: TRICK_SWEEP_MS });
    expect(sweep?.kind === "trickSweep" && sweep.cards.map((each) => each.id)).toEqual([
      "S-3",
      "H-8",
    ]);
    expect(derived.map((entry) => entry.kind)).toEqual(["giri", "trickSweep"]);
  });

  it("does not sweep a trick that was already empty", () => {
    const room = table(4);
    const next = after(room, [history("history.trickCleared", { leader: "p_2" })]);
    expect(deriveTableAnimations(room, next)).toEqual([]);
  });

  it("flips for a revolution and for the counter-revolution that ends it", () => {
    const room = table(4);
    const on = after(room, [history("history.kakumei", { player: "p_2" })]);
    expect(deriveTableAnimations(room, on)).toMatchObject([
      { kind: "revolution", on: true, player: "p_2", delayMs: 0, durationMs: REVOLUTION_MS },
    ]);
    const off = after(room, [history("history.kakumeiEnded", { player: "p_3" })]);
    expect(deriveTableAnimations(room, off)).toMatchObject([{ kind: "revolution", on: false }]);
  });

  it("travels a 7-pass for the two parties and for everyone else alike", () => {
    const room = table(4);
    const party = after(room, [
      history(
        "history.sevenPass",
        { player: "p_1", target: "p_3", cards: "S-3 H-3", count: 2 },
        { privateCardParams: ["cards"], visibleTo: ["p_1", "p_3"] },
      ),
    ]);
    // What an outsider is handed instead (§8.5): different key, same travel.
    const outsider = after(room, [
      history("history.sevenPassRedacted", { player: "p_1", target: "p_3", count: 2 }),
    ]);
    const expected = {
      kind: "sevenPass",
      player: "p_1",
      target: "p_3",
      count: 2,
      durationMs: SEVEN_PASS_MS,
    };
    expect(deriveTableAnimations(room, party)).toMatchObject([expected]);
    expect(deriveTableAnimations(room, outsider)).toMatchObject([expected]);
  });

  it("stamps the cutter that fired, under its own rule key", () => {
    const room = table(4);
    const eight = after(room, [history("history.eightGiri", { player: "p_2" })]);
    expect(deriveTableAnimations(room, eight)).toMatchObject([
      { kind: "giri", rule: "eightGiri", player: "p_2", durationMs: GIRI_MS },
    ]);
    const nine = after(room, [history("history.nineGiri", { player: "p_2" })]);
    expect(deriveTableAnimations(room, nine)).toMatchObject([
      { kind: "giri", rule: "nineGiriMinPair" },
    ]);
  });

  it("arcs over every skipped seat, and stays queued until the last arc lands", () => {
    const room = table(5);
    const next = after(room, [
      history("history.fiveSkip", { player: "p_1", count: 2, skipped: "p_2 p_3" }),
    ]);
    expect(deriveTableAnimations(room, next)).toMatchObject([
      { kind: "skip", skipped: ["p_2", "p_3"], durationMs: SKIP_MS + SKIP_STAGGER_MS },
    ]);
  });

  it("holds the miyako-ochi sweep back until the agari that caused it has played", () => {
    const room = table(4);
    const next = after(room, [
      history("history.agari", { player: "p_2", position: 1 }),
      history("history.miyakoOchi", { player: "p_2", target: "p_4", count: 6 }),
    ]);

    const derived = deriveTableAnimations(room, next);
    expect(derived.map((entry) => entry.kind)).toEqual(["agari", "miyakoOchi"]);
    expect(derived[0]).toMatchObject({ delayMs: 0, durationMs: AGARI_MS });
    expect(derived[1]).toMatchObject({
      kind: "miyakoOchi",
      target: "p_4",
      count: 6,
      delayMs: AGARI_MS,
      durationMs: MIYAKO_OCHI_MS,
    });
    expect(miyakoOchiTarget(derived)).toBe("p_4");
  });

  it("does not delay a miyako-ochi that arrives without an agari of its own", () => {
    const room = table(4);
    const next = after(room, [
      history("history.miyakoOchi", { player: "p_2", target: "p_4", count: 3 }),
    ]);
    expect(deriveTableAnimations(room, next)).toMatchObject([{ kind: "miyakoOchi", delayMs: 0 }]);
  });
});

describe("which way an animation travels", () => {
  it("sends cards towards the edge the seat is actually on", () => {
    const room = { ...table(4), myPlayerId: "p_1" };
    expect(seatEdgeOf(room, "p_1")).toBe("self");
    expect(seatEdgeOf(room, "p_2")).toBe("left");
    expect(seatEdgeOf(room, "p_3")).toBe("top");
    expect(seatEdgeOf(room, "p_4")).toBe("right");
    expect(seatEdgeOf(room, "p_9")).toBeNull();
  });

  it("keeps the sides opposed and the graveyard off the table's own corner", () => {
    expect(SEAT_TRAVEL.left.x).toBe(-SEAT_TRAVEL.right.x);
    expect(SEAT_TRAVEL.top.y).toBeLessThan(0);
    expect(SEAT_TRAVEL.self.y).toBeGreaterThan(0);
    expect(GRAVEYARD_TRAVEL.x).toBeLessThan(SEAT_TRAVEL.left.x);
    // A player the ring does not place travels nowhere rather than off-screen.
    expect(travelTo(null)).toEqual({ x: 0, y: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* The layer over the table                                                   */
/* -------------------------------------------------------------------------- */

/** A seated view of `state`, as this browser's own player. */
function seat(state: PublicGameState, playerId = "p_1"): FakeSocket {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  act(() => socket.connect());
  act(() => socket.fire("joined", { roomId: "ABC234", playerId, resumeToken: "tok" }));
  act(() => socket.fire("roomState", { ...state, myPlayerId: playerId }));
  return socket;
}

function playing(kind: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-animation="${kind}"]`)];
}

describe("the animation layer (§10.9)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the sweep over a table that already shows the cleared trick", () => {
    const three = card("S-3", "S", 3);
    const room = table(4, {
      currentTrick: [
        {
          combo: {
            cards: [three],
            bindings: [],
            resolvedRank: 3,
            suits: ["S"],
            isPureJokerPlay: false,
          },
          playedBy: "p_2",
        },
      ],
    });
    const socket = seat(room);

    act(() =>
      socket.fire("roomState", {
        ...after(room, [history("history.trickCleared", { leader: "p_2" })], {
          currentTrick: [],
          graveyard: [three],
        }),
        myPlayerId: "p_1",
      }),
    );

    // The authoritative state is not waiting on the animation: the trick area
    // already reads as open in the same commit the sweep is queued in.
    expect(screen.getByText("Table is open — lead anything")).toBeInTheDocument();
    expect(playing("trickSweep")).toHaveLength(1);
    // Nothing in the layer can take a tap meant for a card.
    expect(document.querySelector<HTMLElement>(".table-anim")?.style.pointerEvents).toBe("none");

    act(() => vi.advanceTimersByTime(TRICK_SWEEP_MS));
    expect(playing("trickSweep")).toHaveLength(0);
  });

  it("banners the revolution and flips the hand under it", () => {
    const room = table(4);
    const socket = seat(room);

    act(() =>
      socket.fire("roomState", {
        ...after(room, [history("history.kakumei", { player: "p_2" })], { isRevolution: true }),
        myPlayerId: "p_1",
      }),
    );

    expect(playing("revolution")).toHaveLength(1);
    expect(screen.getByText("The order is upside down")).toBeInTheDocument();
    expect(document.querySelector(".game-table__hand--revolution")).not.toBeNull();

    act(() => vi.advanceTimersByTime(REVOLUTION_MS));
    expect(playing("revolution")).toHaveLength(0);
    expect(document.querySelector(".game-table__hand--revolution")).toBeNull();
  });

  it("sweeps a miyako-ochi only after the agari, and says why the hand emptied", () => {
    const room = table(4);
    const socket = seat(room);

    act(() =>
      socket.fire("roomState", {
        ...after(
          room,
          [
            history("history.agari", { player: "p_2", position: 1 }),
            history("history.miyakoOchi", { player: "p_2", target: "p_4", count: 6 }),
          ],
          { finishedPlayerIds: ["p_2"], droppedPlayerIds: ["p_4"] },
        ),
        myPlayerId: "p_1",
      }),
    );

    // The winner's agari plays alone: cards leaving a hand nobody played is only
    // legible once its cause has been shown (§4.5).
    expect(playing("agari")).toHaveLength(1);
    expect(playing("miyakoOchi")).toHaveLength(0);

    act(() => vi.advanceTimersByTime(AGARI_MS));
    expect(playing("agari")).toHaveLength(0);
    const [sweep] = playing("miyakoOchi");
    expect(sweep?.dataset["delayMs"]).toBe(String(AGARI_MS));
    // The sentence is `history.miyakoOchi` itself — there is no `rule.*` key for
    // a rule that is always on (§4.5) — so the log carries the same line.
    expect(sweep?.textContent).toContain(
      "Seat2 won from Grand Pauper — Seat4 falls to last with 6 card(s)",
    );
    // The seat that emptied says so while it drops.
    const demoted = document.querySelector('[data-player-id="p_4"]');
    expect(demoted?.className).toContain("player-seat--demoted");
    expect(demoted?.textContent).toContain("Cast out");

    act(() => vi.advanceTimersByTime(MIYAKO_OCHI_MS));
    expect(playing("miyakoOchi")).toHaveLength(0);
    expect(document.querySelector(".player-seat--demoted")).toBeNull();
  });

  it("leaves nothing on screen once every animation of a burst has run", () => {
    const room = table(5);
    const socket = seat(room);

    act(() =>
      socket.fire("roomState", {
        ...after(room, [
          history("history.eightGiri", { player: "p_2" }),
          history("history.fiveSkip", { player: "p_2", count: 2, skipped: "p_3 p_4" }),
          history("history.sevenPassRedacted", { player: "p_2", target: "p_5", count: 1 }),
        ]),
        myPlayerId: "p_1",
      }),
    );

    expect(playing("giri")).toHaveLength(1);
    expect(playing("skip")).toHaveLength(2);
    expect(playing("sevenPass")).toHaveLength(1);

    act(() => vi.advanceTimersByTime(GIRI_MS + SKIP_MS + SKIP_STAGGER_MS + SEVEN_PASS_MS));
    expect(document.querySelector(".table-anim")).toBeNull();
  });

  it("replays nothing on the first state a resumed seat is handed (§8.1)", () => {
    const busy = table(4, {
      history: [
        history("history.kakumei", { player: "p_2" }),
        history("history.agari", { player: "p_3", position: 1 }),
      ],
      isRevolution: true,
    });
    seat(busy);
    expect(document.querySelector(".table-anim")).toBeNull();
  });
});
