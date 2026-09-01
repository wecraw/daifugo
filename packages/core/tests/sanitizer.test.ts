/**
 * §12.4 test 30 and §8.5: per-viewer state and history redaction.
 *
 * The headline assertion is structural rather than field-by-field: the whole
 * serialized `roomState` payload is deep-scanned for any card id a third party
 * must not hold. A future field that carries private ids fails this test without
 * anyone remembering to extend it.
 */
import { describe, expect, it } from "vitest";
import { createExchangeState } from "../src/roles.js";
import { getPublicState, redactHistory, redactHistoryEntry } from "../src/sanitizer.js";
import { history } from "../src/i18n-keys.js";
import type { GameState } from "../src/types.js";
import { cards, handIds, table } from "./fixtures.js";

const HANDS = {
  will: ["S-3", "H-11", "JKR-1"],
  alex: ["D-7", "C-9"],
  sam: ["S-13", "H-2"],
};

function tableOf(): GameState {
  return table({ hands: HANDS });
}

/** Every string anywhere in a JSON-serializable value, keys included. */
function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) deepStrings(item, out);
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      deepStrings(item, out);
    }
  }
  return out;
}

/** Card ids that appear anywhere in the serialized payload. */
function leakedIds(payload: unknown, ids: string[]): string[] {
  const strings = deepStrings(JSON.parse(JSON.stringify(payload)));
  return ids.filter((id) => strings.some((s) => s === id || s.split(" ").includes(id)));
}

describe("getPublicState (§8.5)", () => {
  it("replaces every hand with a count and exposes only the viewer's own cards", () => {
    const state = tableOf();
    const view = getPublicState(state, "will");

    expect(view.myPlayerId).toBe("will");
    expect(view.myHand.map((c) => c.id)).toEqual(HANDS.will);
    expect(view.hands).toEqual({
      will: { cardCount: 3 },
      alex: { cardCount: 2 },
      sam: { cardCount: 2 },
    });
  });

  it("never leaks another player's card ids into a third party's payload (test 30)", () => {
    const state = tableOf();
    const view = getPublicState(state, "sam");

    expect(leakedIds(view, [...HANDS.will, ...HANDS.alex])).toEqual([]);
    expect(leakedIds(view, HANDS.sam).sort()).toEqual([...HANDS.sam].sort());
  });

  it("keeps the public fields of the round intact", () => {
    const state = table({
      hands: HANDS,
      trick: [{ playedBy: "alex", cards: ["D-7"] }],
      passed: ["sam"],
      isRevolution: true,
    });
    const view = getPublicState(state, "sam");

    expect(view.stateVersion).toBe(state.stateVersion);
    expect(view.turnOrder).toEqual(state.turnOrder);
    expect(view.currentTrick[0]?.combo.cards.map((c) => c.id)).toEqual(["D-7"]);
    expect(view.passedPlayerIds).toEqual(["sam"]);
    expect(view.isRevolution).toBe(true);
    expect(view.players.map((p) => p.name)).toEqual(["WILL", "ALEX", "SAM"]);
  });

  it("gives a viewer with no seat an empty hand rather than throwing", () => {
    const view = getPublicState(tableOf(), "spectator");
    expect(view.myHand).toEqual([]);
    expect(view.myPlayerId).toBe("spectator");
    expect(view.hands.will).toEqual({ cardCount: 3 });
  });

  it("shares no mutable container with the authoritative state", () => {
    const state: GameState = {
      ...tableOf(),
      graveyard: cards("D-4"),
      suitLock: ["HEARTS"],
      pendingAction: { type: "RESOLVE_10_DISCARD", playerId: "will", count: 2 },
    };
    const view = getPublicState(state, "will");

    view.graveyard.push(...cards("C-5"));
    view.suitLock?.push("SPADES");
    if (view.pendingAction !== null) view.pendingAction.count = 99;

    expect(state.graveyard.map((c) => c.id)).toEqual(["D-4"]);
    expect(state.suitLock).toEqual(["HEARTS"]);
    expect(state.pendingAction?.count).toBe(2);
  });

  it("does not mutate the state it sanitizes", () => {
    const state = tableOf();
    const before = JSON.parse(JSON.stringify(state));
    getPublicState(state, "will");
    expect(JSON.parse(JSON.stringify(state))).toEqual(before);
    expect(handIds(state, "will")).toEqual(HANDS.will);
  });
});

