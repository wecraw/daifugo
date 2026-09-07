/**
 * Landscape lock (§0): portrait shows the rotate prompt instead of the table, and
 * the prompt's escape hatch turns the app sideways for a phone that will not turn.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { SIDEWAYS_STORAGE_KEY } from "../src/hooks/useOrientation";
import { FakeSocket } from "./fakeSocket";
import { setOrientation } from "./setup";

function renderApp() {
  const socket = new FakeSocket();
  return render(<App connect={() => socket.asSocket()} />);
}

function frame(container: HTMLElement): HTMLElement {
  const found = container.querySelector(".viewport");
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

describe("OrientationGate", () => {
  it("shows the rotate prompt in portrait", () => {
    setOrientation(true);
    renderApp();
    expect(screen.getByRole("alert")).toHaveTextContent("Rotate your device");
    expect(screen.queryByRole("button", { name: "Create room" })).toBeNull();
  });

  it("shows the menu in landscape", () => {
    setOrientation(false);
    renderApp();
    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
  });

  it("plays sideways in portrait once the player opts in", async () => {
    setOrientation(true);
    const { container } = renderApp();

    await userEvent.click(screen.getByRole("button", { name: /Play sideways/ }));

    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(frame(container)).toHaveClass("viewport--sideways");
  });

  it("remembers the choice, because a locked phone is locked every night", () => {
    setOrientation(true);
    localStorage.setItem(SIDEWAYS_STORAGE_KEY, "true");
    const { container } = renderApp();

    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
    expect(frame(container)).toHaveClass("viewport--sideways");
  });

  it("leaves the frame upright in landscape even when opted in", () => {
    setOrientation(false);
    localStorage.setItem(SIDEWAYS_STORAGE_KEY, "true");
    const { container } = renderApp();

    expect(frame(container)).not.toHaveClass("viewport--sideways");
  });
});
