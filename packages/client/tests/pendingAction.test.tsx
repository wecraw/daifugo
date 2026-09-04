/**
 * The pending-action modals (#19, §7.2, §7.3).
 *
 * A pending action is the one moment the table waits on a player who is not
 * choosing a play, so the modal has to do three things: block the rest of the
 * table's input while it is owed, default to the selection the deadline would
 * submit (§7.6), and stay honest when the transfer empties the hand — that is a
 * normal agari (§7.3), not a bug to hide.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  parseCombo,
  weakestSelection,
  type Card,
  type PendingAction,
  type PublicGameState,
} from "@daifugo/core";
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

function trayCard(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.card-tray__card[data-card-id="${id}"]`);
  if (found === null) throw new Error(`no card ${id} in the tray`);
  return found;
}

function selectedIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.card-tray__card[aria-pressed="true"]')].map(
    (element) => element.dataset["cardId"] ?? "",
  );
}

function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(".pending-action__submit") as HTMLButtonElement;
}

describe("RESOLVE_7_PASS (§7.2)", () => {
  it("names the target and the count", () => {
    seat(owed(SEVEN_PASS));
    expect(screen.getByText("Seven: pass 1 card(s) to Alex")).toBeInTheDocument();
  });

  it("blocks the rest of the table's input while it is owed", () => {
    seat(owed(SEVEN_PASS));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const play = document.querySelector<HTMLButtonElement>(".action-bar__play");
    expect(play).toBeDisabled();
  });

  it("defaults to what the deadline would submit (§7.6)", () => {
    seat(owed(SEVEN_PASS));
    expect(selectedIds()).toEqual(weakestSelection(HAND, 1));
  });

  it("submits the chosen cards", () => {
    const socket = seat(owed(SEVEN_PASS));
    fireEvent.click(trayCard("H-9"));
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit7Pass")).toEqual([[["H-9"]]]);
    expect(socket.sentOf("submit10Discard")).toEqual([]);
  });
});

describe("RESOLVE_10_DISCARD (§7.2)", () => {
  it("names the count and submits a discard", () => {
    const socket = seat(owed(TEN_DISCARD));
    expect(screen.getByText("Ten: discard 2 card(s)")).toBeInTheDocument();
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit10Discard")).toHaveLength(1);
    const sent = socket.sentOf("submit10Discard")[0]?.[0] as string[];
    expect([...sent].sort()).toEqual([...weakestSelection(HAND, 2)].sort());
  });
});

describe("agari by pass or discard (§7.3)", () => {
  const lastCard = [card("D-13", "D", 13)];

  it("shows the whole hand going, and says it is the agari", () => {
    seat(owed({ ...SEVEN_PASS, count: 1 }, lastCard));
    expect(screen.getByText("Your last card(s) — this is your agari")).toBeInTheDocument();
    expect(trayCard("D-13").tagName).toBe("LI");
  });

  it("still submits every card the action owes", () => {
    const socket = seat(owed({ ...SEVEN_PASS, count: 1 }, lastCard));
    fireEvent.click(submitButton());
    expect(socket.sentOf("submit7Pass")).toEqual([[["D-13"]]]);
  });
});

describe("someone else's pending action", () => {
  it("renders no modal for the seats that only wait", () => {
    seat(
      owed({ type: "RESOLVE_10_DISCARD", count: 2, playerId: "p_2" }, HAND, {
        activePlayerIndex: 1,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
