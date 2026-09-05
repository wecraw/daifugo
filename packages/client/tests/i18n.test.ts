/**
 * The bundle contract of §11: both languages carry exactly the composed key set,
 * `ui.*` stays client-side, and the two agree on every placeholder.
 */
import { describe, expect, it } from "vitest";
import { CORE_I18N_KEYS, HISTORY_KEYS } from "@daifugo/core";
import en from "../src/i18n/en.json";
import ja from "../src/i18n/ja.json";
import { BUNDLES, I18N_KEYS, UI_I18N_KEYS, interpolate, translate } from "../src/i18n/index";

const bundles = { en, ja } as Record<string, Record<string, string>>;

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

describe("i18n bundles", () => {
  it("compose core keys with the client's ui.* namespace", () => {
    expect(I18N_KEYS).toEqual([...CORE_I18N_KEYS, ...UI_I18N_KEYS]);
    expect(new Set(I18N_KEYS).size).toBe(I18N_KEYS.length);
  });

  it("keeps ui.* out of core", () => {
    expect(CORE_I18N_KEYS.some((key) => key.startsWith("ui."))).toBe(false);
    expect(UI_I18N_KEYS.every((key) => key.startsWith("ui."))).toBe(true);
  });

  for (const [language, bundle] of Object.entries(bundles)) {
    it(`${language} carries every key and no others`, () => {
      expect(Object.keys(bundle).sort()).toEqual([...I18N_KEYS].sort());
    });

    it(`${language} has no empty translations`, () => {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value.trim(), key).not.toBe("");
      }
    });
  }

  it("keeps error.* free of placeholders, because none ever arrive (§8.4)", () => {
    // `gameError` is `{ code }` and never params, so an `error.*` string that
    // interpolates one renders the placeholder raw in the banner. The specific
    // phrasing a disabled control wants belongs in `ui.*`, where the client
    // holds the values to fill it with (§10.6, §11).
    for (const [language, bundle] of Object.entries(bundles)) {
      for (const [key, value] of Object.entries(bundle)) {
        if (!key.startsWith("error.")) continue;
        expect(placeholders(value), `${language} ${key}`).toEqual([]);
      }
    }
  });

  it("uses the same params in both languages", () => {
    for (const key of I18N_KEYS) {
      expect(placeholders(BUNDLES.ja[key]), key).toEqual(placeholders(BUNDLES.en[key]));
    }
  });

  it("gives every *Redacted history key a {count} and no card ids", () => {
    for (const key of HISTORY_KEYS) {
      if (!key.endsWith("Redacted")) continue;
      expect(placeholders(BUNDLES.en[key]), key).toContain("count");
      expect(placeholders(BUNDLES.en[key]), key).not.toContain("cards");
    }
  });
});

describe("translate", () => {
  it("substitutes params", () => {
    expect(translate("en", "history.roundStarted", { round: 3 })).toBe("Round 3 started");
    expect(translate("ja", "history.roundStarted", { round: 3 })).toBe("第3ラウンド開始");
  });

  it("leaves an unfilled placeholder visible rather than blanking it", () => {
    expect(interpolate("{player} passed", {})).toBe("{player} passed");
  });

  it("renders the two languages of the same key differently", () => {
    expect(translate("en", "rule.eightGiri")).toBe("Eight Cutter");
    expect(translate("ja", "rule.eightGiri")).toBe("8切り");
  });
});
