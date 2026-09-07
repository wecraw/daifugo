/**
 * The main menu (§10, §11): create, join, and the terminology toggle.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { TERMINOLOGY_STORAGE_KEY } from "../src/i18n/index";
import { PLAYER_NAME_STORAGE_KEY } from "../src/playerName";
import { FakeSocket } from "./fakeSocket";

function renderApp() {
  const socket = new FakeSocket();
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify({ roomId: "ABC234" }), { status: 200 }),
  ) as unknown as typeof fetch;
  render(<App connect={() => socket.asSocket()} fetchImpl={fetchImpl} />);
  return { socket, fetchImpl };
}

describe("MainMenu", () => {
  it("remembers a chosen icon and sends it when joining and reconnecting", async () => {
    const user = userEvent.setup();
    const { socket } = renderApp();
    await user.click(screen.getByRole("button", { name: "Your icon" }));
    await user.click(screen.getByRole("button", { name: "Choose 🦊" }));
    expect(localStorage.getItem("daifugo.playerIcon")).toBe("🦊");
    expect(screen.queryByRole("group", { name: "Your icon" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.type(screen.getByLabelText("Room code"), "ABC");
    await user.click(screen.getByRole("button", { name: "Join room" }));
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC", "Will", undefined, "🦊"]);
    socket.fire("connect");
    expect(socket.sentOf("joinRoom").at(-1)).toEqual(["ABC", "Will", undefined, "🦊"]);
  });

  it("dismisses the icon picker with Escape and returns focus", async () => {
    const user = userEvent.setup();
    renderApp();
    const trigger = screen.getByRole("button", { name: "Your icon" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // WKWebView does not focus a button on tap: it blurs whatever was focused and
  // leaves focus on the body, so the picker sees a focusout naming nothing. That
  // must not be read as "focus left the picker", or the panel closes on
  // pointerdown and the tap never becomes a click (iOS could pick no icon).
  it("keeps the icon picker open when focus is dropped rather than moved", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Your icon" }));
    const panel = screen.getByRole("group", { name: "Your icon" });
    fireEvent.focusOut(document.activeElement ?? panel, { relatedTarget: null });
    expect(screen.getByRole("group", { name: "Your icon" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose 🦊" }));
    expect(localStorage.getItem("daifugo.playerIcon")).toBe("🦊");
  });

  it("creates a room over HTTP and joins the code it gets back", async () => {
    const user = userEvent.setup();
    const { socket, fetchImpl } = renderApp();

    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    expect(fetchImpl).toHaveBeenCalledWith("/rooms", { method: "POST" });
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC234", "Will", undefined]);
  });

  it("joins by code", async () => {
    const user = userEvent.setup();
    const { socket } = renderApp();

    await user.type(screen.getByLabelText("Your name"), "Alex");
    await user.type(screen.getByLabelText("Room code"), "abc234");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    await waitFor(() => expect(socket.sentOf("joinRoom").length).toBe(1));
    // The code is normalised to uppercase letters only, and truncated to 3 chars, as it is typed.
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC", "Alex", undefined]);
  });

  it("refuses to join without a name, through a key", async () => {
    const user = userEvent.setup();
    const { socket } = renderApp();

    await user.type(screen.getByLabelText("Room code"), "ABC234");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name first");
    expect(socket.sentOf("joinRoom")).toEqual([]);
  });

  it("keeps join disabled until the code is a full three letters", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByLabelText("Your name"), "Will");
    const join = screen.getByRole("button", { name: "Join room" });
    expect(join).toBeDisabled();

    await user.type(screen.getByLabelText("Room code"), "ab");
    expect(join).toBeDisabled();

    await user.type(screen.getByLabelText("Room code"), "c");
    expect(join).toBeEnabled();
  });

  it("reports a failed room creation through a key", async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    const fetchImpl = vi.fn(
      async () => new Response("no", { status: 500 }),
    ) as unknown as typeof fetch;
    render(<App connect={() => socket.asSocket()} fetchImpl={fetchImpl} />);

    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create a room");
    expect(socket.sentOf("joinRoom")).toEqual([]);
  });
});

/*
 * The keyboard on iOS is drawn over the web view rather than resizing it
 * (`capacitor.config.ts`), so the focused name field lifts clear of it. The
 * lift itself is CSS; what is testable here is the state that drives it and the
 * way back out.
 */
describe("focused name field", () => {
  function spotlight(): HTMLElement | null {
    return document.querySelector(".main-menu[data-spotlight]");
  }

  it("marks the menu while the name field is focused", async () => {
    const user = userEvent.setup();
    renderApp();

    expect(spotlight()).toBeNull();
    await user.click(screen.getByLabelText("Your name"));
    expect(spotlight()).toHaveAttribute("data-spotlight", "open");
  });

  it("closes on a tap outside, and on Enter", async () => {
    const user = userEvent.setup();
    renderApp();
    const nameField = screen.getByLabelText("Your name");

    await user.click(nameField);
    const scrim = document.querySelector(".input-spotlight");
    expect(scrim).not.toBeNull();
    await user.click(scrim as Element);
    expect(nameField).not.toHaveFocus();
    await waitFor(() => expect(spotlight()).toBeNull());

    await user.click(nameField);
    await user.keyboard("{Enter}");
    expect(nameField).not.toHaveFocus();
    await waitFor(() => expect(spotlight()).toBeNull());
  });
});

describe("remembered name", () => {
  it("remembers the name a join was made under", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.type(screen.getByLabelText("Room code"), "abc");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    await waitFor(() => expect(localStorage.getItem(PLAYER_NAME_STORAGE_KEY)).toBe("Will"));
  });

  it("starts the next visit with that name already filled in", () => {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, "Will");
    renderApp();

    expect(screen.getByLabelText("Your name")).toHaveValue("Will");
  });
});

describe("terminology toggle", () => {
  it("switches game terminology while leaving the interface in English", async () => {
    const user = userEvent.setup();
    renderApp();

    // Daifugo is the default (§11), so the toggle's job is the other direction.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Daifugo");
    await user.click(screen.getByRole("button", { name: "Grand Millionaire" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Grand Millionaire");
    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
    await waitFor(() =>
      expect(localStorage.getItem(TERMINOLOGY_STORAGE_KEY)).toBe("grandMillionaire"),
    );
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.title).toBe("Grand Millionaire");
  });

  it("starts from the stored terminology", () => {
    localStorage.setItem(TERMINOLOGY_STORAGE_KEY, "grandMillionaire");
    renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Grand Millionaire");
  });
});
