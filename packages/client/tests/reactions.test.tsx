/**
 * The chat quick-react menu: the draw, the send, and the bubbles it puts on the
 * table.
 *
 * Reactions are relayed, never stored (`core/reactions.ts`), so none of this
 * touches `PublicGameState`: what a test can check is that the menu offers a
 * draw from the pool, that a pick reaches the wire as an id, and that an
 * arriving `reaction` lands on the right seat and then goes away again.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REACTION_COOLDOWN_MS,
  REACTION_IDS,
  REACTION_MENU_SIZE,
  type PublicGameState,
  type ReactionId,
} from "@daifugo/core";
import { App } from "../src/App";
import { COPY } from "../src/i18n/index";
import { drawReactions, reactionKey } from "../src/reactions";
import { REACTION_LIFETIME_MS } from "../src/hooks/useReactions";
import { FakeSocket } from "./fakeSocket";
import { player, publicState } from "./publicState";

function table(): PublicGameState {
  const players = [
    player("p_1", "Will", { seatIndex: 0 }),
    player("p_2", "Alex", { seatIndex: 1 }),
    player("p_3", "Sam", { seatIndex: 2 }),
  ];
  return publicState({
    status: "IN_PROGRESS",
    players,
    turnOrder: players.map((seat) => seat.id),
    hands: Object.fromEntries(players.map((seat) => [seat.id, { cardCount: 3 }])),
  });
}

async function seat() {
  const socket = new FakeSocket();
  render(<App connect={() => socket.asSocket()} />);
  act(() => socket.connect());
  act(() => socket.fire("joined", { roomId: "ABC234", playerId: "p_1", resumeToken: "tok" }));
  act(() => socket.fire("roomState", { ...table(), myPlayerId: "p_1" }));
  return socket;
}

function copyOf(reaction: ReactionId): string {
  return COPY[reactionKey(reaction)];
}

function chipOf(playerId: string): HTMLElement {
  const chip = document.querySelector<HTMLElement>(`[data-player-id="${playerId}"]`);
  if (chip === null) throw new Error(`no chip for ${playerId}`);
  return chip;
}

describe("the draw", () => {
  it("offers as many as the menu holds, all from the pool and all different", () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const drawn = drawReactions();
      expect(drawn).toHaveLength(REACTION_MENU_SIZE);
      expect(new Set(drawn).size).toBe(drawn.length);
      for (const reaction of drawn) expect(REACTION_IDS).toContain(reaction);
    }
  });

  it("can reach every phrase in the pool, so the table does not hear the same three", () => {
    const seen = new Set<ReactionId>();
    for (let attempt = 0; attempt < 2000; attempt++) {
      for (const reaction of drawReactions()) seen.add(reaction);
    }
    expect(seen.size).toBe(REACTION_IDS.length);
  });

  it("draws in the order the randomness asks for", () => {
    // Every draw takes the first candidate left, which is the pool in order.
    expect(drawReactions(3, () => 0)).toEqual([REACTION_IDS[0], REACTION_IDS[1], REACTION_IDS[2]]);
  });

  it("keys every id to copy the client owns", () => {
    for (const reaction of REACTION_IDS) {
      expect(reactionKey(reaction)).toBe(`ui.reaction.${reaction}`);
      expect(copyOf(reaction).trim()).not.toBe("");
    }
  });

  it("carries the one phrase this was all for", () => {
    expect(copyOf("getBent")).toBe("Get bent");
  });
});

describe("the menu", () => {
  it("sends the id, not the phrase, and closes behind itself", async () => {
    const user = userEvent.setup();
    const socket = await seat();

    await user.click(screen.getByRole("button", { name: COPY["ui.reaction.open"] }));
    const panel = screen.getByRole("group", { name: COPY["ui.reaction.open"] });
    const options = within(panel).getAllByRole("button");
    expect(options).toHaveLength(REACTION_MENU_SIZE);

    const chosen = REACTION_IDS.find((id) => copyOf(id) === options[0]?.textContent);
    expect(chosen).toBeDefined();
    await user.click(options[0] as HTMLElement);

    expect(socket.sentOf("sendReaction")).toEqual([[chosen]]);
    expect(screen.queryByRole("group", { name: COPY["ui.reaction.open"] })).toBeNull();
  });

  it("goes quiet for the cooldown the server enforces", async () => {
    vi.useFakeTimers();
    try {
      const socket = await seat();
      const open = () => screen.getByRole("button", { name: COPY["ui.reaction.open"] });
      act(() => fireEvent.click(open()));
      const panel = screen.getByRole("group", { name: COPY["ui.reaction.open"] });
      act(() => fireEvent.click(within(panel).getAllByRole("button")[0] as HTMLElement));

      expect(open()).toBeDisabled();

      act(() => void vi.advanceTimersByTime(REACTION_COOLDOWN_MS + 10));
      expect(open()).toBeEnabled();
      expect(socket.sentOf("sendReaction")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the bubbles", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lands another seat's reaction on their chip and then clears it", async () => {
    const socket = await seat();

    act(() => socket.fire("reaction", { playerId: "p_2", reaction: "getBent" }));
    expect(chipOf("p_2").textContent).toContain(copyOf("getBent"));
    expect(chipOf("p_3").textContent).not.toContain(copyOf("getBent"));

    act(() => void vi.advanceTimersByTime(REACTION_LIFETIME_MS + 10));
    expect(chipOf("p_2").textContent).not.toContain(copyOf("getBent"));
  });

  it("replaces a seat's own previous line rather than stacking", async () => {
    const socket = await seat();

    act(() => socket.fire("reaction", { playerId: "p_2", reaction: "getBent" }));
    act(() => void vi.advanceTimersByTime(500));
    act(() => socket.fire("reaction", { playerId: "p_2", reaction: "skull" }));

    const chip = chipOf("p_2");
    expect(chip.textContent).toContain(copyOf("skull"));
    expect(chip.textContent).not.toContain(copyOf("getBent"));
    expect(chip.querySelectorAll(".reaction-bubble")).toHaveLength(1);

    // The replacement carries its own lifetime: the first one's expiry must not
    // take the second one down with it.
    act(() => void vi.advanceTimersByTime(REACTION_LIFETIME_MS - 400));
    expect(chipOf("p_2").textContent).toContain(copyOf("skull"));
    act(() => void vi.advanceTimersByTime(500));
    expect(chipOf("p_2").textContent).not.toContain(copyOf("skull"));
  });

  it("shows the sender their own line beside the trigger, not on a chip", async () => {
    const socket = await seat();

    act(() => socket.fire("reaction", { playerId: "p_1", reaction: "gg" }));
    const own = document.querySelector(".reaction-bubble--trigger");
    expect(own?.textContent).toBe(copyOf("gg"));
    for (const id of ["p_2", "p_3"]) {
      expect(chipOf(id).textContent).not.toContain(copyOf("gg"));
    }
  });
});
