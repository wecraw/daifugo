/**
 * The room code in the address bar (§8): the path follows the seat, and a page
 * loaded on `/ABC` tries to join ABC.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { SESSION_STORAGE_KEY } from "../src/context/SocketContext";
import { readRoomCodeFromPath } from "../src/roomUrl";
import { FakeSocket } from "./fakeSocket";
import { publicState } from "./publicState";

function seat(socket: FakeSocket, roomId = "ABC"): void {
  act(() => socket.fire("joined", { roomId, playerId: "p_1", resumeToken: "tok" }));
  act(() => socket.fire("roomState", publicState({ roomId })));
}

describe("readRoomCodeFromPath", () => {
  it("reads a three-letter code, case-insensitively", () => {
    expect(readRoomCodeFromPath("/ABC")).toBe("ABC");
    expect(readRoomCodeFromPath("/abc")).toBe("ABC");
    expect(readRoomCodeFromPath("/abc/")).toBe("ABC");
  });

  it("reads nothing from a path that names no code", () => {
    expect(readRoomCodeFromPath("/")).toBeNull();
    expect(readRoomCodeFromPath("")).toBeNull();
    expect(readRoomCodeFromPath("/AB")).toBeNull();
    expect(readRoomCodeFromPath("/ABCD")).toBeNull();
    expect(readRoomCodeFromPath("/AB3")).toBeNull();
    expect(readRoomCodeFromPath("/index.html")).toBeNull();
  });
});

describe("the address bar", () => {
  it("carries the room code once seated", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.type(screen.getByLabelText("Room code"), "ABC");
    await user.click(screen.getByRole("button", { name: "Join room" }));
    seat(socket);

    await waitFor(() => expect(location.pathname).toBe("/ABC"));
  });

  it("returns to the root when the seat is given up", async () => {
    history.replaceState(null, "", "/ABC");
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        roomId: "ABC",
        playerName: "Will",
        resumeToken: "tok",
        savedAt: Date.now(),
      }),
    );
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);
    seat(socket);
    await screen.findByRole("heading", { name: "Room ABC" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Leave room" }));
    const [ack] = socket.sentOf("leaveRoom")[0] ?? [];
    if (typeof ack === "function") act(() => ack());

    await waitFor(() => expect(location.pathname).toBe("/"));
  });

  it("keeps the code in the path while a join is still in flight", async () => {
    history.replaceState(null, "", "/ABC");
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ roomId: "ABC", playerName: "Will", resumeToken: "tok" }),
    );
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    expect(location.pathname).toBe("/ABC");
  });
});

describe("a page loaded on a room code", () => {
  it("auto-joins it under the name this browser already knows", async () => {
    history.replaceState(null, "", "/xyz");
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        roomId: "ABC",
        playerName: "Will",
        resumeToken: "tok-abc",
        savedAt: Date.now(),
      }),
    );
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    // The URL's room outranks the stored seat's room, and the token belongs to
    // the other room, so it is not replayed.
    expect(socket.sentOf("joinRoom")[0]).toEqual(["XYZ", "Will", undefined]);
  });

  it("auto-joins even when the stored seat is too old to replay on its own", async () => {
    history.replaceState(null, "", "/ABC");
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        roomId: "ABC",
        playerName: "Will",
        resumeToken: "tok-old",
        savedAt: Date.now() - 7 * 60 * 60 * 1000,
      }),
    );
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC", "Will", "tok-old"]);
  });

  it("prefills the code and waits for a name when it knows none", async () => {
    history.replaceState(null, "", "/ABC");
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    expect(await screen.findByLabelText("Room code")).toHaveValue("ABC");
    expect(socket.sentOf("joinRoom")).toHaveLength(0);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Alex");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC", "Alex", undefined]);
  });
});
