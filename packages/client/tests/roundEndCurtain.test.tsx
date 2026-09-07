/**
 * The round-end curtain (§10.12): the result over the table it was won on.
 *
 * The round is decided inside somebody's last play, so the status flips to
 * `ROUND_END` in the same commit that would otherwise swap the table for the
 * lobby. What is asserted here is who ends up on which screen, and what the
 * curtain does with the room:
 *
 * - it rises on a *transition*, never on the first state a seat is handed, so a
 *   player who was in the round stays on the table with the result over it, and a
 *   newcomer or a resume into a room already between rounds gets the lobby (§8.1);
 * - it stays up until the next deal, carrying the one control the lobby offers
 *   between rounds (§8.6), with the rest of that screen a link away;
 * - the standings it draws are the lobby's own, read out of the same
 *   `PublicGameState`, and leaving it sends nothing.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history, type PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

const THREE = [
  player("p_1", "Will", { seatIndex: 0 }),
  player("p_2", "Alex", { seatIndex: 1 }),
  player("p_3", "Sam", { seatIndex: 2 }),
];

function inProgress(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return publicState({
    status: "IN_PROGRESS",
    players: THREE,
    turnOrder: THREE.map((seat) => seat.id),
    hands: Object.fromEntries(THREE.map((seat) => [seat.id, { cardCount: 3 }])),
    ...overrides,
  });
}

/** The round p_2 won, p_1 came second in, and p_3 was left holding cards. */
function ended(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return publicState({
    status: "ROUND_END",
    players: THREE,
    turnOrder: THREE.map((seat) => seat.id),
    hands: Object.fromEntries(THREE.map((seat) => [seat.id, { cardCount: 0 }])),
    stateVersion: 2,
    finishedPlayerIds: ["p_2", "p_1"],
    points: { p_2: 2, p_1: 1, p_3: 0 },
    history: [history("history.roundEnded", { round: 1 })],
    ...overrides,
  });
}

/** Joined through the menu, so the socket the components send on is the live one. */
async function seat(state: PublicGameState, playerId = "p_1") {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.type(screen.getByLabelText("Your name"), "Will");
  await user.type(screen.getByLabelText("Room code"), "ABC234");
  await user.click(screen.getByRole("button", { name: "Join room" }));
  act(() => socket.fire("joined", { roomId: "ABC234", playerId, resumeToken: "tok" }));
  act(() => socket.fire("roomState", { ...state, myPlayerId: playerId }));
  socket.sent.length = 0;
  return { socket, user };
}

function curtain(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Round result" });
}

/** The places on the curtain, in render order: rank, player, role. */
function placeRows(): string[][] {
  return [...document.querySelectorAll(".round-end__place")].map((row) => [
    within(row as HTMLElement).getByText(/^\d+$/).textContent ?? "",
    (row.querySelector(".round-end__player")?.textContent ?? "").trim(),
    (row.querySelector(".round-end__role")?.textContent ?? "").trim(),
  ]);
}

