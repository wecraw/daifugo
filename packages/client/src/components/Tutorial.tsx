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
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HOUSE_RULE_KEYS, type Card, type HouseRuleKey, type Rank, type Suit } from "@daifugo/core";
import { useTranslate } from "../i18n/index";
import type { I18nKey } from "../i18n/keys";
import { CardFace } from "./CardFace";
import { TutorialDemo } from "./TutorialDemo";

/**
 * The pages, in reading order. One idea per page so nothing scrolls on a phone
 * (§10.1): the trick basics split a mechanic to a page (§5), the ten card powers
 * (§6) split across two, and the between-round rules (§4, §9) across two more.
 */
const PAGES = [
  "basics",
  "lead",
  "beat",
  "pass",
  "joker",
  "powersIntro",
  "powersA",
  "powersB",
  "powersC",
  "postgameA",
  "postgameB",
] as const;

type PageId = (typeof PAGES)[number];

/** Each page's heading. The single-mechanic pages reuse their basics label. */
const PAGE_TITLE: Readonly<Record<PageId, I18nKey>> = {
  basics: "ui.tutorial.basics.title",
  lead: "ui.tutorial.basics.leadLabel",
  beat: "ui.tutorial.basics.followLabel",
  pass: "ui.tutorial.basics.passLabel",
  joker: "ui.tutorial.basics.jokerLabel",
  powersIntro: "ui.tutorial.rules.title",
  powersA: "ui.tutorial.rules.title",
  powersB: "ui.tutorial.rules.title",
  powersC: "ui.tutorial.rules.title",
  postgameA: "ui.tutorial.postgame.title",
  postgameB: "ui.tutorial.postgame.title",
};

/**
 * The card powers (§6) split across pages, in `HOUSE_RULE_KEYS` order. Four to a
 * page keeps even a short landscape phone from scrolling (§10.1); the slice each
 * powers page shows is its position among them times this.
 */
const POWERS_PER_PAGE = 4;
const POWERS_PAGES = ["powersA", "powersB", "powersC"] as const;

/** A natural card built for illustration only — never dealt, never played. */
function card(suit: Suit, rank: Rank): Card {
  return { id: `${suit}-${rank}`, suit, rank, isJoker: false };
}

/** The wildcard, shown pure (no binding) so it reads as the Joker itself. */
const JOKER_CARD: Card = { id: "JKR-1", suit: null, rank: null, isJoker: true };

/**
 * The plays the lead and beat demos animate. Each mechanic shows a single and a
 * matching set (§5.3) side by side, so the reader sees that a play is one card
 * *or* a set of the same rank. The beat pair (a pair of 9s over a pair of 5s)
 * mirrors the single (a Jack over a 7): a higher play of the same size wins.
 */
const LEAD_SINGLE: readonly Card[] = [card("H", 9)];
const LEAD_SET: readonly Card[] = [card("S", 12), card("H", 12), card("D", 12), card("C", 12)];
const BEAT_UNDER_SINGLE: readonly Card[] = [card("D", 7)];
const BEAT_OVER_SINGLE: readonly Card[] = [card("S", 11)];
const BEAT_UNDER_PAIR: readonly Card[] = [card("H", 5), card("S", 5)];
const BEAT_OVER_PAIR: readonly Card[] = [card("C", 9), card("D", 9)];
// The pass page shows the two ways a turn is passed (§7.5, §10.7). `PASS_HAND` is
// a weak hand that beats nothing, so it is passed for you; `PASS_PILE` is a single
// card you face and could beat, but choose to pass on instead.
const PASS_HAND: readonly Card[] = [card("C", 4), card("D", 6), card("S", 8)];
const PASS_PILE: readonly Card[] = [card("H", 9)];

/**
 * The card(s) that stand in for each power's name, so the tutorial shows the
 * trigger rather than spelling it out. The seven single-card powers show the one
 * rank that fires them; the three no single card can name show a representative
 * shape instead — four of a kind for a revolution, two same-suit cards for a
 * suit lock, a climbing run for a kaidan. Suit is irrelevant to every rank
 * trigger, so the pips here are arbitrary — except Spade-3-beats-joker, which is
 * the real 3♠ and nothing else (§5.4).
 */
const RULE_CARDS: Readonly<Record<HouseRuleKey, readonly Card[]>> = {
  spade3BeatsJoker: [card("S", 3)],
  fiveSkip: [card("D", 5)],
  sevenPass: [card("D", 7)],
  eightGiri: [card("D", 8)],
  nineGiriMinPair: [card("D", 9), card("C", 9)],
  tenDiscard: [card("D", 10)],
  elevenBack: [card("D", 11)],
  kakumei: [card("S", 13), card("H", 13), card("D", 13), card("C", 13)],
  shibari: [card("S", 6), card("S", 10)],
  kaidan: [card("H", 5), card("H", 6), card("H", 7)],
};

/**
 * One entry in a card's term/description list. The term is either a text label
 * or a picture of the card(s) it names, in which case `termLabel` carries the
 * name for assistive tech since the pips are otherwise unlabelled.
 */
function Entry({
  term,
  cards,
  termLabel,
  children,
}: {
  term?: string;
  cards?: readonly Card[];
  termLabel?: string;
  children: string;
}) {
  return (
    <div className="tutorial__entry">
      {cards ? (
        <dt className="tutorial__term tutorial__cards" aria-label={termLabel}>
          {cards.map((c) => (
            <CardFace key={c.id} card={c} />
          ))}
        </dt>
      ) : (
        <dt className="tutorial__term">{term}</dt>
      )}
      <dd className="tutorial__def">{children}</dd>
    </div>
  );
}

/**
 * A single-mechanic page (§5): the visual above one line of prose, centered with
 * the whole page to itself so nothing scrolls. The visual is a demo, a pair of
 * demos split by an "or", or a still hero card — composed by the caller.
 */
