/**
 * Switches role names only. The interface remains English in either position.
 */
import { TERMINOLOGIES, useCopy, type Terminology } from "../i18n/index";

const OPTION_KEY = {
  grandMillionaire: "ui.terminology.grandMillionaire",
  daifugo: "ui.terminology.daifugo",
} as const;

export function TerminologyToggle() {
  const { terminology, setTerminology, t } = useCopy();

  return (
    <div className="terminology-toggle" role="group" aria-label={t("ui.terminology.label")}>
      {TERMINOLOGIES.map((option: Terminology) => (
        <button
          key={option}
          type="button"
          className="terminology-toggle__option"
          aria-pressed={option === terminology}
          onClick={() => setTerminology(option)}
        >
          {t(OPTION_KEY[option])}
        </button>
      ))}
    </div>
  );
}