describe("the round-end curtain (§10.12)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the table with the result over it rather than warping to the lobby", async () => {
    const { socket } = await seat(inProgress());
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));

    expect(curtain()).not.toBeNull();
    // The table the round was decided on is still there, and inert behind it.
    expect(document.querySelector(".game-table")).not.toBeNull();
    expect(document.querySelector(".room-shell__table")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".lobby")).toBeNull();
  });

  it("lands the places in core's finish order, with what the round paid", async () => {
    const { socket } = await seat(inProgress());
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));

    expect(placeRows()).toEqual([
      ["1", "🙂Alex", "Daifugo"],
      ["2", "🙂Will", "Heimin"],
      ["3", "🙂Sam", "Daihinmin"],
    ]);
    // §9: the round pays `N - position`, and the total is what the lobby ranks on.
    expect(screen.getByText("+2")).not.toBeNull();
    expect(screen.getAllByText("0 pts")).toHaveLength(1);
  });

  it("stays up rather than timing out: it is the screen until the next deal", async () => {
    const { socket } = await seat(inProgress());
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));

    act(() => vi.advanceTimersByTime(120_000));
    expect(curtain()).not.toBeNull();
    expect(document.querySelector(".lobby")).toBeNull();
  });

  it("carries the deal for the host, gated exactly as the lobby's is (§8.6)", async () => {
    const { socket, user } = await seat(inProgress());
    // Nobody has readied yet, so the deal is held and says who it is waiting on.
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));
    expect(screen.getByRole("button", { name: "Deal the next round" })).toBeDisabled();
    expect(screen.getByText("Waiting on 2 players to ready up")).toBeInTheDocument();

    act(() =>
      socket.fire("roomState", {
        ...ended({
          stateVersion: 3,
          players: [THREE[0]!, ...THREE.slice(1).map((s) => ({ ...s, isReady: true }))],
        }),
        myPlayerId: "p_1",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Deal the next round" }));
    expect(socket.sentOf("startGame").length).toBe(1);
  });

  it("readies a non-host up from the curtain, one way", async () => {
    const { socket, user } = await seat(inProgress(), "p_2");
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_2" }));

    await user.click(screen.getByRole("button", { name: "Ready up" }));
    expect(socket.sentOf("setReady")).toEqual([[true]]);
    // The curtain is still the screen: readying up is not leaving it.
    expect(curtain()).not.toBeNull();

    act(() =>
      socket.fire("roomState", {
        ...ended({
          stateVersion: 3,
          players: [THREE[0]!, { ...THREE[1]!, isReady: true }, THREE[2]!],
        }),
        myPlayerId: "p_2",
      }),
    );
    expect(screen.getByRole("button", { name: "Waiting for other players" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Ready up" })).not.toBeInTheDocument();
  });

  it("leads to the rest of the lobby on request, and sends nothing doing it", async () => {
    const { socket, user } = await seat(inProgress());
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));

    await user.click(screen.getByRole("button", { name: "View lobby" }));

    expect(curtain()).toBeNull();
    expect(document.querySelector(".lobby")).not.toBeNull();
    expect(socket.sent).toEqual([]);
  });

  it("does not rise for a seat that joins a room already between rounds (§8.1)", async () => {
    // A newcomer, or a resume: no round was watched ending, so this is the lobby —
    // the screen that introduces a room rather than the one that closes a round.
    await seat(ended());
    expect(curtain()).toBeNull();
    expect(document.querySelector(".lobby")).not.toBeNull();
  });

  it("does not come back once a seat has left it for the lobby", async () => {
    const { socket, user } = await seat(inProgress());
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));
    await user.click(screen.getByRole("button", { name: "View lobby" }));

    // Someone readies up: a new state, same `ROUND_END`. The result has been read.
    act(() =>
      socket.fire("roomState", {
        ...ended({ stateVersion: 3, players: THREE.map((s) => ({ ...s, isReady: true })) }),
        myPlayerId: "p_1",
      }),
    );
    expect(curtain()).toBeNull();
    expect(document.querySelector(".lobby")).not.toBeNull();
  });

  it("comes down the moment the next round is dealt, whatever the timer says", async () => {
    const { socket } = await seat(inProgress());
    act(() => socket.fire("roomState", { ...ended(), myPlayerId: "p_1" }));
    expect(curtain()).not.toBeNull();

    act(() =>
      socket.fire("roomState", {
        ...inProgress({ stateVersion: 3, roundNumber: 2 }),
        myPlayerId: "p_1",
      }),
    );
    expect(curtain()).toBeNull();
    expect(document.querySelector(".game-table")).not.toBeNull();
  });

  it("ranks a match end on cumulative points, not the last round's finish order", async () => {
    const { socket } = await seat(inProgress());
    act(() =>
      socket.fire("roomState", {
        ...ended({ status: "MATCH_END", points: { p_1: 7, p_2: 5, p_3: 1 } }),
        myPlayerId: "p_1",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Match over" });
    expect(within(dialog).getByRole("heading").textContent).toBe("Will wins the match");
    expect(placeRows().map((row) => row[1])).toEqual(["🙂Will", "🙂Alex", "🙂Sam"]);
    // Nothing left to deal or ready for (§9), and the standings are a link away.
    expect(within(dialog).getByText("The match is over")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "See the final standings" }),
    ).toBeInTheDocument();
  });
});
