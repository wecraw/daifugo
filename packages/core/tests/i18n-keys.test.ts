import { describe, expect, it } from "vitest";
import { HOUSE_RULE_KEYS } from "../src/config.js";
import {
  ERROR_CODES,
  ERROR_KEYS,
  HISTORY_KEYS,
  CORE_I18N_KEYS,
  ROLE_KEYS,
  RULE_KEYS,
  errorKey,
  history,
  isRedactableHistoryKey,
  redactedHistoryKey,
  ruleKey,
} from "../src/i18n-keys.js";

describe("i18n key registry", () => {
  it("has one rule key per house rule", () => {
    expect([...RULE_KEYS].sort()).toEqual(HOUSE_RULE_KEYS.map((k) => `rule.${k}`).sort());
    expect(ruleKey("eightGiri")).toBe("rule.eightGiri");
  });

  it("has one role key per role kind", () => {
    expect([...ROLE_KEYS].sort()).toEqual(
      ["role.DAI_FUGO", "role.FUGO", "role.HEIMIN", "role.HINMIN", "role.DAI_HINMIN"].sort(),
    );
  });

  it("has one error key per error code", () => {
    expect([...ERROR_KEYS].sort()).toEqual(ERROR_CODES.map((c) => `error.${c}`).sort());
    expect(errorKey("NOT_YOUR_TURN")).toBe("error.NOT_YOUR_TURN");
  });

  it("unions every namespace with no duplicates", () => {
    const all = [...CORE_I18N_KEYS];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(
      expect.arrayContaining([...RULE_KEYS, ...ROLE_KEYS, ...HISTORY_KEYS, ...ERROR_KEYS]),
    );
    expect(all).toHaveLength(
      RULE_KEYS.length + ROLE_KEYS.length + HISTORY_KEYS.length + ERROR_KEYS.length,
    );
  });

  it("leaves ui.* to the client", () => {
    expect(CORE_I18N_KEYS.some((k) => k.startsWith("ui."))).toBe(false);
  });

  it("namespaces every key", () => {
    for (const key of CORE_I18N_KEYS) {
      expect(key).toMatch(/^(rule|role|history|error)\.[A-Za-z0-9_]+$/);
    }
  });
});

describe("error codes", () => {
  // The client renders the reason inline on the disabled Play button (§10.6), so
  // each distinct illegality reason needs its own code, never one ILLEGAL_PLAY.
  it("gives every distinct illegality reason its own code", () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        "MIXED_RANKS",
        "JOKER_MUST_BE_BOUND",
        "INVALID_BINDING",
        "DUPLICATE_BINDING",
        "NO_LEGAL_BINDING",
        "COMBO_COUNT_MISMATCH",
        "TOO_WEAK",
        "SUIT_LOCK_MISMATCH",
      ]),
    );
  });

  it("has no catch-all illegality bucket", () => {
    for (const code of ERROR_CODES) {
      expect(code).not.toMatch(/^(ILLEGAL_PLAY|INVALID_COMBO|INVALID_PLAY)$/);
    }
  });

  // N-of-a-kind is the only combo shape (§5.3). No sequence vocabulary may creep
  // back in, and there is no combo type to mismatch against the trick top.
  it("carries no sequence or combo-type vocabulary", () => {
    for (const code of ERROR_CODES) {
      expect(code).not.toMatch(/SEQUENCE|COMBO_TYPE/);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe("history entry builder", () => {
  it("builds a plain entry visible to everyone", () => {
    const entry = history("history.passed", { player: "p1" });
    expect(entry).toEqual({ key: "history.passed", params: { player: "p1" } });
    expect(entry.visibleTo).toBeUndefined();
    expect(entry.privateCardParams).toBeUndefined();
  });

  it("carries redaction metadata when given", () => {
    const entry = history(
      "history.sevenPass",
      { player: "p1", target: "p2", count: 1, cards: "S-3" },
      { privateCardParams: ["cards"], visibleTo: ["p1", "p2"] },
    );
    expect(entry.privateCardParams).toEqual(["cards"]);
    expect(entry.visibleTo).toEqual(["p1", "p2"]);
  });

  it("freezes the entry so history cannot be mutated in place", () => {
    const entry = history("history.passed", { player: "p1" });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.params)).toBe(true);
  });

  it("pairs every redacted history key with a non-redacted counterpart", () => {
    for (const key of HISTORY_KEYS) {
      if (key.endsWith("Redacted")) {
        expect(HISTORY_KEYS).toContain(key.slice(0, -"Redacted".length));
      }
    }
  });

  // The sanitizer derives the public key mechanically (§8.5, §11), so the
  // derivation and the list must agree in both directions.
  it("derives the redacted counterpart by appending Redacted", () => {
    expect(redactedHistoryKey("history.sevenPass")).toBe("history.sevenPassRedacted");
    expect(isRedactableHistoryKey("history.sevenPass")).toBe(true);
    expect(isRedactableHistoryKey("history.passed")).toBe(false);
  });

  it("marks a key redactable exactly when its counterpart is listed", () => {
    for (const key of HISTORY_KEYS) {
      expect(isRedactableHistoryKey(key)).toBe(HISTORY_KEYS.includes(`${key}Redacted` as never));
    }
  });
});
