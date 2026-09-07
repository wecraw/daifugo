/**
 * Switches role names only. The interface remains English in either position.
 *
 * The control *is* the accent rule under the wordmark: the bar slides to the
 * far side and the inactive naming fades in as a small label beside it, so the
 * title and the rule read as one object rather than a title plus a settings row.
 *
 * The slide distance is the rendered width of the left label, which only the
 * browser knows, so it is measured and handed to CSS as `--terminology-shift`.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useCopy } from "../i18n/index";

const OPTION_KEY = {
  grandMillionaire: "ui.terminology.grandMillionaire",
  daifugo: "ui.terminology.daifugo",
} as const;

export function TerminologyToggle() {
  const { terminology, setTerminology, t } = useCopy();
  const leftRef = useRef<HTMLSpanElement>(null);
  const [leftWidth, setLeftWidth] = useState(0);

  // The label is hidden but never unmounted, so its width is measurable in
  // either position. Webfonts land after first paint, hence the second read.
  useLayoutEffect(() => {
    function measure(): void {
      const width = leftRef.current?.getBoundingClientRect().width;
      if (width) setLeftWidth(width);
    }
    measure();
    void document.fonts?.ready.then(measure);
  }, []);

  const other = terminology === "daifugo" ? "grandMillionaire" : "daifugo";

  return (
    <button
      type="button"
      className="terminology-switch"
      data-terminology={terminology}
      style={{ "--terminology-shift": `${leftWidth}px` } as CSSProperties}
      aria-label={t(OPTION_KEY[other])}
      onClick={() => setTerminology(other)}
    >
      <span
        ref={leftRef}
        className="terminology-switch__label terminology-switch__label--left"
        aria-hidden
      >
        {t(OPTION_KEY.daifugo)}
      </span>
      <span className="terminology-switch__bar" aria-hidden />
      <span className="terminology-switch__label terminology-switch__label--right" aria-hidden>
        {t(OPTION_KEY.grandMillionaire)}
      </span>
    </button>
  );
}
