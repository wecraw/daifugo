/**
 * The owed 7-pass and 10-discard (#19, §7.2, §7.3).
 *
 * A pending action is the one moment the table waits on a player who is not
 * choosing a play. It is still a choice over their own hand, so it is made in the
 * hand row (§10.4) with the action column carrying the prompt and the submit —
 * which leaves four things to hold: the rest of the table is inert while it is
 * owed, the hand row is not, the selection opens empty and says what the deadline
 * would send instead (§7.6), and it stays honest when the transfer empties the
 * hand, which is a normal agari (§7.3) rather than a bug to hide.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseCombo, type Card, type PendingAction, type PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

const HAND = [card("S-3", "S", 3), card("C-4", "C", 4), card("H-9", "H", 9)];

const SEVEN = card("S-7", "S", 7);

function trick(cards: Card[]) {
  const parsed = parseCombo(cards);
  if (!parsed.ok) throw new Error(parsed.error);
  return [{ combo: parsed.value, playedBy: "p_1" }];
}

function owed(
  pendingAction: PendingAction,
  myHand: Card[] = HAND,
  overrides: Partial<PublicGameState> = {},
): PublicGameState {
  const players = [player("p_1", "Will"), player("p_2", "Alex", { seatIndex: 1 })];
  return publicState({
    status: "IN_PROGRESS",
    players,
    turnOrder: ["p_1", "p_2"],
    activePlayerIndex: 0,
    myPlayerId: "p_1",
    myHand,
    hands: { p_1: { cardCount: myHand.length }, p_2: { cardCount: 5 } },
    currentTrick: trick([SEVEN]),
    trickLeaderId: "p_1",
    deadline: Date.now() + 60_000,
    pendingAction,
    ...overrides,
  });
}

const SEVEN_PASS: PendingAction = {
  type: "RESOLVE_7_PASS",
  count: 1,
  sourcePlayerId: "p_1",
  targetPlayerId: "p_2",
};

const TEN_DISCARD: PendingAction = { type: "RESOLVE_10_DISCARD", count: 2, playerId: "p_1" };

function seat(state: PublicGameState): FakeSocket {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  act(() => socket.connect());
  act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok" }));
  act(() => socket.fire("roomState", state));
  return socket;
}

function handCard(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.hand__card[data-card-id="${id}"]`);
  if (found === null) throw new Error(`no card ${id} in the hand`);
  return found;
}

/** The row selects on `pointerdown`, the same as it does for a play (§10.4). */
function tap(id: string): void {
  fireEvent.pointerDown(handCard(id));
  fireEvent.pointerUp(handCard(id));
}

function selectedIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.hand__card[aria-pressed="true"]')].map(
    (element) => element.dataset["cardId"] ?? "",
  );
}

function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(".action-bar__submit") as HTMLButtonElement;
}

