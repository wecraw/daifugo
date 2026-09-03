/**
 * The main menu (§10, §11): create, join, and the language toggle.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { LANGUAGE_STORAGE_KEY } from "../src/i18n/index";
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
    // The code is normalised to the server's uppercase alphabet as it is typed.
    expect(socket.sentOf("joinRoom")[0]).toEqual(["ABC234", "Alex", undefined]);
  });

  it("refuses to join without a name, through a key", async () => {
    const user = userEvent.setup();
    const { socket } = renderApp();

    await user.type(screen.getByLabelText("Room code"), "ABC234");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name first");
    expect(socket.sentOf("joinRoom")).toEqual([]);
  });

  it("refuses to join without a room code", async () => {
    const user = userEvent.setup();
    const { socket } = renderApp();

    await user.type(screen.getByLabelText("Your name"), "Will");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a room code");
    expect(socket.sentOf("joinRoom")).toEqual([]);
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

describe("language toggle", () => {
  it("switches every string and persists the choice", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "日本語" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("大富豪");
    expect(screen.getByRole("button", { name: "ルームを作る" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ja"));
    expect(document.documentElement.getAttribute("lang")).toBe("ja");
    expect(document.title).toBe("大富豪");
  });

  it("starts from the stored language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja");
    renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("大富豪");
  });
});
