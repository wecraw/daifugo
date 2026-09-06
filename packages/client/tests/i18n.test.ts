/**
 * The copy contract of §11: English carries exactly the composed key set,
 * `ui.*` stays client-side, and the tiny terminology override stays narrow.
 */
import { describe, expect, it } from "vitest";
import { CORE_I18N_KEYS, HISTORY_KEYS } from "@daifugo/core";
import {
  COPY,
  I18N_KEYS,
  TERMINOLOGY_OVERRIDES,
  UI_I18N_KEYS,
  interpolate,
  translate,
} from "../src/i18n/index";

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

describe("display copy", () => {
  it("compose core keys with the client's ui.* namespace", () => {
    expect(I18N_KEYS).toEqual([...CORE_I18N_KEYS, ...UI_I18N_KEYS]);
    expect(new Set(I18N_KEYS).size).toBe(I18N_KEYS.length);
  });

  it("keeps ui.* out of core", () => {
    expect(CORE_I18N_KEYS.some((key) => key.startsWith("ui."))).toBe(false);
    expect(UI_I18N_KEYS.every((key) => key.startsWith("ui."))).toBe(true);
  });

  it("carries every key and no others", () => {
    expect(Object.keys(COPY).sort()).toEqual([...I18N_KEYS].sort());
  });

  it("has no empty copy", () => {
    for (const [key, value] of Object.entries(COPY)) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("keeps error.* free of placeholders, because none ever arrive (§8.4)", () => {
    // `gameError` is `{ code }` and never params, so an `error.*` string that
    // interpolates one renders the placeholder raw in the banner. The specific
    // phrasing a disabled control wants belongs in `ui.*`, where the client
    // holds the values to fill it with (§10.6, §11).
    for (const [key, value] of Object.entries(COPY)) {
      if (!key.startsWith("error.")) continue;
      expect(placeholders(value), key).toEqual([]);
    }
  });

  it("terminology overrides use the same params as the base copy", () => {
    for (const [key, value] of Object.entries(TERMINOLOGY_OVERRIDES)) {
      expect(placeholders(value), key).toEqual(placeholders(COPY[key as keyof typeof COPY]));
    }
  });

  it("gives every *Redacted history key a {count} and no card ids", () => {
    for (const key of HISTORY_KEYS) {
      if (!key.endsWith("Redacted")) continue;
      expect(placeholders(COPY[key]), key).toContain("count");
      expect(placeholders(COPY[key]), key).not.toContain("cards");
    }
  });
});

describe("translate", () => {
  it("substitutes params", () => {
    expect(translate("grandMillionaire", "history.roundStarted", { round: 3 })).toBe(
      "Round 3 started",
    );
    expect(translate("daifugo", "history.roundStarted", { round: 3 })).toBe("Round 3 started");
  });

  it("leaves an unfilled placeholder visible rather than blanking it", () => {
    expect(interpolate("{player} passed", {})).toBe("{player} passed");
  });

  it("switches only the game and role terminology", () => {
    expect(translate("grandMillionaire", "ui.app.title")).toBe("Grand Millionaire");
    expect(translate("daifugo", "ui.app.title")).toBe("Daifugo");
    expect(translate("grandMillionaire", "ui.orientation.rotateBody")).toContain(
      "Grand Millionaire",
    );
    expect(translate("daifugo", "ui.orientation.rotateBody")).toContain("Daifugo");
    expect(translate("grandMillionaire", "role.DAI_FUGO")).toBe("Grand Millionaire");
    expect(translate("daifugo", "role.DAI_FUGO")).toBe("Daifugo");
    expect(translate("grandMillionaire", "role.DAI_HINMIN")).toBe("Grand Pauper");
    expect(translate("daifugo", "role.DAI_HINMIN")).toBe("Daihinmin");

    const terminologyKeys = new Set(Object.keys(TERMINOLOGY_OVERRIDES));
    for (const key of I18N_KEYS) {
      if (terminologyKeys.has(key)) continue;
      expect(translate("daifugo", key), key).toBe(translate("grandMillionaire", key));
    }
  });

  it("contains English UI copy and no Japanese characters", () => {
    for (const [key, value] of Object.entries({ ...COPY, ...TERMINOLOGY_OVERRIDES })) {
      expect(value, key).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
    }
  });
});
