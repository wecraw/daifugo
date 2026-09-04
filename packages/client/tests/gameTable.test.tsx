/**
 * The game table shell (#17): the 844x390 frame of §10.1, the seat ring, the
 * trick area, the history log, and the deadline-driven timers of §10.10.
 *
 * The acceptance criterion is "layout holds at 3 and 8 players without overflow
 * on a 844x390 viewport". jsdom has no layout engine, so it is checked in the two
 * halves that can be: the frame's arithmetic — the three bands adding up to 390,
 * the hand region leaving §10.2 its `W ≈ 780` — and the seat distribution, which
 * places every opponent exactly once and never puts more chips on an edge than it
 * holds.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXCHANGE_DURATION_MS,
  TURN_DURATION_MS,
  history,
  type Card,
  type PlayCombo,
  type PublicGameState,
} from "@daifugo/core";
import { App } from "../src/App";
import {
  ACTION_COLUMN_WIDTH,
  HAND_REGION_WIDTH,
  HAND_ROW_HEIGHT,
  MAX_OPPONENTS,
  MIDDLE_HEIGHT,
  SEAT_CAPACITY,
  TOP_STRIP_HEIGHT,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  distributeSeats,
  opponentIds,
} from "../src/layout/tableLayout";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

/** A seated view of `state`, as this browser's own player. */
async function seat(state: PublicGameState, playerId = "p_1") {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  act(() => socket.connect());
  act(() => socket.fire("joined", { roomId: "ABC234", playerId, resumeToken: "tok" }));
  act(() => socket.fire("roomState", { ...state, myPlayerId: playerId }));
  return socket;
}

function table(count: number, overrides: Partial<PublicGameState> = {}): PublicGameState {
  const players = Array.from({ length: count }, (_, index) =>
    player(`p_${index + 1}`, `Seat${index + 1}`, { seatIndex: index }),
  );
  return publicState({
    status: "IN_PROGRESS",
    players,
    turnOrder: players.map((seat) => seat.id),
    hands: Object.fromEntries(players.map((seat, index) => [seat.id, { cardCount: index + 1 }])),
    ...overrides,
  });
}

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

function combo(cards: Card[], bindings: PlayCombo["bindings"] = []): PlayCombo {
  const first = cards[0];
  return {
    cards,
    bindings,
    resolvedRank: bindings[0]?.rank ?? first?.rank ?? null,
    suits: cards.map((each) => each.suit),
    isPureJokerPlay: false,
  };
}

