/**
 * The how-to-play tutorial: a main-menu popup with three paged cards.
 *
 * There are a lot of rules in this game (§5, §6, §4), so they are split into
 * three scannable cards rather than one wall of text — the basics of a trick,
 * the rank-triggered card powers, and what happens between rounds. Each card is
 * a term/description list so a returning player can find the one rule they
 * forgot without re-reading the rest.
 *
 * It is presentation only. Every string resolves through a `ui.tutorial.*` key
 * (§11), and the card-power rows borrow the core `rule.*` names so the tutorial
 * and the host panel (§10.11) name each rule identically. Nothing here talks to
 * the socket — it reads no game state and sends no action.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HOUSE_RULE_KEYS } from "@daifugo/core";
import { useTranslate } from "../i18n/index";

/** The three cards, in reading order. */
const PAGES = ["basics", "rules", "postgame"] as const;

/** One entry in a card's term/description list. */
function Entry({ term, children }: { term: string; children: string }) {
  return (
    <div className="tutorial__entry">
      <dt className="tutorial__term">{term}</dt>
      <dd className="tutorial__def">{children}</dd>
    </div>
  );
}

/**
 * How the trigger reads. `link` is the main menu's "How to play" text; `icon` is
 * the subtle "?" the lobby and the table hang in a top corner, where it stays out
 * of the way until someone forgets a rule.
 */
type TutorialVariant = "link" | "icon";

export function Tutorial({
  variant = "link",
  className,
}: {
  variant?: TutorialVariant;
  className?: string;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  // Escape closes it, the way the host panel and every other dialog do (§10.11).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const total = PAGES.length;
  const isFirst = page === 0;
  const isLast = page === total - 1;
  const current = PAGES[page] ?? PAGES[0];

  function openTutorial(): void {
    setPage(0);
    setOpen(true);
  }

  const triggerClassName = [
    variant === "icon" ? "tutorial__icon" : "main-menu__link tutorial__trigger",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        aria-label={variant === "icon" ? t("ui.tutorial.open") : undefined}
        onClick={openTutorial}
      >
        {/* The icon's accessible name is its aria-label; "?" is decorative. */}
        {variant === "icon" ? "?" : t("ui.tutorial.open")}
      </button>

      {open &&
        // Fixed backdrop over the whole page, closed by a click that lands on it
        // and not the dialog — the same gesture as Escape (§10.11). Portalled to
        // the body so the menu's entry transform never anchors the fixed frame.
        createPortal(
          <div
            className="tutorial__backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              className="tutorial__dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("ui.tutorial.title")}
            >
              <header className="tutorial__header">
                <h2 className="tutorial__heading">{t(`ui.tutorial.${current}.title`)}</h2>
                <button
                  type="button"
                  className="tutorial__close"
                  aria-label={t("ui.tutorial.close")}
                  autoFocus
                  onClick={() => setOpen(false)}
                >
                  {/* Decorative: the accessible name is the label above. */}
                  {"×"}
                </button>
              </header>

              <div className="tutorial__body">
                {current === "basics" && (
                  <dl className="tutorial__entries">
                    <Entry term={t("ui.tutorial.basics.goalLabel")}>
                      {t("ui.tutorial.basics.goal")}
                    </Entry>
                    <Entry term={t("ui.tutorial.basics.turnsLabel")}>
                      {t("ui.tutorial.basics.turns")}
                    </Entry>
                    <Entry term={t("ui.tutorial.basics.leadLabel")}>
                      {t("ui.tutorial.basics.lead")}
                    </Entry>
                    <Entry term={t("ui.tutorial.basics.followLabel")}>
                      {t("ui.tutorial.basics.follow")}
                    </Entry>
                    <Entry term={t("ui.tutorial.basics.passLabel")}>
                      {t("ui.tutorial.basics.pass")}
                    </Entry>
                    <Entry term={t("ui.tutorial.basics.jokerLabel")}>
                      {t("ui.tutorial.basics.joker")}
                    </Entry>
                  </dl>
                )}

                {current === "rules" && (
                  <>
                    <p className="tutorial__intro">{t("ui.tutorial.rules.intro")}</p>
                    <dl className="tutorial__entries">
                      {HOUSE_RULE_KEYS.map((key) => (
                        <Entry key={key} term={t(`rule.${key}`)}>
                          {t(`ui.tutorial.rules.${key}`)}
                        </Entry>
                      ))}
                    </dl>
                  </>
                )}

                {current === "postgame" && (
                  <dl className="tutorial__entries">
                    <Entry term={t("ui.tutorial.postgame.ranksLabel")}>
                      {t("ui.tutorial.postgame.ranks")}
                    </Entry>
                    <Entry term={t("ui.tutorial.postgame.scoringLabel")}>
                      {t("ui.tutorial.postgame.scoring")}
                    </Entry>
                    <Entry term={t("ui.tutorial.postgame.exchangeLabel")}>
                      {t("ui.tutorial.postgame.exchange")}
                    </Entry>
                    <Entry term={t("ui.tutorial.postgame.miyakoOchiLabel")}>
                      {t("ui.tutorial.postgame.miyakoOchi")}
                    </Entry>
                  </dl>
                )}
              </div>

              <footer className="tutorial__footer">
                <div
                  className="tutorial__dots"
                  role="group"
                  aria-label={t("ui.tutorial.progress", { current: page + 1, total })}
                >
                  {PAGES.map((name, index) => (
                    <span
                      key={name}
                      className="tutorial__dot"
                      data-active={index === page ? "" : undefined}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <div className="tutorial__nav">
                  <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    {t("ui.tutorial.back")}
                  </button>
                  <button
                    type="button"
                    className="tutorial__primary"
                    onClick={() => {
                      if (isLast) setOpen(false);
                      else setPage((p) => Math.min(total - 1, p + 1));
                    }}
                  >
                    {isLast ? t("ui.tutorial.done") : t("ui.tutorial.next")}
                  </button>
                </div>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
