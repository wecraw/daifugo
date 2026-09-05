/**
 * The seat protocol (§8.1): the token arrives on `joined`, is stored, and is
 * replayed on every subsequent join — after a transport drop and after a reload
 * alike. Socket id is never identity.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublicGameState } from "@daifugo/core";
import { App } from "../src/App";
import {
  SESSION_STORAGE_KEY,
  SocketProvider,
  readStoredSession,
  useSocket,
} from "../src/context/SocketContext";
import { FakeSocket } from "./fakeSocket";

function SendProbe() {
  const { joinRoom, send } = useSocket();
  return (
    <>
      <button type="button" onClick={() => joinRoom("ABC234", "Will")}>
        Join
      </button>
      <button type="button" onClick={() => send("pass")}>
        Pass
      </button>
    </>
  );
}

function publicState(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return {
    roomId: "ABC234",
    hostId: "p_1",
    config: {
      spade3BeatsJoker: true,
      fiveSkip: true,
      sevenPass: true,
      eightGiri: true,
      nineGiriMinPair: true,
      tenDiscard: true,
      elevenBack: true,
      kakumei: true,
      shibari: true,
    },
    status: "LOBBY",
    roundNumber: 1,
    roundLimit: null,
    stateVersion: 1,
    players: [
      {
        id: "p_1",
        name: "Will",
        role: null,
        seatIndex: 0,
        isReady: false,
        isConnected: true,
      },
    ],
    hands: { p_1: { cardCount: 0 } },
    myHand: [],
    myPlayerId: "p_1",
    graveyard: [],
    dealerId: "p_1",
    turnOrder: ["p_1"],
    activePlayerIndex: 0,
    currentTrick: [],
    trickLeaderId: null,
    passedPlayerIds: [],
    finishedPlayerIds: [],
    droppedPlayerIds: [],
    isRevolution: false,
    trickInverted: false,
    suitLock: null,
    pendingAction: null,
    exchange: null,
    deadline: null,
    pendingJoins: [],
    pendingLeaves: [],
    points: {},
    history: [],
    ...overrides,
  };
}

async function joinAs(socket: FakeSocket, name: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), name);
  await user.type(screen.getByLabelText("Room code"), "ABC234");
  await user.click(screen.getByRole("button", { name: "Join room" }));
  await waitFor(() => expect(socket.sentOf("joinRoom").length).toBeGreaterThan(0));
}

describe("SocketContext", () => {
  it("drops room actions issued while the socket is reconnecting", async () => {
    const socket = new FakeSocket();
    render(
      <SocketProvider connect={() => socket.asSocket()}>
        <SendProbe />
      </SocketProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Join" }));
    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok" }));
    await user.click(screen.getByRole("button", { name: "Pass" }));
    expect(socket.sentOf("pass")).toHaveLength(1);

    act(() => socket.disconnect());
    await user.click(screen.getByRole("button", { name: "Pass" }));

    expect(socket.sentOf("pass")).toHaveLength(1);
  });

  it("stores the resume token from `joined` and shows the room on `roomState`", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");

    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok-1" }));
    act(() => socket.fire("roomState", publicState()));

    expect(readStoredSession()).toEqual({
      roomId: "ABC234",
      playerName: "Will",
      resumeToken: "tok-1",
    });
    expect(await screen.findByRole("heading", { name: "Room ABC234" })).toBeInTheDocument();
    expect(screen.getByText("Will")).toBeInTheDocument();
  });

  it("replays the token on reconnect rather than taking a new seat", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");

    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok-1" }));
    act(() => socket.fire("roomState", publicState()));

    act(() => socket.disconnect());
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();

    act(() => socket.connect());
    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(2));
    expect(socket.sentOf("joinRoom")[1]).toEqual(["ABC234", "Will", "tok-1"]);
  });

  it("replays a token stored by an earlier page load", async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ roomId: "ABC234", playerName: "Will", resumeToken: "tok-old" }),
    );
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rejoin ABC234" }));

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC234", "Will", "tok-old"]);
  });

  it("renders a gameError through its error.* key and drops a seat it cannot take", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");

    act(() => socket.fire("gameError", { code: "ROOM_NOT_FOUND" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found");
    expect(readStoredSession()).toBeNull();
    expect(socket.connected).toBe(false);
  });

  it("drops a seat for a join refused because the match already ended", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");

    act(() => socket.fire("gameError", { code: "WRONG_STATUS" }));

    expect(await screen.findByRole("button", { name: "Create room" })).toBeInTheDocument();
    expect(readStoredSession()).toBeNull();
    expect(socket.connected).toBe(false);
  });

  it("falls back to the menu when a replayed join fails after a drop", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");

    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok-1" }));
    act(() => socket.fire("roomState", publicState()));
    expect(await screen.findByRole("heading", { name: "Room ABC234" })).toBeInTheDocument();

    act(() => socket.disconnect());
    act(() => socket.connect());
    // The room went away while we were gone: the seat cannot be reclaimed.
    act(() => socket.fire("gameError", { code: "ROOM_NOT_FOUND" }));

    expect(await screen.findByRole("button", { name: "Create room" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Room ABC234" })).not.toBeInTheDocument();
    expect(readStoredSession()).toBeNull();
  });

  it("keeps a stored seat for another room when a join elsewhere fails", async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ roomId: "ABC234", playerName: "Will", resumeToken: "tok-old" }),
    );
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    // The name is already prefilled from the stored session.
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Room code"), "ZZZ999");
    await user.click(screen.getByRole("button", { name: "Join room" }));
    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    // No token was replayed for the room we mistyped, so none of it was at stake.
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ZZZ999", "Will", undefined]);

    act(() => socket.fire("gameError", { code: "ROOM_NOT_FOUND" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found");
    expect(readStoredSession()).toEqual({
      roomId: "ABC234",
      playerName: "Will",
      resumeToken: "tok-old",
    });
    expect(screen.getByRole("button", { name: "Rejoin ABC234" })).toBeInTheDocument();
  });

  it("keeps the seat when an error arrives after being seated", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");

    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok-1" }));
    act(() => socket.fire("roomState", publicState()));
    act(() => socket.fire("gameError", { code: "NOT_HOST" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only the host can do that");
    expect(readStoredSession()?.resumeToken).toBe("tok-1");
  });

  it("leaving forgets the stored seat", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    await joinAs(socket, "Will");
    act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok-1" }));
    act(() => socket.fire("roomState", publicState()));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Leave room" }));

    expect(readStoredSession()).toBeNull();
    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
  });
});
