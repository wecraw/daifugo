import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * jsdom has no `matchMedia`. Landscape is the default so the orientation gate
 * lets the app through; the portrait test overrides it.
 */
export function setOrientation(portrait: boolean): void {
  Object.defineProperty(globalThis, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("portrait") ? portrait : !portrait,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// The source-scanning suite runs in the node environment (it reads files rather
// than rendering them), where there is no DOM to reset.
const hasDom = typeof document !== "undefined";

beforeEach(() => {
  if (!hasDom) return;
  localStorage.clear();
  setOrientation(false);
});

afterEach(() => {
  if (!hasDom) return;
  cleanup();
});
