/**
 * Rendering a `HistoryEntry` into a line (§11).
 *
 * The engine has no names and no glyphs to give: history params carry player ids
 * and raw card ids, because that is all `GameState` may hold (§11). Turning them
 * into something a player reads is the client's job, and §8.5 spells out the
 * target — "Will passed 3♠ to Alex", not "Will passed S-3 to Alex".
 */
import { describe, expect, it } from "vitest";
import { history, type Player } from "@daifugo/core";
import { historyLine } from "../src/history";
import { translate } from "../src/i18n/index";

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("en", key, params);

const ROSTER: Player[] = [
  { id: "p_1", name: "Will", role: null, seatIndex: 0, isReady: false, isConnected: true },
  { id: "p_2", name: "Alex", role: null, seatIndex: 1, isReady: false, isConnected: true },
];

describe("historyLine (§8.5, §11)", () => {
  it("renders card ids as faces, not as ids", () => {
    const line = historyLine(
      t,
      history("history.played", { player: "p_1", cards: "S-3 H-3", count: 2 }),
      ROSTER,
    );
    expect(line).toBe("Will played 3♠ 3♥");
  });

  it("renders the 7-pass the way §8.5 writes it", () => {
    const line = historyLine(
      t,
      history(
        "history.sevenPass",
        { player: "p_1", target: "p_2", cards: "S-3", count: 1 },
        { privateCardParams: ["cards"], visibleTo: ["p_1", "p_2"] },
      ),
      ROSTER,
    );
    expect(line).toBe("Will passed 3♠ to Alex");
  });

  it("renders a joker as its own glyph", () => {
    const line = historyLine(
      t,
      history("history.tenDiscard", { player: "p_1", cards: "D-10 JKR-1", count: 2 }),
      ROSTER,
    );
    expect(line).toBe("Will discarded 10♦ ★");
  });

  it("renders a suit lock as pips (§6)", () => {
    const line = historyLine(
      t,
      history("history.shibariLocked", { player: "p_1", suits: "SH" }),
      ROSTER,
    );
    expect(line).toBe("Will locked the suit to ♠♥");
  });

  it("leaves counts, rounds and nested keys alone", () => {
    expect(
      historyLine(
        t,
        history("history.sevenPassRedacted", { player: "p_1", target: "p_2", count: 2 }),
        ROSTER,
      ),
    ).toBe("Will passed 2 card(s) to Alex");
    expect(historyLine(t, history("history.roundStarted", { round: 3 }), ROSTER)).toBe(
      "Round 3 started",
    );
    expect(
      historyLine(
        t,
        history("history.roleAssigned", { player: "p_1", role: "role.DAI_FUGO" }),
        ROSTER,
      ),
    ).toBe("Will is Grand Millionaire");
  });

  it("passes an unrecognisable value through untouched", () => {
    // `history.fiveSkip` carries `skipped` — a list of *player* ids, not cards —
    // which no English string renders, but nothing may mangle it either.
    expect(
      historyLine(
        t,
        history("history.fiveSkip", { player: "p_1", count: 1, skipped: "p_2" }),
        ROSTER,
      ),
    ).toBe("Will skipped 1 player(s)");
  });
});
