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

/** A table the deal would accept: everyone but the host has readied (§8.6). */
const THREE = [
  player("p_1", "Will", { seatIndex: 0 }),
  player("p_2", "Alex", { seatIndex: 1, isReady: true }),
  player("p_3", "Sam", { seatIndex: 2, isReady: true }),
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
    // the roster says so rather than dropping the row, and their own badges stay
    // on their own row.
    const samRow = screen.getByText("Sam").closest("li")!;
    expect(within(samRow).getByText("Disconnected")).toBeInTheDocument();
    expect(within(samRow).getByText("Ready")).toBeInTheDocument();
  });

  it("shows the roster the deal would take, not just the seated one (§7.7, §8.6)", async () => {
    // A join between rounds queues rather than seats (§7.7), and core counts it
    // for readiness (§8.6) — so a roster that listed `players` alone would hold
    // the deal for someone the table cannot see.
    await seat(
      publicState({
        status: "ROUND_END",
        players: THREE,
        turnOrder: THREE.map((seat) => seat.id),
        pendingJoins: [player("p_9", "Newcomer", { seatIndex: 3 })],
        pendingLeaves: ["p_3"],
      }),
    );

    const roster = screen.getByRole("list");
    const newcomer = within(roster).getByText("Newcomer").closest("li")!;
    expect(within(newcomer).getByText("Joining next round")).toBeInTheDocument();

    const leaving = within(roster).getByText("Sam").closest("li")!;
    expect(within(leaving).getByText("Leaving after this round")).toBeInTheDocument();
  });

  it("does not promise a round the match cannot deal once it has ended (§7.7)", async () => {
    // A join accepted in the final round's last moments can still be sitting in
    // `pendingJoins` when `MATCH_END` lands — the deal that would consume it never
    // comes, so the roster must not tell them otherwise.
    await seat(
      publicState({
        status: "MATCH_END",
        players: THREE,
        turnOrder: THREE.map((seat) => seat.id),
        pendingJoins: [player("p_9", "Newcomer", { seatIndex: 3 })],
        pendingLeaves: ["p_3"],
      }),
    );

    const roster = screen.getByRole("list");
    const newcomer = within(roster).getByText("Newcomer").closest("li")!;
    expect(within(newcomer).queryByText("Joining next round")).not.toBeInTheDocument();

    const leaving = within(roster).getByText("Sam").closest("li")!;
    expect(within(leaving).queryByText("Leaving after this round")).not.toBeInTheDocument();
  });

  it("holds the deal for a queued join, and says who it is waiting on", async () => {
    await seat(
      publicState({
        status: "ROUND_END",
        players: THREE,
        turnOrder: THREE.map((seat) => seat.id),
        pendingJoins: [player("p_9", "Newcomer", { seatIndex: 3 })],
      }),
    );

    expect(screen.getByRole("button", { name: "Deal the next round" })).toBeDisabled();
    expect(screen.getByText("Waiting on 1 player(s)")).toBeInTheDocument();
    // The point of the row: the one seat holding the deal is on screen.
    expect(within(screen.getByRole("list")).getByText("Newcomer")).toBeInTheDocument();
  });

  it("lets the host start once the table is big enough", async () => {
    const { socket, user } = await seat(publicState({ players: THREE }));

    const start = screen.getByRole("button", { name: "Start match" });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(socket.sentOf("startGame").length).toBe(1);
  });

  it("holds the start button until the table has readied (§8.6)", async () => {
    // The host is exempt — their click is their own readiness — so the one
    // unready seat is what the button is waiting on.
    const unready = [THREE[0]!, THREE[1]!, player("p_3", "Sam", { seatIndex: 2 })];
    const { socket, user } = await seat(publicState({ players: unready }));

    expect(screen.getByRole("button", { name: "Start match" })).toBeDisabled();
    expect(screen.getByText("Waiting on 1 player(s)")).toBeInTheDocument();
    // The host gets no ready toggle of their own.
    expect(screen.queryByRole("button", { name: "Ready up" })).not.toBeInTheDocument();
    expect(socket.sentOf("setReady")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Start match" }));
    expect(socket.sentOf("startGame")).toEqual([]);
  });

  it("lets a non-host ready up and take it back", async () => {
    const { socket, user } = await seat(publicState({ players: THREE }), "p_2");

    // p_2 arrives already ready in this fixture, so the toggle offers the undo.
    await user.click(screen.getByRole("button", { name: "Not ready" }));
    expect(socket.sentOf("setReady")).toEqual([[false]]);

    act(() =>
      socket.fire("roomState", {
        ...publicState({
          players: [THREE[0]!, player("p_2", "Alex", { seatIndex: 1 }), THREE[2]!],
        }),
        myPlayerId: "p_2",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Ready up" }));
    expect(socket.sentOf("setReady")).toEqual([[false], [true]]);
  });

  it("reads a mid-round joiner's readiness off pendingJoins (§7.7, §8.6)", async () => {
    // p_4 joined during the round, so they wait in `pendingJoins` and see this
    // lobby at ROUND_END. Their ready flag lives there too — the toggle has to
    // read it from there or it offers "ready up" to someone already ready, and
    // they can never take it back.
    const { socket, user } = await seat(
      publicState({
        status: "ROUND_END",
        players: THREE,
        pendingJoins: [player("p_4", "Kim", { seatIndex: 3, isReady: true })],
      }),
      "p_4",
    );

    await user.click(screen.getByRole("button", { name: "Not ready" }));
    expect(socket.sentOf("setReady")).toEqual([[false]]);
  });

  it("shows the miyako-ochi line only for the round it happened in (§4.5)", async () => {
    // The demotion was round 2; these are round 3's standings. `history` spans the
    // match, so an unbounded scan would keep explaining a zero that is now gone.
    await seat(
      publicState({
        status: "ROUND_END",
        roundNumber: 3,
        players: THREE,
        turnOrder: ["p_1", "p_2", "p_3"],
        finishedPlayerIds: ["p_3", "p_2", "p_1"],
        points: { p_1: 1, p_2: 2, p_3: 3 },
        history: [
          { key: "history.roundStarted", params: { round: 2 } },
          { key: "history.miyakoOchi", params: { player: "p_3", target: "p_1", count: 9 } },
          { key: "history.roundStarted", params: { round: 3 } },
        ],
      }),
    );

    expect(screen.queryByText(/falls to last/)).not.toBeInTheDocument();
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
