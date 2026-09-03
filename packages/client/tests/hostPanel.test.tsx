/**
 * The host panel (§10.11): nine rule toggles behind a disclosure, collapsed by
 * default and all on, plus the round limit of §9.
 *
 * The panel renders for everyone — a rule change has to be visible to the whole
 * table — but only the host can operate it. A non-host's controls are disabled
 * rather than merely rejected, so a `NOT_HOST` (§8.0) never arrives as a
 * surprise for something the client should not have sent.
 *
 * Miyako-ochi (§4.5) is always on and is not a `HouseRulesConfig` entry, so it
 * must not appear here at all.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOUSE_RULE_KEYS, type PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

const THREE = [
  player("p_1", "Will", { seatIndex: 0 }),
  player("p_2", "Alex", { seatIndex: 1 }),
  player("p_3", "Sam", { seatIndex: 2 }),
];

async function seat(overrides: Partial<PublicGameState> = {}, playerId = "p_1") {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "Will");
  await user.type(screen.getByLabelText("Room code"), "ABC234");
  await user.click(screen.getByRole("button", { name: "Join room" }));
  act(() => socket.fire("joined", { roomId: "ABC234", playerId, resumeToken: "tok" }));
  act(() =>
    socket.fire("roomState", {
      ...publicState({ players: THREE, ...overrides }),
      myPlayerId: playerId,
    }),
  );
  return { socket, user };
}

async function openPanel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "House rules" }));
}

describe("HostPanel", () => {
  it("is collapsed by default and opens onto the nine rules, all on", async () => {
    const { user } = await seat();

    expect(screen.queryByRole("checkbox", { name: "Eight Cutter" })).not.toBeInTheDocument();
    await openPanel(user);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(HOUSE_RULE_KEYS.length);
    for (const box of boxes) expect(box).toBeChecked();
  });

  it("has no toggle for miyako-ochi, which is always on (§4.5)", async () => {
    const { user } = await seat();
    await openPanel(user);

    const panel = screen.getByRole("group", { name: "Table rules" });
    expect(within(panel).queryByText(/都落ち|Miyako|miyako/i)).not.toBeInTheDocument();
  });

  it("round-trips a rule change through updateRules as a single-key patch", async () => {
    const { socket, user } = await seat();
    await openPanel(user);

    await user.click(screen.getByRole("checkbox", { name: "Eight Cutter" }));
    expect(socket.sentOf("updateRules")).toEqual([[{ eightGiri: false }]]);

    // The server is authoritative: the box follows the state that comes back,
    // not the click.
    act(() =>
      socket.fire("roomState", {
        ...publicState({ players: THREE, config: { ...publicState().config, eightGiri: false } }),
        myPlayerId: "p_1",
      }),
    );
    expect(screen.getByRole("checkbox", { name: "Eight Cutter" })).not.toBeChecked();
  });

  it("renders read-only for a non-host and sends nothing", async () => {
    const { socket, user } = await seat({}, "p_2");
    await openPanel(user);

    expect(screen.getByText("Only the host can change these")).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: "Eight Cutter" });
    expect(box).toBeDisabled();
    await user.click(box);
    expect(socket.sentOf("updateRules")).toEqual([]);
    expect(screen.getByLabelText("Round limit")).toBeDisabled();
  });

  it("sets and clears the round limit", async () => {
    const { socket, user } = await seat();
    await openPanel(user);

    await user.type(screen.getByLabelText("Round limit"), "5");
    await user.click(screen.getByRole("button", { name: "Set limit" }));
    expect(socket.sentOf("setRoundLimit")).toEqual([[5]]);

    act(() =>
      socket.fire("roomState", {
        ...publicState({ players: THREE, roundLimit: 5 }),
        myPlayerId: "p_1",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Play endlessly" }));
    expect(socket.sentOf("setRoundLimit")).toEqual([[5], [null]]);
  });

  it("refuses a limit the engine would reject rather than emitting it", async () => {
    const { socket, user } = await seat({ status: "ROUND_END", roundNumber: 4 });
    await openPanel(user);

    await user.type(screen.getByLabelText("Round limit"), "4");
    await user.click(screen.getByRole("button", { name: "Set limit" }));

    // §9: a limit only ends a round still to come, so 4 during round 4 is
    // `INVALID_ROUND_LIMIT`. The client says so inline instead of sending it.
    expect(socket.sentOf("setRoundLimit")).toEqual([]);
    expect(
      screen.getByText("The limit must be a round still to come (over 4)"),
    ).toBeInTheDocument();
  });

  it("is inert once the match has ended", async () => {
    const { user } = await seat({ status: "MATCH_END", roundNumber: 3, roundLimit: 3 });
    await openPanel(user);

    expect(screen.getByRole("checkbox", { name: "Eight Cutter" })).toBeDisabled();
  });
});
