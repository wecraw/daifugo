/**
 * Timeout semantics (§7.6, §14).
 *
 * `TICK` is the only action carrying time, and every timeout in the game is one
 * of its transitions: the leader plays the weakest legal single, a follower
 * passes, a pending 7-pass or 10-discard submits the weakest `k`, and an
 * unsubmitted rich player gives their weakest cards.
 *
 * Two properties are load-bearing beyond the table of auto-actions. A `TICK`
 * before `deadline` must leave the state untouched, which is what makes a
 * duplicate sweep from a second instance safe; and the deadline a fired `TICK`
 * writes is measured from the deadline that expired, not from `now`, so a room
 * that went dark converges on the same state whether its ticks arrived on time
 * or all at once (§14).
 */
import { describe, expect, it } from "vitest";
import { TURN_DURATION_MS, applyAction, stampDeadline, timeoutDurationMs } from "../src/engine.js";
import { EXCHANGE_DURATION_MS, createExchangeState } from "../src/roles.js";
import type { GameState, Role } from "../src/types.js";
import { activeId, handIds, table, type TableOptions } from "./fixtures.js";
import { act } from "./invariants.js";

const DEADLINE = 1_700_000_000_000;

const DAI_HINMIN: Role = { kind: "DAI_HINMIN" };
const DAI_FUGO: Role = { kind: "DAI_FUGO" };

/** A table whose clock is already armed, as the server arms it (§8.4 step 5). */
function armed(options: TableOptions, deadline = DEADLINE): GameState {
  return { ...table(options), deadline };
}

function tick(state: GameState, now: number): GameState {
  return act(state, { type: "TICK", now }, "server");
}

function keys(state: GameState): string[] {
  return state.history.map((entry) => entry.key);
}

/* -------------------------------------------------------------------------- */
/* The no-op half (§14)                                                       */
/* -------------------------------------------------------------------------- */

