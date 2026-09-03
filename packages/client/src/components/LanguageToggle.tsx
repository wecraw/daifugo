/**
 * The language toggle of §0 and §11: main-menu only, persisted to localStorage by
 * the provider, and never sent to the server — history and errors travel as keys.
 */
import { LANGUAGES, useI18n, type Language } from "../i18n/index";

const OPTION_KEY = { en: "ui.language.en", ja: "ui.language.ja" } as const;

export function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="language-toggle" role="group" aria-label={t("ui.language.label")}>
      {LANGUAGES.map((option: Language) => (
        <button
          key={option}
          type="button"
          className="language-toggle__option"
          aria-pressed={option === language}
          onClick={() => setLanguage(option)}
        >
          {t(OPTION_KEY[option])}
        </button>
      ))}
    </div>
  );
}
