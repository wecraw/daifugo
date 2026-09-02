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

beforeEach(() => {
  localStorage.clear();
  setOrientation(false);
});

afterEach(() => {
  cleanup();
});
