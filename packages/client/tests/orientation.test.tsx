/**
 * Landscape lock (§0): portrait shows the rotate prompt instead of the table.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { FakeSocket } from "./fakeSocket";
import { setOrientation } from "./setup";

function renderApp() {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
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
});