/** The seat chips on one edge, in render order. */
function seatsOn(edge: "left" | "top" | "right"): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-seat-edge="${edge}"]`)];
}

function seatNames(edge: "left" | "top" | "right"): string[] {
  return seatsOn(edge).map((chip) => chip.querySelector(".player-seat__name")?.textContent ?? "");
}

describe("table frame (§10.1)", () => {
  it("spends the whole 390px viewport on the three bands", () => {
    expect(TOP_STRIP_HEIGHT + MIDDLE_HEIGHT + HAND_ROW_HEIGHT).toBe(VIEWPORT_HEIGHT);
  });

  it("leaves the hand the W ≈ 780 that §10.2's step formula assumes", () => {
    expect(HAND_REGION_WIDTH + ACTION_COLUMN_WIDTH).toBe(VIEWPORT_WIDTH);
    expect(HAND_REGION_WIDTH).toBe(780);
  });

  it("has room for the seven opponents of an eight-player table", () => {
    expect(SEAT_CAPACITY.left + SEAT_CAPACITY.top + SEAT_CAPACITY.right).toBe(MAX_OPPONENTS);
    expect(MAX_OPPONENTS).toBe(7);
  });
});

describe("seat distribution", () => {
  for (let opponents = 2; opponents <= MAX_OPPONENTS; opponents++) {
    it(`places ${opponents} opponents without overfilling an edge`, () => {
      const edges = distributeSeats(opponents);
      expect(edges).toHaveLength(opponents);
      for (const edge of ["left", "top", "right"] as const) {
        expect(edges.filter((each) => each === edge).length).toBeLessThanOrEqual(
          SEAT_CAPACITY[edge],
        );
      }
    });

    it(`keeps ${opponents} opponents in ring order: left, then top, then right`, () => {
      const edges = distributeSeats(opponents);
      const order = { left: 0, top: 1, right: 2 };
      const ranks = edges.map((edge) => order[edge]);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    });
  }

  it("starts the ring at the seat to the viewer's left, the way play travels", () => {
    const room = table(4);
    expect(opponentIds({ ...room, myPlayerId: "p_2" })).toEqual(["p_3", "p_4", "p_1"]);
  });

  it("falls back to seat order before a turn order exists", () => {
    const room = table(3, { turnOrder: [] });
    expect(opponentIds({ ...room, myPlayerId: "p_1" })).toEqual(["p_2", "p_3"]);
  });
});

describe("GameTable", () => {
  it("seats both opponents of a 3-player table on the side edges", async () => {
    await seat(table(3));
    expect(seatNames("left")).toEqual(["Seat2"]);
    expect(seatNames("top")).toEqual([]);
    expect(seatNames("right")).toEqual(["Seat3"]);
  });

  it("seats all seven opponents of an 8-player table, each exactly once", async () => {
    await seat(table(8));
    const all = [...seatNames("left"), ...seatNames("top"), ...seatNames("right")];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect(all).not.toContain("Seat1");
    expect(seatNames("left")).toHaveLength(2);
    expect(seatNames("top")).toHaveLength(3);
    expect(seatNames("right")).toHaveLength(2);
  });

  it("renders the hand and action regions the rest of §10 fills", async () => {
    await seat(table(3));
    expect(screen.getByRole("region", { name: "Your hand" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Actions" })).toBeInTheDocument();
  });

  it("keeps a leave control on the table, not only in the lobby", async () => {
    await seat(table(3));
    expect(screen.getByRole("button", { name: "Leave room" })).toBeInTheDocument();
  });

  it("does not render the table for a lobby status", async () => {
    await seat(table(3, { status: "LOBBY" }));
    expect(screen.queryByRole("region", { name: "Trick" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Room ABC234" })).toBeInTheDocument();
  });
});

describe("PlayerSeat", () => {
  it("shows each opponent's card count", async () => {
    await seat(table(3));
    const chip = seatsOn("left")[0] as HTMLElement;
    // A 96px chip shows the bare number; the sentence is its accessible name.
    const count = within(chip).getByLabelText("2 card(s)");
    expect(count).toHaveTextContent("2");
  });

  it("marks passed, finished and dropped seats apart from a live one", async () => {
    await seat(
      table(8, {
        passedPlayerIds: ["p_2"],
        finishedPlayerIds: ["p_3"],
        droppedPlayerIds: ["p_4"],
      }),
    );
    const chipOf = (id: string) =>
      document.querySelector<HTMLElement>(`[data-player-id="${id}"]`) as HTMLElement;
    expect(within(chipOf("p_2")).getByText("Passed")).toBeInTheDocument();
    expect(within(chipOf("p_3")).getByText("Out #1")).toBeInTheDocument();
    expect(within(chipOf("p_4")).getByText("Dropped")).toBeInTheDocument();
    expect(within(chipOf("p_5")).queryByText("Passed")).not.toBeInTheDocument();
  });

  it("flags a disconnected seat", async () => {
    const room = table(3);
    room.players[1] = player("p_2", "Seat2", { seatIndex: 1, isConnected: false });
    await seat(room);
    const chip = document.querySelector<HTMLElement>('[data-player-id="p_2"]') as HTMLElement;
    expect(within(chip).getByLabelText("Disconnected")).toBeInTheDocument();
    const connected = document.querySelector<HTMLElement>('[data-player-id="p_3"]') as HTMLElement;
    expect(within(connected).queryByLabelText("Disconnected")).not.toBeInTheDocument();
  });

  it("names the role a seat carried into the round", async () => {
    const room = table(3);
    room.players[1] = player("p_2", "Seat2", { seatIndex: 1, role: { kind: "DAI_HINMIN" } });
    await seat(room);
    expect(screen.getByLabelText("Grand Pauper")).toBeInTheDocument();
  });
});

describe("TrickArea", () => {
  it("shows an open table when no one has led", async () => {
    await seat(table(3));
    expect(screen.getByText("Table is open — lead anything")).toBeInTheDocument();
  });

  it("stacks the plays of the current trick and names the last player", async () => {
    await seat(
      table(3, {
        currentTrick: [
          { combo: combo([card("H-5", "H", 5)]), playedBy: "p_2" },
          { combo: combo([card("S-9", "S", 9)]), playedBy: "p_3" },
        ],
        trickLeaderId: "p_3",
      }),
    );
    expect(document.querySelector('[data-card-id="H-5"]')).not.toBeNull();
    expect(document.querySelector('[data-card-id="S-9"]')).not.toBeNull();
    expect(screen.getByText("Seat3 played")).toBeInTheDocument();
  });

  it("shows a bound joker under the card it stands for (§5.4)", async () => {
    const joker = card("JKR-1", null, null);
    await seat(
      table(3, {
        currentTrick: [
          {
            combo: combo([joker], [{ cardId: "JKR-1", rank: 8, suit: "H" }]),
            playedBy: "p_2",
          },
        ],
      }),
    );
    const face = document.querySelector('[data-card-id="JKR-1"]') as HTMLElement;
    expect(face.textContent).toBe("8♥");
    expect(face.className).toContain("card-face--bound");
  });

  it("badges the revolution, the 11-back and the suit lock", async () => {
    await seat(table(3, { isRevolution: true, trickInverted: true, suitLock: ["H", "S"] }));
    expect(screen.getByText("Revolution")).toBeInTheDocument();
    expect(screen.getByText("Jack Reversal")).toBeInTheDocument();
    expect(screen.getByTitle("Locked to ♥♠")).toBeInTheDocument();
  });
});

describe("history log (§11)", () => {
  it("renders redacted entries through their keys, newest first", async () => {
    await seat(
      table(3, {
        history: [
          history("history.roundStarted", { round: 1 }),
          history("history.sevenPassRedacted", { player: "p_2", target: "p_3", count: 2 }),
        ],
      }),
    );
    const lines = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "")
      .filter((text) => text.startsWith("Round") || text.includes("passed"));
    expect(lines[0]).toBe("Seat2 passed 2 card(s) to Seat3");
    expect(lines[1]).toBe("Round 1 started");
  });
});

describe("timers (§10.10)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down against state.deadline rather than a locally started clock", async () => {
    // Half the turn is already gone when this seat first sees the state — a
    // reconnect mid-turn — so a local timer would show a full 60s and this
    // must not.
    await seat(table(3, { deadline: Date.now() + 30_000 }));
    expect(screen.getAllByRole("timer")[0]).toHaveAttribute("aria-label", "30s left");
  });

  it("re-renders the remaining time as the wall clock moves", async () => {
    await seat(table(3, { deadline: Date.now() + TURN_DURATION_MS }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getAllByRole("timer")[0]).toHaveAttribute("aria-label", "50s left");
  });

  it("rings on the active seat and names whose turn it is", async () => {
    await seat(table(3, { activePlayerIndex: 1, deadline: Date.now() + 20_000 }));
    const chip = document.querySelector<HTMLElement>('[data-player-id="p_2"]') as HTMLElement;
    expect(within(chip).getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText("Seat2's turn")).toBeInTheDocument();
    const idle = document.querySelector<HTMLElement>('[data-player-id="p_3"]') as HTMLElement;
    expect(within(idle).queryByRole("timer")).not.toBeInTheDocument();
  });

  it("centres the ring during EXCHANGE instead of running a turn clock", async () => {
    await seat(
      table(3, {
        status: "EXCHANGE",
        deadline: Date.now() + EXCHANGE_DURATION_MS,
        activePlayerIndex: 1,
      }),
    );
    const trick = screen.getByRole("region", { name: "Trick" });
    expect(within(trick).getByRole("timer")).toBeInTheDocument();
    expect(screen.getAllByRole("timer")).toHaveLength(1);
    expect(screen.getByText("Exchanging cards…")).toBeInTheDocument();
  });

  it("renders no ring at all without a deadline", async () => {
    await seat(table(3, { deadline: null, activePlayerIndex: 1 }));
    expect(screen.queryAllByRole("timer")).toHaveLength(0);
  });
});
