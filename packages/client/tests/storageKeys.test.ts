/**
 * `MIRRORED_KEYS` covers every key the client persists (`src/storage.ts`).
 *
 * The native mirror only protects the keys that list names, and a key added
 * elsewhere and forgotten here fails in the one place nobody tests by hand — a
 * phone whose web view data iOS has evicted, where the seat is simply gone
 * (§8.1). Scanning the sources for `daifugo.*` literals is the same trick
 * `noBareStrings.test.ts` uses, and for the same reason: the mistake is an
 * omission, so the test has to go looking rather than be told.
 *
 * @vitest-environment node
 *
 * Reading the sources off disk needs `import.meta.url` to be a `file:` URL,
 * which it is only outside jsdom — see the same note in `noBareStrings.test.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIRRORED_KEYS } from "../src/storage";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

/** Every `"daifugo.something"` literal the client stores under. */
function persistedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sources(SRC)) {
    for (const [, key] of readFileSync(file, "utf8").matchAll(/"(daifugo\.[A-Za-z]+)"/g)) {
      keys.add(key);
    }
  }
  return keys;
}

describe("the native storage mirror", () => {
  it("covers every key the client persists", () => {
    const mirrored = new Set<string>(MIRRORED_KEYS);
    for (const key of persistedKeys()) {
      expect(mirrored, `${key} is persisted but not in MIRRORED_KEYS`).toContain(key);
    }
  });

  it("names only keys that something in the sources stores", () => {
    const persisted = persistedKeys();
    for (const key of MIRRORED_KEYS) {
      expect(persisted, `${key} is mirrored but nothing stores it`).toContain(key);
    }
  });
});
