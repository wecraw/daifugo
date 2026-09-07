/**
 * English copy rendering (§11), with one small preference for role terminology.
 *
 * Every user-visible string in the client resolves through a key here — the
 * copy is typed `CopyBundle`, so a missing key fails `tsc` rather than rendering
 * raw at runtime.
 *
 * Everything is English. The main-menu toggle only chooses between descriptive
 * English role names and their romanized Daifugo equivalents.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import englishCopy from "./en.json";
import { isTerminology, type CopyBundle, type I18nKey, type Terminology } from "./keys";
import { TERMINOLOGY_STORAGE_KEY, readStored, writeStored } from "../storage";

export * from "./keys";

/** `resolveJsonModule` types the JSON as its literal shape; this is the check. */
export const COPY = englishCopy satisfies CopyBundle;

/** The complete set of text that the Daifugo naming choice changes. */
export const TERMINOLOGY_OVERRIDES = {
  "ui.app.title": "Daifugo",
  "ui.orientation.rotateBody": "Daifugo is played in landscape.",
  "role.DAI_FUGO": "Daifugo",
  "role.FUGO": "Fugo",
  "role.HEIMIN": "Heimin",
  "role.HINMIN": "Hinmin",
  "role.DAI_HINMIN": "Daihinmin",
  "history.miyakoOchi": "{player} won from Daihinmin — {target} falls to last with {count} card(s)",
} as const satisfies Partial<CopyBundle>;

export { TERMINOLOGY_STORAGE_KEY };

export type TranslateParams = Record<string, string | number>;

export type Translate = (key: I18nKey, params?: TranslateParams) => string;

/**
 * Substitute `{name}` placeholders. A param the bundle does not mention is
 * ignored, and a placeholder with no param is left in place rather than blanked,
 * so a missing param is visible instead of silently swallowed.
 */
export function interpolate(template: string, params: TranslateParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function translate(
  terminology: Terminology,
  key: I18nKey,
  params?: TranslateParams,
): string {
  const overrides: Partial<CopyBundle> = TERMINOLOGY_OVERRIDES;
  const template =
    terminology === "daifugo" ? (overrides[key] ?? COPY[key]) : COPY[key];
  return interpolate(template, params);
}

function readStoredTerminology(): Terminology {
  const stored = readStored(TERMINOLOGY_STORAGE_KEY);
  return isTerminology(stored) ? stored : "daifugo";
}

interface CopyContextValue {
  terminology: Terminology;
  setTerminology: (terminology: Terminology) => void;
  t: Translate;
}

const CopyContext = createContext<CopyContextValue | null>(null);

export function CopyProvider({
  children,
  initialTerminology,
}: {
  children: ReactNode;
  initialTerminology?: Terminology;
}) {
  const [terminology, setTerminology] = useState<Terminology>(
    () => initialTerminology ?? readStoredTerminology(),
  );

  useEffect(() => {
    // Persistence is a convenience; the toggle still works without it.
    writeStored(TERMINOLOGY_STORAGE_KEY, terminology);
    const documentRef = globalThis.document;
    if (documentRef !== undefined) {
      documentRef.documentElement.setAttribute("lang", "en");
      documentRef.title = translate(terminology, "ui.app.title");
    }
  }, [terminology]);

  const t: Translate = (key, params) => translate(terminology, key, params);
  const value: CopyContextValue = { terminology, setTerminology, t };

  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>;
}

export function useCopy(): CopyContextValue {
  const value = useContext(CopyContext);
  if (value === null) throw new Error("useCopy must be used inside a CopyProvider");
  return value;
}

/** Sugar for the common case: `const t = useTranslate()`. */
export function useTranslate(): Translate {
  return useCopy().t;
}