describe("a TICK before the deadline (§14)", () => {
  const state = armed({ hands: { p0: ["H-4"], p1: ["D-6"], p2: ["C-8"] } });

  it("returns the state unchanged, so a duplicate sweep is safe", () => {
    const result = applyAction(state, { type: "TICK", now: DEADLINE - 1 }, "server");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(state);
    expect(result.value.stateVersion).toBe(state.stateVersion);
  });

  it("fires exactly on the deadline, not a millisecond later", () => {
    expect(tick(state, DEADLINE).currentTrick).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The auto-actions (§7.6)                                                    */
/* -------------------------------------------------------------------------- */

describe("the turn timer (§7.6)", () => {
  it("plays the leader's weakest legal single", () => {
    const state = armed({ hands: { p0: ["S-9", "H-4"], p1: ["D-6"], p2: ["C-8"] } });
    const ticked = tick(state, DEADLINE);

    expect(ticked.currentTrick[0]?.combo.cards.map((card) => card.id)).toEqual(["H-4"]);
    expect(handIds(ticked, "p0")).toEqual(["S-9"]);
    expect(activeId(ticked)).toBe("p1");
    expect(keys(ticked)).toContain("history.turnTimeout");
    expect(keys(ticked)).toContain("history.autoPlayed");
  });

  it("passes for a follower rather than playing over the trick", () => {
    const state = armed({
      hands: { p0: ["H-4"], p1: ["D-6"], p2: ["C-8"] },
      trick: [{ playedBy: "p0", cards: ["S-13"] }],
      active: "p1",
    });
    const ticked = tick(state, DEADLINE);

    expect(ticked.passedPlayerIds).toEqual(["p1"]);
    expect(handIds(ticked, "p1")).toEqual(["D-6"]);
    expect(activeId(ticked)).toBe("p2");
    expect(keys(ticked)).toContain("history.autoPassed");
  });

  it("fires for a disconnected player, so the table never stalls (§8.3)", () => {
    const state = armed({ hands: { p0: ["S-9", "H-4"], p1: ["D-6"], p2: ["C-8"] } });
    const offline = {
      ...state,
      players: state.players.map((player) =>
        player.id === "p0" ? { ...player, isConnected: false } : player,
      ),
    };

    expect(tick(offline, DEADLINE).currentTrick).toHaveLength(1);
  });

  it("submits the weakest k for a pending 7-pass", () => {
    const state = armed({ hands: { p0: ["S-7", "H-4", "D-2"], p1: ["C-5"], p2: ["C-8"] } });
    const halted = act(state, { type: "PLAY_CARDS", cardIds: ["S-7"] }, "p0");
    expect(halted.pendingAction).toMatchObject({ type: "RESOLVE_7_PASS", count: 1 });

    const ticked = tick({ ...halted, deadline: DEADLINE }, DEADLINE);

    expect(ticked.pendingAction).toBeNull();
    expect(handIds(ticked, "p1")).toContain("H-4");
    expect(handIds(ticked, "p0")).toEqual(["D-2"]);
    expect(keys(ticked)).toContain("history.turnTimeout");
  });

  it("discards the weakest k for a pending 10-discard", () => {
    const state = armed({ hands: { p0: ["S-10", "H-4", "D-2"], p1: ["C-5"], p2: ["C-8"] } });
    const halted = act(state, { type: "PLAY_CARDS", cardIds: ["S-10"] }, "p0");
    const ticked = tick({ ...halted, deadline: DEADLINE }, DEADLINE);

    expect(ticked.pendingAction).toBeNull();
    expect(handIds(ticked, "p0")).toEqual(["D-2"]);
    expect(ticked.graveyard.some((card) => card.id === "H-4")).toBe(true);
  });
});

describe("the exchange timer (§4.4, §7.6)", () => {
  const dealt = table({
    hands: { p0: ["S-4", "H-13"], p1: ["D-6"], p2: ["C-8", "C-9"] },
    status: "EXCHANGE",
  });
  const state: GameState = {
    ...dealt,
    exchange: createExchangeState(["p0", "p1", "p2"], dealt.hands),
    deadline: DEADLINE,
  };

  it("auto-gives the unsubmitted rich player their weakest cards", () => {
    const ticked = tick(state, DEADLINE);

    expect(handIds(ticked, "p2")).toContain("S-4");
    expect(handIds(ticked, "p0")).toContain("C-9");
    expect(ticked.exchange).toBeNull();
    expect(ticked.status).toBe("IN_PROGRESS");
    expect(keys(ticked)).toContain("history.exchangeAutoGave");
  });

  it("runs on the exchange duration rather than the turn duration", () => {
    expect(timeoutDurationMs(state)).toBe(EXCHANGE_DURATION_MS);
    expect(timeoutDurationMs(dealt)).toBe(TURN_DURATION_MS);
  });
});

/* -------------------------------------------------------------------------- */
/* The deadline field itself                                                  */
/* -------------------------------------------------------------------------- */

describe("`deadline` (§7.6, §14)", () => {
  it("is set on every state that can expire and null on every state that cannot", () => {
    const lobby = table({ hands: { p0: ["H-4"], p1: ["D-6"], p2: ["C-8"] }, status: "LOBBY" });

    expect(stampDeadline(lobby, DEADLINE).deadline).toBeNull();
    expect(stampDeadline({ ...lobby, status: "ROUND_END" }, DEADLINE).deadline).toBeNull();
    expect(stampDeadline({ ...lobby, status: "MATCH_END" }, DEADLINE).deadline).toBeNull();
    expect(stampDeadline({ ...lobby, status: "IN_PROGRESS" }, DEADLINE).deadline).toBe(
      DEADLINE + TURN_DURATION_MS,
    );
    expect(stampDeadline({ ...lobby, status: "EXCHANGE" }, DEADLINE).deadline).toBe(
      DEADLINE + EXCHANGE_DURATION_MS,
    );
  });

  it("re-arms off the deadline that expired, not off `now`", () => {
    const state = armed({ hands: { p0: ["S-9", "H-4"], p1: ["D-6"], p2: ["C-8"] } });
    const late = tick(state, DEADLINE + 10 * TURN_DURATION_MS);

    expect(late.deadline).toBe(DEADLINE + TURN_DURATION_MS);
  });

  it("is stamped rather than ignored when a state that can expire carries none", () => {
    const state = table({ hands: { p0: ["S-9", "H-4"], p1: ["D-6"], p2: ["C-8"] } });
    expect(state.deadline).toBeNull();
    const ticked = tick(state, DEADLINE);

    expect(ticked.deadline).toBe(DEADLINE + TURN_DURATION_MS);
    expect(ticked.currentTrick).toEqual([]);
  });

  it("is cleared by a TICK on a state that can no longer expire", () => {
    const ended = table({ hands: { p0: [], p1: ["D-6"], p2: [] }, status: "ROUND_END" });
    const ticked = tick({ ...ended, deadline: DEADLINE }, DEADLINE);

    expect(ticked.deadline).toBeNull();
    expect(applyAction(ticked, { type: "TICK", now: DEADLINE }, "server")).toMatchObject({
      value: ticked,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance (§14)                                                           */
/* -------------------------------------------------------------------------- */

/** Tick until nothing can expire, either on schedule or all at once. */
function drain(state: GameState, now: (deadline: number) => number): GameState {
  let current = state;
  for (let step = 0; step < 200; step++) {
    const deadline = current.deadline;
    if (deadline === null) return current;
    const result = applyAction(current, { type: "TICK", now: now(deadline) }, "server");
    if (!result.ok) throw new Error(`unexpected ${result.error} from TICK`);
    if (result.value === current) return current;
    current = result.value;
  }
  throw new Error("a TICK stopped making progress");
}

describe("replaying elapsed TICKs (§14)", () => {
  const state = armed({
    hands: { p0: ["S-9", "H-4"], p1: ["D-6", "D-7"], p2: ["C-8", "C-11"] },
  });

  it("converges on the same state as having ticked them live", () => {
    const live = drain(state, (deadline) => deadline);
    const replayed = drain(state, () => DEADLINE + 60 * TURN_DURATION_MS);

    expect(replayed).toEqual(live);
    expect(live.status).toBe("ROUND_END");
  });

  it("always makes progress, including immediately after a demotion (§4.5)", () => {
    const demoting = armed({
      hands: {
        p0: ["S-3"],
        p1: ["H-4", "H-5"],
        p2: ["D-4"],
        p3: ["C-4"],
        p4: ["S-4"],
      },
      roles: { p0: DAI_HINMIN, p1: DAI_FUGO },
    });
    const demoted = act(demoting, { type: "PLAY_CARDS", cardIds: ["S-3"] }, "p0");
    expect(demoted.droppedPlayerIds).toEqual(["p1"]);

    const ended = drain({ ...demoted, deadline: DEADLINE }, (deadline) => deadline);
    expect(ended.status).toBe("ROUND_END");
  });
});
