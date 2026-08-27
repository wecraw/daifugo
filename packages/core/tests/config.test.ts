import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUSE_RULES,
  HOUSE_RULE_KEYS,
  mergeHouseRules,
  type HouseRulesConfig,
} from "../src/config.js";

describe("house rule config", () => {
  it("defaults every rule to on", () => {
    expect(HOUSE_RULE_KEYS).toHaveLength(9);
    for (const key of HOUSE_RULE_KEYS) {
      expect(DEFAULT_HOUSE_RULES[key]).toBe(true);
    }
  });

  it("merges a partial without mutating the base", () => {
    const base = DEFAULT_HOUSE_RULES;
    const merged = mergeHouseRules(base, { shibari: false, eightGiri: false });

    expect(merged.shibari).toBe(false);
    expect(merged.eightGiri).toBe(false);
    expect(merged.kakumei).toBe(true);
    expect(base.shibari).toBe(true);
    expect(merged).not.toBe(base);
  });

  it("ignores undefined values in the partial", () => {
    const merged = mergeHouseRules(DEFAULT_HOUSE_RULES, { fiveSkip: undefined });
    expect(merged.fiveSkip).toBe(true);
  });

  it("ignores keys that are not house rules", () => {
    const dirty = { sevenPass: false, dropTable: true } as Partial<HouseRulesConfig>;
    const merged = mergeHouseRules(DEFAULT_HOUSE_RULES, dirty);

    expect(merged.sevenPass).toBe(false);
    expect(Object.keys(merged).sort()).toEqual([...HOUSE_RULE_KEYS].sort());
  });

  it("ignores non-boolean values", () => {
    const dirty = { kakumei: "yes" } as unknown as Partial<HouseRulesConfig>;
    expect(mergeHouseRules(DEFAULT_HOUSE_RULES, dirty).kakumei).toBe(true);
  });
});
