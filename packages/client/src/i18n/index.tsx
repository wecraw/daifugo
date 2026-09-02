/**
 * The i18n runtime (§11): the two bundles, the language preference, and `t`.
 *
 * Every user-visible string in the client resolves through a key here — the
 * bundles are typed `I18nBundle`, so a key that exists on one side and not the
 * other fails `tsc` rather than rendering raw at runtime.
 *
 * The language is client state only. It is chosen on the main menu, persisted to
 * localStorage, and never reaches the server: history entries arrive as keys with
 * params (§8.5) and are rendered here, so two players can read the same table in
 * different languages.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import enBundle from "./en.json";
import jaBundle from "./ja.json";
import { isLanguage, type I18nBundle, type I18nKey, type Language } from "./keys";

export * from "./keys";

/** `resolveJsonModule` types these as their literal shape; this is the check. */
export const BUNDLES: Record<Language, I18nBundle> = {
  en: enBundle satisfies I18nBundle,
  ja: jaBundle satisfies I18nBundle,
};

export const LANGUAGE_STORAGE_KEY = "daifugo.language";

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

export function translate(language: Language, key: I18nKey, params?: TranslateParams): string {
  return interpolate(BUNDLES[language][key], params);
}

/** The preferred language: a stored choice, else the browser's, else English. */
export function detectLanguage(): Language {
  const stored = readStoredLanguage();
  if (stored !== null) return stored;
  const navigatorLanguage = globalThis.navigator?.language ?? "";
  return navigatorLanguage.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function readStoredLanguage(): Language | null {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    // Private-mode localStorage throws on access; the default is fine.
    return null;
  }
}

export interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguage] = useState<Language>(() => initialLanguage ?? detectLanguage());

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Persistence is a convenience; the toggle still works without it.
    }
    const documentRef = globalThis.document;
    if (documentRef !== undefined) {
      documentRef.documentElement.setAttribute("lang", language);
      // The `<title>` in index.html is the pre-mount placeholder; the tab title
      // is a user-visible string like any other and resolves through its key.
      documentRef.title = translate(language, "ui.app.title");
    }
  }, [language]);

  const t = useCallback<Translate>((key, params) => translate(language, key, params), [language]);

  const value = useMemo<I18nContextValue>(() => ({ language, setLanguage, t }), [language, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n must be used inside an I18nProvider");
  return value;
}

/** Sugar for the common case: `const t = useTranslate()`. */
export function useTranslate(): Translate {
  return useI18n().t;
}