describe("exchange redaction (§4.3, §12.4 test 30)", () => {
  function exchanging(): GameState {
    const state = tableOf();
    const hands = {
      will: cards(...HANDS.will),
      alex: cards(...HANDS.alex),
      sam: cards(...HANDS.sam),
    };
    const exchange = createExchangeState(["will", "alex", "sam"], hands);
    return {
      ...state,
      status: "EXCHANGE",
      exchange: { ...exchange, submitted: { will: ["H-11"] } },
    };
  }

  it("counts other players' forced and submitted selections instead of naming them", () => {
    const state = exchanging();
    const forcedForSam = state.exchange?.forced["sam"] ?? [];
    expect(forcedForSam.length).toBeGreaterThan(0);

    const view = getPublicState(state, "alex");
    expect(view.exchange?.required).toEqual(state.exchange?.required);
    expect(view.exchange?.partner).toEqual(state.exchange?.partner);
    expect(view.exchange?.forced["sam"]).toEqual({ cardCount: forcedForSam.length });
    expect(view.exchange?.submitted["will"]).toEqual({ cardCount: 1 });
    expect(leakedIds(view, [...forcedForSam, "H-11"])).toEqual([]);
  });

  it("hands the viewer back their own forced and submitted card ids", () => {
    const state = exchanging();
    const samView = getPublicState(state, "sam");
    expect(samView.myForcedCards).toEqual(state.exchange?.forced["sam"]);

    const willView = getPublicState(state, "will");
    expect(willView.mySubmittedCards).toEqual(["H-11"]);
    expect(willView.myForcedCards).toEqual([]);
  });

  it("leaves a null exchange null", () => {
    expect(getPublicState(tableOf(), "will").exchange).toBeNull();
  });
});

describe("history redaction (§8.5, §11)", () => {
  const sevenPass = history(
    "history.sevenPass",
    { player: "will", target: "alex", cards: "S-3", count: 1 },
    { privateCardParams: ["cards"], visibleTo: ["will", "alex"] },
  );

  it("shows the named cards to the parties named in visibleTo", () => {
    for (const viewer of ["will", "alex"]) {
      expect(redactHistoryEntry(sevenPass, viewer)).toEqual(sevenPass);
    }
  });

  it("rewrites the entry to a count for everyone else", () => {
    const entry = redactHistoryEntry(sevenPass, "sam");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("history.sevenPassRedacted");
    expect(entry?.params).toEqual({ player: "will", target: "alex", count: 1 });
    expect(entry?.params.cards).toBeUndefined();
    expect(entry?.privateCardParams).toBeUndefined();
    expect(entry?.visibleTo).toBeUndefined();
  });

  it("never redacts player names", () => {
    const entry = redactHistoryEntry(sevenPass, "sam");
    expect(entry?.params.player).toBe("will");
    expect(entry?.params.target).toBe("alex");
  });

  it("derives the count when the entry carries no count param", () => {
    const entry = redactHistoryEntry(
      history(
        "history.exchangeGave",
        { player: "will", target: "alex", cards: "S-3 H-11" },
        { privateCardParams: ["cards"], visibleTo: ["will", "alex"] },
      ),
      "sam",
    );
    expect(entry?.key).toBe("history.exchangeGaveRedacted");
    expect(entry?.params).toEqual({ player: "will", target: "alex", count: 2 });
  });

  it("leaves a 10-discard naming its cards intact for every viewer (§8.5)", () => {
    const entry = history("history.tenDiscard", {
      player: "will",
      cards: "S-3 H-11",
      count: 2,
    });
    expect(redactHistoryEntry(entry, "sam")).toBe(entry);
  });

  it("leaves public entries alone", () => {
    const entry = history("history.passed", { player: "will" });
    expect(redactHistoryEntry(entry, "sam")).toBe(entry);
    expect(redactHistoryEntry(entry, "will")).toBe(entry);
  });

  it("leaves an entry visible to everyone alone even when it names cards", () => {
    const entry = history(
      "history.exchangeGave",
      { player: "will", target: "alex", cards: "S-3", count: 1 },
      { privateCardParams: ["cards"] },
    );
    expect(redactHistoryEntry(entry, "sam")).toBe(entry);
  });

  it("drops an entry addressed to named players that has no redacted counterpart", () => {
    const entry = history("history.passed", { player: "will" }, { visibleTo: ["will"] });
    expect(redactHistoryEntry(entry, "sam")).toBeNull();
    expect(redactHistoryEntry(entry, "will")).toBe(entry);
  });

  it("redacts the whole log in order", () => {
    const log = [history("history.passed", { player: "will" }), sevenPass];
    expect(redactHistory(log, "sam").map((e) => e.key)).toEqual([
      "history.passed",
      "history.sevenPassRedacted",
    ]);
    expect(redactHistory(log, "alex").map((e) => e.key)).toEqual([
      "history.passed",
      "history.sevenPass",
    ]);
  });

  it("carries the redacted log into the public state", () => {
    const state = tableOf();
    const view = getPublicState({ ...state, history: [...state.history, sevenPass] }, "sam");
    const last = view.history[view.history.length - 1];
    expect(last?.key).toBe("history.sevenPassRedacted");
    expect(leakedIds(view.history, ["S-3"])).toEqual([]);
  });
});
