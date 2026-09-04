/**
 * The exchange phase as each side of a pair meets it (#19, §4.3, §4.4).
 *
 * The three things worth pinning are the ones the spec is explicit about and a
 * refactor could quietly invert: the poor side has nothing to submit and sees a
 * read-only display (§4.3), the rich side's default selection is exactly what
 * the deadline would send for them (§4.4, §7.6), and round 1 never reaches the
 * screen at all (§4.3).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { forcedSelection, weakestSelection, type Card, type PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

const HAND = [
  card("S-3", "S", 3),
  card("C-4", "C", 4),
  card("H-9", "H", 9),
  card("D-13", "D", 13),
  card("S-2", "S", 2),
];

/**
 * A four-seat table in `EXCHANGE`, with the viewer paired against Alex for
 * `count` cards each way (§4.2). `forced` is the viewer's own forced selection,
 * empty for the rich side.
 */
function exchanging(overrides: Partial<PublicGameState> = {}, count = 2): PublicGameState {
  const players = [
    player("p_1", "Will"),
    player("p_2", "Alex", { seatIndex: 1 }),
    player("p_3", "Sam", { seatIndex: 2 }),
    player("p_4", "Kit", { seatIndex: 3 }),
  ];
  return publicState({
    status: "EXCHANGE",
    roundNumber: 2,
    players,
    turnOrder: players.map((seat) => seat.id),
    myPlayerId: "p_1",
    myHand: HAND,
    deadline: Date.now() + 60_000,
    exchange: {
      required: { p_1: count, p_2: count },
      partner: { p_1: "p_2", p_2: "p_1" },
      forced: { p_2: { cardCount: count } },
      submitted: {},
    },
    ...overrides,
  });
}

function seat(state: PublicGameState): FakeSocket {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  act(() => socket.connect());
  act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok" }));
  act(() => socket.fire("roomState", state));
  return socket;
}

function trayCard(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.card-tray__card[data-card-id="${id}"]`);
  if (found === null) throw new Error(`no card ${id} in the tray`);
  return found;
}

function trayIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".card-tray__card")].map(
    (element) => element.dataset["cardId"] ?? "",
  );
}

function selectedIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.card-tray__card[aria-pressed="true"]')].map(
    (element) => element.dataset["cardId"] ?? "",
  );
}

function sendButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(".exchange__send") as HTMLButtonElement;
}

describe("the rich side (§4.3)", () => {
  it("says who it owes and how many", () => {
    seat(exchanging());
    expect(screen.getByText("Give 2 card(s) to Alex")).toBeInTheDocument();
  });

  it("offers the whole hand to choose from", () => {
    seat(exchanging());
    expect(trayIds().sort()).toEqual(HAND.map((each) => each.id).sort());
  });

  it("pre-selects exactly what the deadline would send (§4.4)", () => {
    seat(exchanging());
    expect(selectedIds().sort()).toEqual([...weakestSelection(HAND, 2)].sort());
  });

  it("sends the selection on submit", () => {
    const socket = seat(exchanging());
    fireEvent.click(sendButton());
    expect(socket.sentOf("exchangeCards")).toHaveLength(1);
    const sent = socket.sentOf("exchangeCards")[0]?.[0] as string[];
    expect([...sent].sort()).toEqual([...weakestSelection(HAND, 2)].sort());
  });

  it("swaps the oldest pick when the count is already full", () => {
    seat(exchanging());
    const before = selectedIds();
    fireEvent.click(trayCard("S-2"));
    const after = selectedIds();
    expect(after).toHaveLength(2);
    expect(after).toContain("S-2");
    expect(after).not.toContain(before[0]);
  });

  it("stops promising the selection once it stops being the default (§4.4)", () => {
    seat(exchanging());
    expect(screen.getByText("If the clock runs out, this selection is sent")).toBeInTheDocument();
    // Nothing reaches the server until Send: from here the deadline takes the
    // weakest cards, whatever is on screen.
    fireEvent.click(trayCard("D-13"));
    expect(
      screen.getByText("If the clock runs out, your weakest 2 card(s) go instead"),
    ).toBeInTheDocument();
  });

  it("will not submit a short selection", () => {
    seat(exchanging());
    fireEvent.click(trayCard(selectedIds()[0] as string));
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("Select 1 more")).toBeInTheDocument();
  });

  it("waits after submitting, rather than offering to submit twice", () => {
    seat(
      exchanging({
        mySubmittedCards: ["S-3", "C-4"],
        exchange: {
          required: { p_1: 2, p_2: 2 },
          partner: { p_1: "p_2", p_2: "p_1" },
          forced: { p_2: { cardCount: 2 } },
          submitted: { p_1: { cardCount: 2 } },
        },
      }),
    );
    expect(sendButton()).toBeNull();
    expect(screen.getByText("Waiting for the other players")).toBeInTheDocument();
    expect(trayIds()).toEqual(["S-3", "C-4"]);
  });
});

describe("the poor side (§4.3)", () => {
  const forced = forcedSelection(HAND, 2);

  function poorState(): PublicGameState {
    return exchanging({
      myForcedCards: forced,
      exchange: {
        required: { p_1: 2, p_2: 2 },
        partner: { p_1: "p_2", p_2: "p_1" },
        forced: { p_1: { cardCount: 2 } },
        submitted: {},
      },
    });
  }

  it("shows the cards leaving the hand and nothing to submit", () => {
    seat(poorState());
    expect(screen.getByText("Your 2 strongest card(s) go to Alex")).toBeInTheDocument();
    expect(trayIds()).toEqual(forced);
    expect(sendButton()).toBeNull();
  });

  it("renders those cards read-only", () => {
    seat(poorState());
    for (const id of forced) {
      expect(trayCard(id).tagName).toBe("LI");
    }
  });

  it("never sends an exchange for the side that has nothing to choose", () => {
    const socket = seat(poorState());
    fireEvent.click(trayCard(forced[0] as string));
    expect(socket.sentOf("exchangeCards")).toEqual([]);
  });
});

describe("the seat that sits the exchange out (§4.2)", () => {
  it("says so rather than showing an empty tray", () => {
    seat(
      exchanging({
        exchange: {
          required: { p_2: 1, p_3: 1 },
          partner: { p_2: "p_3", p_3: "p_2" },
          forced: { p_3: { cardCount: 1 } },
          submitted: {},
        },
      }),
    );
    expect(screen.getByText("You sit this exchange out")).toBeInTheDocument();
    expect(sendButton()).toBeNull();
  });
});

describe("the phase itself (§4.3, §4.4, §10.10)", () => {
  it("counts down against the state's deadline, centred", () => {
    seat(exchanging());
    expect(document.querySelector(".turn-timer--banner")).not.toBeNull();
  });

  it("replaces the hand row while it is up", () => {
    seat(exchanging());
    expect(screen.queryByRole("region", { name: "Your hand" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Card exchange" })).toBeInTheDocument();
  });

  it("is skipped entirely in round 1", () => {
    seat(exchanging({ status: "IN_PROGRESS", roundNumber: 1, exchange: null }));
    expect(screen.queryByRole("region", { name: "Card exchange" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your hand" })).toBeInTheDocument();
  });
});