describe("RESOLVE_7_PASS (§7.2)", () => {
  it("names the target and the count", () => {
    seat(owed(SEVEN_PASS));
    expect(screen.getByText("Seven: pass 1 card(s) to Alex")).toBeInTheDocument();
  });

  it("replaces Play and Pass with the submit while it is owed", () => {
    seat(owed(SEVEN_PASS));
    expect(document.querySelector(".action-bar__play")).toBeNull();
    expect(document.querySelector(".action-bar__pass")).toBeNull();
    expect(submitButton()).toBeInTheDocument();
  });

  it("opens with nothing selected and cannot be submitted yet", () => {
    seat(owed(SEVEN_PASS));
    expect(selectedIds()).toEqual([]);
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent("Select 1 more");
  });

  it("names the weakest cards as what the clock would send (§7.6)", () => {
    seat(owed(SEVEN_PASS));
    const note = "If the clock runs out, your weakest 1 card(s) are passed";
    expect(screen.getByText(note)).toBeInTheDocument();
    // It is the clock's fallback, not a description of the selection, so
    // choosing cards does not change it.
    tap("H-9");
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("makes the rest of the table inert, and leaves the hand row alone", () => {
    seat(owed(SEVEN_PASS));
    for (const band of ["top", "middle"]) {
      expect(document.querySelector(`.game-table__${band}`)).toHaveAttribute("inert");
    }
    expect(document.querySelector(".game-table__bottom")).not.toHaveAttribute("inert");
    // The choice is made in the hand, so the hand takes taps and choosing there
    // enables the submit.
    expect(handCard("H-9").closest("[inert]")).toBeNull();
    tap("H-9");
    expect(selectedIds()).toEqual(["H-9"]);
    expect(submitButton()).not.toBeDisabled();
  });

  it("takes any card, whatever the trick top would allow (§7.2)", () => {
    // The trick top is a single 7 this seat just played, so a lone 3 is not a
    // legal *play* — but the pass has no legality to compute, and the row must
    // not dim or refuse a card the action is entitled to take.
    seat(owed(SEVEN_PASS));
    expect(document.querySelector(".hand__card--dimmed")).toBeNull();
    tap("S-3");
    expect(selectedIds()).toEqual(["S-3"]);
  });

  it("swaps the oldest pick out once the count is full", () => {
    seat(owed(SEVEN_PASS));
    tap("S-3");
    tap("H-9");
    expect(selectedIds()).toEqual(["H-9"]);
  });

  it("leaves the table alone once nothing is owed", () => {
    seat(owed(SEVEN_PASS, HAND, { pendingAction: null }));
    expect(document.querySelector(".game-table__top")).not.toHaveAttribute("inert");
  });

  it("submits the chosen cards", () => {
    const socket = seat(owed(SEVEN_PASS));
    tap("H-9");
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit7Pass")).toEqual([[["H-9"]]]);
    expect(socket.sentOf("submit10Discard")).toEqual([]);
  });
});

describe("RESOLVE_10_DISCARD (§7.2)", () => {
  it("names the count and submits a discard", () => {
    const socket = seat(owed(TEN_DISCARD));
    expect(screen.getByText("Ten: discard 2 card(s)")).toBeInTheDocument();
    // The fallback discards to the graveyard; it must not read as a transfer.
    expect(
      screen.getByText("If the clock runs out, your weakest 2 card(s) are discarded"),
    ).toBeInTheDocument();
    expect(selectedIds()).toEqual([]);
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit10Discard")).toEqual([]);

    tap("C-4");
    tap("H-9");
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit10Discard")).toHaveLength(1);
    const sent = socket.sentOf("submit10Discard")[0]?.[0] as string[];
    expect([...sent].sort()).toEqual(["C-4", "H-9"]);
  });
});

describe("agari by pass or discard (§7.3)", () => {
  const lastCard = [card("D-13", "D", 13)];

  it("shows the whole hand going, and says it is the agari", () => {
    seat(owed({ ...SEVEN_PASS, count: 1 }, lastCard));
    expect(screen.getByText("Your last card(s) — this is your agari")).toBeInTheDocument();
    // Nothing to choose: the card is already selected, and the row will not
    // give it up.
    expect(selectedIds()).toEqual(["D-13"]);
    expect(handCard("D-13")).toHaveAttribute("aria-disabled", "true");
    tap("D-13");
    expect(selectedIds()).toEqual(["D-13"]);
    expect(submitButton()).not.toBeDisabled();
  });

  it("still submits every card the action owes", () => {
    const socket = seat(owed({ ...SEVEN_PASS, count: 1 }, lastCard));
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit7Pass")).toEqual([[["D-13"]]]);
  });
});

describe("someone else's pending action", () => {
  it("gives the seats that only wait no submit, and no inert table", () => {
    seat(
      owed({ type: "RESOLVE_10_DISCARD", count: 2, playerId: "p_2" }, HAND, {
        activePlayerIndex: 1,
      }),
    );
    expect(document.querySelector(".action-bar__submit")).toBeNull();
    expect(document.querySelector(".game-table__top")).not.toHaveAttribute("inert");
    // Their Play button carries the reason it is disabled instead (§10.6).
    expect(document.querySelector(".action-bar__play")).toBeDisabled();
  });
});
