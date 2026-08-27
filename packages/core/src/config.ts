/** House rule configuration and defaults (§6). */
import type { HouseRuleKey, HouseRulesConfig } from "./types.js";

/** Every house rule key, in the order they appear in §6. */
export const HOUSE_RULE_KEYS = [
  "spade3BeatsJoker",
  "fiveSkip",
  "sevenPass",
  "eightGiri",
  "nineGiriMinPair",
  "tenDiscard",
  "elevenBack",
  "kakumei",
  "shibari",
] as const satisfies readonly HouseRuleKey[];

/** All nine rules on. The lobby toggles individual rules off from here. */
export const DEFAULT_HOUSE_RULES: Readonly<HouseRulesConfig> = Object.freeze({
  spade3BeatsJoker: true,
  fiveSkip: true,
  sevenPass: true,
  eightGiri: true,
  nineGiriMinPair: true,
  tenDiscard: true,
  elevenBack: true,
  kakumei: true,
  shibari: true,
});

const HOUSE_RULE_KEY_SET: ReadonlySet<string> = new Set<string>(HOUSE_RULE_KEYS);

export function isHouseRuleKey(key: string): key is HouseRuleKey {
  return HOUSE_RULE_KEY_SET.has(key);
}

/**
 * Merge an `UPDATE_RULES` partial onto an existing config.
 *
 * The partial arrives over the wire, so unknown keys and non-boolean values are
 * dropped rather than trusted. Returns a new object; `base` is never mutated.
 */
export function mergeHouseRules(
  base: Readonly<HouseRulesConfig>,
  patch: Partial<HouseRulesConfig>,
): HouseRulesConfig {
  const merged: HouseRulesConfig = { ...base };
  for (const key of HOUSE_RULE_KEYS) {
    const value = patch[key];
    if (typeof value === "boolean") {
      merged[key] = value;
    }
  }
  return merged;
}
