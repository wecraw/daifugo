/**
 * Invite links tapped into the iOS app (§14).
 *
 * A universal link does not navigate the web view — iOS hands the URL to the
 * app while it keeps whatever page it had — so the code has to be read out of
 * `appUrlOpen` and joined from there. `native.ts` is mocked to stand in for the
 * Capacitor listener; everything below it is the real provider, which is the
 * part worth testing: a tapped link behaves exactly like a load on `/ABC`.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { SESSION_STORAGE_KEY } from "../src/context/SocketContext";
import { readRoomCodeFromUrl } from "../src/roomUrl";
import { FakeSocket } from "./fakeSocket";
import { publicState } from "./publicState";

const links = vi.hoisted(() => new Set<(url: string) => void>());

vi.mock("../src/native", () => ({
  // False, so `storage.ts` keeps its web path; the deep link is delivered by
  // the mocked listener rather than by the platform check.
  isNative: () => false,
  onAppResume: () => () => {},
  onDeepLink: (onUrl: (url: string) => void) => {
    links.add(onUrl);
    return () => links.delete(onUrl);
  },
}));

/** What Capacitor's `appUrlOpen` does when the invite link is tapped. */
function tapInviteLink(url: string): void {
  act(() => {
    for (const onUrl of links) onUrl(url);
  });
}

describe("readRoomCodeFromUrl", () => {
  it("reads the code out of a whole invite URL", () => {
    expect(readRoomCodeFromUrl("https://daifugo.wecraw.com/ABC")).toBe("ABC");
    expect(readRoomCodeFromUrl("https://daifugo.wecraw.com/abc?from=sms")).toBe("ABC");
  });

  it("reads nothing from a URL that names no room, or from a non-URL", () => {
    expect(readRoomCodeFromUrl("https://daifugo.wecraw.com/")).toBeNull();
    expect(readRoomCodeFromUrl("https://daifugo.wecraw.com/ABCD")).toBeNull();
    expect(readRoomCodeFromUrl("not a url")).toBeNull();
  });
});

describe("a tapped invite link", () => {
  it("joins the room under the name this device already knows", async () => {
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
    // The stored seat replays on its own at mount; the link redirects from it.
    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));

    tapInviteLink("https://daifugo.wecraw.com/xyz");

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(2));
    // The link's room outranks the stored seat's, and that seat's token belongs
    // to the other room, so it is not replayed.
    expect(socket.sentOf("joinRoom")[1]).toEqual([
      "XYZ",
      "Will",
      undefined,
      localStorage.getItem("daifugo.playerIcon"),
    ]);
  });

  it("prefills the menu and waits for a name when it knows none", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    tapInviteLink("https://daifugo.wecraw.com/ABC");

    expect(await screen.findByLabelText("Room code")).toHaveValue("ABC");
    expect(socket.sentOf("joinRoom")).toHaveLength(0);
  });

  it("moves a seated app to the room the second link names", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.type(screen.getByLabelText("Room code"), "ABC");
    await user.click(screen.getByRole("button", { name: "Join room" }));
    act(() => socket.fire("joined", { roomId: "ABC", playerId: "p_1", resumeToken: "tok" }));
    act(() => socket.fire("roomState", publicState({ roomId: "ABC" })));
    await screen.findByRole("heading", { name: "Room ABC" });

    tapInviteLink("https://daifugo.wecraw.com/XYZ");

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(2));
    expect(socket.sentOf("joinRoom")[1]).toEqual([
      "XYZ",
      "Will",
      undefined,
      localStorage.getItem("daifugo.playerIcon"),
    ]);
  });

  it("rejoins the same room when the same link is tapped again", async () => {
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

    tapInviteLink("https://daifugo.wecraw.com/ABC");
    tapInviteLink("https://daifugo.wecraw.com/ABC");

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(3));
  });

  it("ignores a link that names no room", async () => {
    const socket = new FakeSocket();
    render(<App connect={() => socket.asSocket()} />);

    tapInviteLink("https://daifugo.wecraw.com/");

    expect(await screen.findByLabelText("Room code")).toHaveValue("");
    expect(socket.sentOf("joinRoom")).toHaveLength(0);
  });
});
