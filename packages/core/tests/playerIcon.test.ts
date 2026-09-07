import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_ICON,
  PLAYER_ICONS,
  normalizePlayerIcon,
} from "../src/playerIcon.js";

describe("player icons", () => {
  it("has no duplicates in the allowlist", () => {
    expect(new Set(PLAYER_ICONS).size).toBe(PLAYER_ICONS.length);
  });

  it("defaults to the first icon in the allowlist", () => {
    expect(DEFAULT_PLAYER_ICON).toBe(PLAYER_ICONS[0]);
  });

  it("passes every allowlisted icon through unchanged", () => {
    for (const icon of PLAYER_ICONS) {
      expect(normalizePlayerIcon(icon)).toBe(icon);
    }
  });

  it("falls back to the default for icons outside the allowlist", () => {
    expect(normalizePlayerIcon("💀")).toBe(DEFAULT_PLAYER_ICON);
    expect(normalizePlayerIcon("")).toBe(DEFAULT_PLAYER_ICON);
  });

  it("falls back to the default for non-string values", () => {
    for (const value of [undefined, null, 0, 1, {}, [], PLAYER_ICONS]) {
      expect(normalizePlayerIcon(value)).toBe(DEFAULT_PLAYER_ICON);
    }
  });
});
