/**
 * The persistence layer the iOS app leans on (`src/storage.ts`).
 *
 * What these assert is that the web behaviour is untouched — `localStorage`,
 * synchronously, failing quiet — because everything from the remembered name to
 * the resume token (§8.1) reads through this module now.
 *
 * The other half — that `MIRRORED_KEYS` actually covers every key the client
 * persists — is `storageKeys.test.ts`, which reads the sources off disk and so
 * needs the node environment.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStored, writeStored } from "../src/storage";

describe("storage (web)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a value through localStorage", () => {
    writeStored("daifugo.test", "value");
    expect(localStorage.getItem("daifugo.test")).toBe("value");
    expect(readStored("daifugo.test")).toBe("value");
  });

  it("reads a missing key as null", () => {
    expect(readStored("daifugo.absent")).toBeNull();
  });

  it("removes the key on a null write", () => {
    writeStored("daifugo.test", "value");
    writeStored("daifugo.test", null);
    expect(localStorage.getItem("daifugo.test")).toBeNull();
    expect(readStored("daifugo.test")).toBeNull();
  });

  it("fails quiet when storage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(() => writeStored("daifugo.test", "value")).not.toThrow();
      expect(readStored("daifugo.test")).toBeNull();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
