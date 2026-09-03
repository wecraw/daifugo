/**
 * The lobby (#16): the roster, the start control, and the between-round
 * standings of §9.
 *
 * The standings assertions are the point of the issue: the row order is core's
 * final finish order (§4.1) — finished, then whoever still held cards, then the
 * `droppedPlayerIds` bottom block — and the client renders it rather than
 * re-deriving one from points or seats.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

async function seat(state: PublicGameState, playerId = "p_1") {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "Will");
  await user.type(screen.getByLabelText("Room code"), "ABC234");
  await user.click(screen.getByRole("button", { name: "Join room" }));
  act(() => socket.fire("joined", { roomId: "ABC234", playerId, resumeToken: "tok" }));
  act(() => socket.fire("roomState", { ...state, myPlayerId: playerId }));
  return { socket, user };
}

const THREE = [
  player("p_1", "Will", { seatIndex: 0 }),
  player("p_2", "Alex", { seatIndex: 1 }),
  player("p_3", "Sam", { seatIndex: 2 }),
];

/** The rows of the standings table, header excluded, in render order. */
function standingsRows(): string[][] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent ?? ""),
    );
}

describe("Lobby", () => {
  it("shows the join code and the roster with host and connection state", async () => {
    await seat(
      publicState({
        players: [
          ...THREE.slice(0, 2),
          player("p_3", "Sam", { seatIndex: 2, isConnected: false, isReady: true }),
        ],
      }),
    );

    expect(screen.getByRole("heading", { name: "Room ABC234" })).toBeInTheDocument();
    expect(screen.getByText("Will")).toBeInTheDocument();
    // The host badge sits on the room's `hostId`, not on the viewer.
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    // §8.3: a disconnected player keeps their seat through the grace period, so
    // the roster says so rather than dropping the row.
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("lets the host start once the table is big enough", async () => {
    const { socket, user } = await seat(publicState({ players: THREE }));

    const start = screen.getByRole("button", { name: "Start match" });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(socket.sentOf("startGame").length).toBe(1);
  });

  it("disables the start button under three players and says why", async () => {
    await seat(publicState({ players: THREE.slice(0, 2) }));

    expect(screen.getByRole("button", { name: "Start match" })).toBeDisabled();
    expect(screen.getByText("Needs at least 3 players")).toBeInTheDocument();
  });

  it("gives a non-host no start button at all", async () => {
    await seat(publicState({ players: THREE }), "p_2");

    expect(screen.queryByRole("button", { name: "Start match" })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the host to deal…")).toBeInTheDocument();
  });

  it("orders the between-round standings by core's finish order, drops last", async () => {
    await seat(
      publicState({
        status: "ROUND_END",
        roundNumber: 2,
        players: THREE,
        turnOrder: ["p_1", "p_2", "p_3"],
        // Sam won; Will was demoted by miyako-ochi and is dead last despite the
        // hand he held; Alex was the last player still holding cards.
        finishedPlayerIds: ["p_3"],
        droppedPlayerIds: ["p_1"],
        points: { p_1: 1, p_2: 1, p_3: 2 },
        history: [
          {
            key: "history.miyakoOchi",
            params: { player: "p_3", target: "p_1", count: 9 },
          },
        ],
      }),
    );

    expect(standingsRows()).toEqual([
      ["1", "Sam", "Grand Millionaire", "2"],
      ["2", "Alex", "Commoner", "1"],
      ["3", "Will", "Grand Pauper", "1"],
    ]);
  });

  it("surfaces the miyako-ochi line so a zero does not read as a scoring bug", async () => {
    await seat(
      publicState({
        status: "ROUND_END",
        roundNumber: 2,
        players: THREE,
        turnOrder: ["p_1", "p_2", "p_3"],
        finishedPlayerIds: ["p_3", "p_2"],
        droppedPlayerIds: ["p_1"],
        points: { p_1: 0, p_2: 1, p_3: 2 },
        history: [
          { key: "history.roundStarted", params: { round: 2 } },
          { key: "history.miyakoOchi", params: { player: "p_3", target: "p_1", count: 9 } },
        ],
      }),
    );

    // Rendered through the core key, with the ids in its params resolved to the
    // names on the roster (§11: entries carry ids, never bare strings).
    expect(
      screen.getByText("Sam won from Grand Pauper — Will falls to last with 9 card(s)"),
    ).toBeInTheDocument();
    expect(standingsRows()[2]).toEqual(["3", "Will", "Grand Pauper", "0"]);
  });

  it("offers the next round after a round, and nothing after the match ends", async () => {
    const { socket, user } = await seat(
      publicState({ status: "ROUND_END", roundNumber: 1, roundLimit: 3, players: THREE }),
    );

    await user.click(screen.getByRole("button", { name: "Deal the next round" }));
    expect(socket.sentOf("startGame").length).toBe(1);

    act(() =>
      socket.fire("roomState", {
        ...publicState({ status: "MATCH_END", roundNumber: 3, roundLimit: 3, players: THREE }),
      }),
    );
    expect(screen.queryByRole("button", { name: "Deal the next round" })).not.toBeInTheDocument();
    expect(screen.getByText("The match is over")).toBeInTheDocument();
  });
});
