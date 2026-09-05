/**
 * The hand row and the action column as the player meets them (§10.2-§10.8).
 *
 * The invariants worth pinning are the ones a refactor could quietly break: a tap
 * never plays a card, the Play button names the *resolved* combo and carries its
 * reason when it is disabled, dimming within a turn does not move anything, and
 * auto-pass fires only on an empty legal set.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCombo, type Card, type PlayCombo, type PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import { AUTO_PASS_DELAY_MS, UNPLAYABLE_SCALE } from "../src/layout/handLayout";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank, isJoker: id.startsWith("JKR") };
}

function combo(cards: Card[]): PlayCombo {
  const parsed = parseCombo(cards);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** A two-seat table, mid-round, with the viewer on turn unless told otherwise. */
function table(myHand: Card[], overrides: Partial<PublicGameState> = {}): PublicGameState {
  const players = [player("p_1", "Will"), player("p_2", "Alex", { seatIndex: 1 })];
  return publicState({
    status: "IN_PROGRESS",
    players,
    turnOrder: ["p_1", "p_2"],
    activePlayerIndex: 0,
    myPlayerId: "p_1",
    myHand,
    hands: { p_1: { cardCount: myHand.length }, p_2: { cardCount: 5 } },
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

function cardButton(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.hand__card[data-card-id="${id}"]`);
  if (found === null) throw new Error(`no card ${id} in the hand`);
  return found;
}

function slotOf(id: string): HTMLElement {
  const slot = cardButton(id).parentElement;
  if (slot === null) throw new Error(`card ${id} has no slot`);
  return slot;
}

function playButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(".action-bar__play") as HTMLButtonElement;
}

function passButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(".action-bar__pass") as HTMLButtonElement;
}

/** A tap: `pointerdown` is the select, and the pointer comes back up on the card. */
function tap(id: string): void {
  const button = cardButton(id);
  fireEvent.pointerDown(button);
  fireEvent.pointerUp(button);
}

const PAIR_HAND = [
  card("S-5", "S", 5),
  card("H-5", "H", 5),
  card("C-9", "C", 9),
  card("D-13", "D", 13),
];

describe("selection (§10.4)", () => {
  it("selects on tap and never plays on it", () => {
    const socket = seat(table(PAIR_HAND));
    tap("S-5");
    expect(cardButton("S-5")).toHaveAttribute("aria-pressed", "true");
    expect(socket.sentOf("playCards")).toEqual([]);
  });

  it("deselects on a second tap", () => {
    seat(table(PAIR_HAND));
    tap("C-9");
    tap("C-9");
    expect(cardButton("C-9")).toHaveAttribute("aria-pressed", "false");
  });

  it("releases the touch's implicit pointer capture, so a drag reaches the rest", () => {
    seat(table(PAIR_HAND));
    const button = cardButton("S-5");
    const released: unknown[] = [];
    // jsdom implements neither, and a real touch captures to the first element
    // unless the capture is given back.
    Object.assign(button, {
      hasPointerCapture: () => true,
      releasePointerCapture: (id: unknown) => released.push(id),
    });
    fireEvent.pointerDown(button, { pointerId: 7, pointerType: "touch" });
    // jsdom has no PointerEvent, so the id does not survive the synthesized
    // event; that the capture was handed back for it is the part under test.
    expect(released).toHaveLength(1);
  });

  it("selects across a drag without deselecting what it crosses", () => {
    seat(table(PAIR_HAND));
    fireEvent.pointerDown(cardButton("S-5"));
    fireEvent.pointerEnter(cardButton("H-5"));
    fireEvent.pointerUp(cardButton("H-5"));
    expect(cardButton("S-5")).toHaveAttribute("aria-pressed", "true");
    expect(cardButton("H-5")).toHaveAttribute("aria-pressed", "true");

    // The drag is over: entering a third card must not select it.
    fireEvent.pointerEnter(cardButton("C-9"));
    expect(cardButton("C-9")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the weighted layout (§10.3)", () => {
  it("shrinks and straightens what cannot be played, and dims the rest", () => {
    // A jack on the table: only the king beats it, so everything below it is out
    // of the legal set and renders as §10.3 says an unplayable card does.
    seat(
      table(PAIR_HAND, {
        currentTrick: [{ combo: combo([card("S-11", "S", 11)]), playedBy: "p_2" }],
      }),
    );
    const transform = cardButton("S-5").style.getPropertyValue("--card-transform");
    expect(transform).toContain(`scale(${UNPLAYABLE_SCALE})`);
    expect(transform).toContain("rotate(0deg)");
    expect(cardButton("D-13").className).not.toContain("hand__card--unplayable");
  });

  it("dims without resizing once the selection narrows (§10.3)", () => {
    seat(table(PAIR_HAND));
    const before = PAIR_HAND.map((each) => slotOf(each.id).style.width);
    tap("S-5");
    expect(cardButton("C-9").className).toContain("hand__card--dimmed");
    expect(PAIR_HAND.map((each) => slotOf(each.id).style.width)).toEqual(before);
  });
});

describe("the action bar (§10.6)", () => {
  it("names the resolved combo on the Play button", () => {
    seat(table(PAIR_HAND));
    tap("S-5");
    expect(playButton()).toHaveTextContent("Play 5");
    tap("H-5");
    expect(playButton()).toHaveTextContent("Play Pair of 5s");
  });

  it("plays the selection, and only on the button", () => {
    const socket = seat(table(PAIR_HAND));
    tap("S-5");
    tap("H-5");
    fireEvent.click(playButton());
    // No joker in the selection, so no bindings argument at all: a trailing
    // undefined would reach the server as JSON null.
    expect(socket.sentOf("playCards")).toEqual([[["S-5", "H-5"]]]);
  });

  it("disables Play with the reason inline rather than sending it", () => {
    const socket = seat(
      table(PAIR_HAND, {
        currentTrick: [{ combo: combo([card("S-11", "S", 11)]), playedBy: "p_2" }],
      }),
    );
    tap("C-9");
    expect(playButton()).toBeDisabled();
    expect(playButton()).toHaveTextContent("Not high enough");
    fireEvent.click(playButton());
    expect(socket.sentOf("playCards")).toEqual([]);
  });

  it("names the locked suits on the disabled Play button (§6)", () => {
    // §10.6 wants the reason to be specific — "Must follow Hearts", not a
    // generic sentence — and the lock is the one blocker that has something
    // concrete to name. Strong enough and the right count, wrong suit.
    seat(
      table([card("H-9", "H", 9), card("S-9", "S", 9)], {
        currentTrick: [{ combo: combo([card("S-5", "S", 5)]), playedBy: "p_2" }],
        suitLock: ["S"],
      }),
    );
    tap("H-9");
    expect(playButton()).toBeDisabled();
    expect(playButton()).toHaveTextContent("Must follow ♠");

    // The card that does follow the lock is playable, so the reason is gone.
    tap("H-9");
    tap("S-9");
    expect(playButton()).toBeEnabled();
    expect(playButton()).toHaveTextContent("Play 9");
  });

  it("names the count the trick top demands (§7.1)", () => {
    seat(
      table(PAIR_HAND, {
        currentTrick: [
          { combo: combo([card("S-3", "S", 3), card("H-3", "H", 3)]), playedBy: "p_2" },
        ],
      }),
    );
    tap("D-13");
    expect(playButton()).toBeDisabled();
    expect(playButton()).toHaveTextContent("Must play 2 card(s)");

    tap("D-13");
    tap("S-5");
    tap("H-5");
    expect(playButton()).toBeEnabled();
  });

  it("says whose turn it is rather than letting a play be refused", () => {
    seat(table(PAIR_HAND, { activePlayerIndex: 1 }));
    expect(playButton()).toBeDisabled();
    expect(playButton()).toHaveTextContent("Not your turn");
  });

  it("disables Pass for the leader with the reason on it (§7.5)", () => {
    const socket = seat(table(PAIR_HAND));
    expect(passButton()).toBeDisabled();
    expect(passButton()).toHaveAttribute("title", "You lead — you must play");
    fireEvent.click(passButton());
    expect(socket.sentOf("pass")).toEqual([]);
  });

  it("passes when there is a trick to pass on", () => {
    const socket = seat(
      table(PAIR_HAND, {
        currentTrick: [{ combo: combo([card("S-11", "S", 11)]), playedBy: "p_2" }],
      }),
    );
    fireEvent.click(passButton());
    expect(socket.sentOf("pass")).toEqual([[]]);
  });
});

describe("the joker badge (§10.5)", () => {
  const jokerHand = [card("S-8", "S", 8), card("JKR-1", null, null)];

  it("cycles the binding and sends the one the badge shows", () => {
    const socket = seat(table(jokerHand));
    tap("JKR-1");
    const badge = document.querySelector<HTMLButtonElement>(".hand__binding");
    if (badge === null) throw new Error("no binding badge");

    // Leading a lone joker: pure is the default and the strongest (§5.5).
    expect(badge).toHaveTextContent("★");
    expect(playButton()).toHaveTextContent("Play Joker");

    fireEvent.click(badge);
    expect(playButton()).not.toHaveTextContent("Play Joker");

    fireEvent.click(playButton());
    const sent = socket.sentOf("playCards")[0];
    expect(sent?.[0]).toEqual(["JKR-1"]);
    expect(sent?.[1]).toHaveLength(1);
  });

  it("shows no badge where there is no choice to make", () => {
    seat(table(jokerHand));
    tap("S-8");
    expect(document.querySelector(".hand__binding")).toBeNull();
  });
});

describe("auto-pass (§10.7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const trick = [{ combo: combo([card("S-2", "S", 2)]), playedBy: "p_2" }];

  it("fires only on an empty legal set, after its 1.2s card", () => {
    const socket = seat(table([card("C-3", "C", 3)], { currentTrick: trick }));
    expect(screen.getByText("No legal play, passing")).toBeInTheDocument();
    expect(socket.sentOf("pass")).toEqual([]);
    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS));
    expect(socket.sentOf("pass")).toEqual([[]]);
  });

  it("does not fire merely because the hand is bad", () => {
    // A 3 and a 5 against a 4: nearly nothing to play, but not nothing.
    const socket = seat(
      table([card("C-3", "C", 3), card("H-5", "H", 5)], {
        currentTrick: [{ combo: combo([card("S-4", "S", 4)]), playedBy: "p_2" }],
      }),
    );
    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS * 2));
    expect(socket.sentOf("pass")).toEqual([]);
    expect(screen.queryByText("No legal play, passing")).toBeNull();
  });

  it("is suppressed while a pending action of the player's is up", () => {
    const socket = seat(
      table([card("C-3", "C", 3)], {
        currentTrick: trick,
        pendingAction: { type: "RESOLVE_10_DISCARD", count: 1, playerId: "p_1" },
      }),
    );
    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS * 2));
    expect(socket.sentOf("pass")).toEqual([]);
  });

  it("retries after a disconnect cancels the delay and fresh state arrives", () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Will" } });
    fireEvent.change(screen.getByLabelText("Room code"), { target: { value: "ABC234" } });
    fireEvent.click(screen.getByRole("button", { name: "Join room" }));
    const state = table([card("C-3", "C", 3)], { currentTrick: trick });
    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok" }));
    act(() => socket.fire("roomState", state));

    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS / 2));
    act(() => socket.disconnect());
    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS));
    expect(socket.sentOf("pass")).toEqual([]);

    act(() => socket.connect());
    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok" }));
    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS));
    expect(socket.sentOf("pass")).toEqual([]);

    act(() => socket.fire("roomState", state));
    act(() => void vi.advanceTimersByTime(AUTO_PASS_DELAY_MS));
    expect(socket.sentOf("pass")).toEqual([[]]);
  });
});

describe("sorting (§10.8)", () => {
  function handOrder(): string[] {
    return [...document.querySelectorAll<HTMLElement>(".hand__card")].map(
      (each) => each.dataset.cardId ?? "",
    );
  }

  it("toggles between the two orders and persists the choice", () => {
    seat(table([card("S-5", "S", 5), card("H-3", "H", 3), card("H-13", "H", 13)]));
    expect(handOrder()).toEqual(["H-3", "S-5", "H-13"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort hand" }));
    expect(handOrder()).toEqual(["S-5", "H-3", "H-13"]);
    expect(localStorage.getItem("daifugo.handSort")).toBe("suit");
  });

  it("reverses the hand on revolution, because the order itself reversed", () => {
    seat(
      table([card("S-5", "S", 5), card("H-3", "H", 3), card("H-13", "H", 13)], {
        isRevolution: true,
      }),
    );
    expect(handOrder()).toEqual(["H-13", "S-5", "H-3"]);
  });
});
