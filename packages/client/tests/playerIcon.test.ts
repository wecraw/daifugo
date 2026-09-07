import { PLAYER_ICONS } from "@daifugo/core";
import { describe, expect, it, vi } from "vitest";
import {
  readOrCreateStoredPlayerIcon,
  writeStoredPlayerIcon,
} from "../src/playerIcon";

describe("player icon storage", () => {
  it("randomly assigns and persists an icon when none has been chosen", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999);

    const icon = readOrCreateStoredPlayerIcon();

    expect(icon).toBe(PLAYER_ICONS.at(-1));
    expect(localStorage.getItem("daifugo.playerIcon")).toBe(icon);
    random.mockRestore();
  });

  it("keeps an existing icon instead of assigning another one", () => {
    writeStoredPlayerIcon("🦊");
    const random = vi.spyOn(Math, "random");

    expect(readOrCreateStoredPlayerIcon()).toBe("🦊");
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