function MechanicPage({ visual, children }: { visual: ReactNode; children: string }) {
  return (
    <div className="tutorial__mechanic">
      {visual}
      <p className="tutorial__def">{children}</p>
    </div>
  );
}

/**
 * Two demos of the same mechanic side by side — a single and a matching set —
 * with an "or" between, so both loop at once and no one waits on a frame (§5.3).
 */
function DemoSplit({ or, children }: { or: string; children: [ReactNode, ReactNode] }) {
  return (
    <div className="tutorial__demo-split">
      {children[0]}
      <span className="tutorial__demo-or" aria-hidden="true">
        {or}
      </span>
      {children[1]}
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
                <h2 className="tutorial__heading">{t(PAGE_TITLE[current])}</h2>
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

              <div className="tutorial__body" data-page={current}>
                {current === "basics" && (
                  <dl className="tutorial__entries">
                    <Entry term={t("ui.tutorial.basics.goalLabel")}>
                      {t("ui.tutorial.basics.goal")}
                    </Entry>
                    <Entry term={t("ui.tutorial.basics.turnsLabel")}>
                      {t("ui.tutorial.basics.turns")}
                    </Entry>
                  </dl>
                )}

                {current === "lead" && (
                  <MechanicPage
                    visual={
                      <DemoSplit or={t("ui.tutorial.or")}>
                        {[
                          <TutorialDemo
                            key="single"
                            kind="lead"
                            cards={LEAD_SINGLE}
                            label={t("ui.tutorial.basics.leadLabel")}
                          />,
                          <TutorialDemo
                            key="set"
                            kind="lead"
                            cards={LEAD_SET}
                            grow
                            label={t("ui.tutorial.basics.leadLabel")}
                          />,
                        ]}
                      </DemoSplit>
                    }
                  >
                    {t("ui.tutorial.basics.lead")}
                  </MechanicPage>
                )}

                {current === "beat" && (
                  <MechanicPage
                    visual={
                      <DemoSplit or={t("ui.tutorial.or")}>
                        {[
                          <TutorialDemo
                            key="single"
                            kind="beat"
                            under={BEAT_UNDER_SINGLE}
                            cards={BEAT_OVER_SINGLE}
                            label={t("ui.tutorial.basics.followLabel")}
                          />,
                          <TutorialDemo
                            key="set"
                            kind="beat"
                            under={BEAT_UNDER_PAIR}
                            cards={BEAT_OVER_PAIR}
                            label={t("ui.tutorial.basics.followLabel")}
                          />,
                        ]}
                      </DemoSplit>
                    }
                  >
                    {t("ui.tutorial.basics.follow")}
                  </MechanicPage>
                )}

                {current === "pass" && (
                  <MechanicPage
                    visual={
                      <DemoSplit or={t("ui.tutorial.or")}>
                        {[
                          <figure key="auto" className="tutorial__demo-figure">
                            <TutorialDemo
                              kind="passAuto"
                              cards={PASS_HAND}
                              autoPassLabel={t("ui.action.autoPass")}
                              label={t("ui.tutorial.basics.passAutoLabel")}
                            />
                            <figcaption className="tutorial__demo-caption" aria-hidden="true">
                              {t("ui.tutorial.basics.passAutoLabel")}
                            </figcaption>
                          </figure>,
                          <figure key="choose" className="tutorial__demo-figure">
                            <TutorialDemo
                              kind="passChoose"
                              cards={PASS_PILE}
                              passLabel={t("ui.action.pass")}
                              label={t("ui.tutorial.basics.passChooseLabel")}
                            />
                            <figcaption className="tutorial__demo-caption" aria-hidden="true">
                              {t("ui.tutorial.basics.passChooseLabel")}
                            </figcaption>
                          </figure>,
                        ]}
                      </DemoSplit>
                    }
                  >
                    {t("ui.tutorial.basics.pass")}
                  </MechanicPage>
                )}

                {current === "joker" && (
                  <MechanicPage
                    visual={
                      <div
                        className="tutorial__cards tutorial__cards--hero"
                        role="img"
                        aria-label={t("ui.tutorial.basics.jokerLabel")}
                      >
                        <CardFace card={JOKER_CARD} />
                      </div>
                    }
                  >
                    {t("ui.tutorial.basics.joker")}
                  </MechanicPage>
                )}

                {current === "powersIntro" && (
                  <div className="tutorial__mechanic">
                    <p className="tutorial__def">{t("ui.tutorial.rules.intro")}</p>
                  </div>
                )}

                {POWERS_PAGES.includes(current as (typeof POWERS_PAGES)[number]) &&
                  (() => {
                    const start =
                      POWERS_PAGES.indexOf(current as (typeof POWERS_PAGES)[number]) *
                      POWERS_PER_PAGE;
                    return (
                      <dl className="tutorial__entries">
                        {HOUSE_RULE_KEYS.slice(start, start + POWERS_PER_PAGE).map((key) => (
                          <Entry key={key} cards={RULE_CARDS[key]} termLabel={t(`rule.${key}`)}>
                            {t(`ui.tutorial.rules.${key}`)}
                          </Entry>
                        ))}
                      </dl>
                    );
                  })()}

                {current === "postgameA" && (
                  <dl className="tutorial__entries">
                    <Entry term={t("ui.tutorial.postgame.ranksLabel")}>
                      {t("ui.tutorial.postgame.ranks")}
                    </Entry>
                    <Entry term={t("ui.tutorial.postgame.scoringLabel")}>
                      {t("ui.tutorial.postgame.scoring")}
                    </Entry>
                  </dl>
                )}

                {current === "postgameB" && (
                  <dl className="tutorial__entries">
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
