/**
 * Small auto-playing demos for the tutorial's basics (§5). Each is a looped CSS
 * animation over real `CardFace`s — a card (or matching set) led onto the pile, a
 * higher play beating it, and the two ways a turn is passed — so a reader sees the
 * mechanic move rather than reading a paragraph about it.
 *
 * Presentation only, like the rest of the tutorial: no engine, no state, no
 * socket. The cards here are illustrative literals, never dealt or played. A
 * play is a group of one or more `CardFace`s (a single or a set of matching
 * ranks, §5.3); the whole group animates as one. The choreography lives in CSS
 * keyframes keyed off `data-demo`, and every demo freezes on its meaningful
 * end-state under `prefers-reduced-motion`.
 */
import type { Card } from "@daifugo/core";
import { CardFace } from "./CardFace";

/**
 * Which mechanic a demo stage plays out. Passing has two stages, not one, because
 * it happens two ways (§7.5, §10.7): `passAuto` reproduces the real "No legal
 * play, passing" moment the game raises for you when nothing beats the pile, and
 * `passChoose` is the voluntary tap of the Pass button when you could play but
 * would rather sit the trick out.
 */
export type DemoKind = "lead" | "beat" | "passAuto" | "passChoose";

/** One play's worth of cards, overlapped into a small fanned group. */
function Play({ cards, className }: { cards: readonly Card[]; className: string }) {
  return (
    <span className={`tutorial-demo__card ${className}`}>
      {cards.map((c) => (
        <CardFace key={c.id} card={c} />
      ))}
    </span>
  );
}

export function TutorialDemo({
  kind,
  label,
  cards,
  under,
  passLabel,
  autoPassLabel,
  grow = false,
}: {
  kind: DemoKind;
  label: string;
  /**
   * The cards on the stage: the led play or the play that does the beating; the
   * dimmed hand that has nothing to play (`passAuto`); the pile you face when you
   * choose to pass (`passChoose`).
   */
  cards: readonly Card[];
  /** Beat only: the play sitting on the pile that `cards` lands on top of. */
  under?: readonly Card[];
  /** passChoose only: the localized word on the Pass button (`ui.action.pass`). */
  passLabel?: string;
  /** passAuto only: the "No legal play, passing" badge text (`ui.action.autoPass`). */
  autoPassLabel?: string;
  /**
   * Lead only: reveal the cards one at a time so the set visibly builds from a
   * pair to three to four, showing a set can be any number of a rank (§5.3). The
   * still (reduced-motion) state is the full set, which reads the same at a
   * glance.
   */
  grow?: boolean;
}) {
  return (
    <div className="tutorial-demo" data-demo={kind} role="img" aria-label={label}>
      <div className="tutorial-demo__stage" aria-hidden="true">
        {kind === "lead" && (
          <Play
            cards={cards}
            className={grow ? "tutorial-demo__card--lead-set" : "tutorial-demo__card--lead"}
          />
        )}

        {kind === "beat" && (
          <>
            <Play cards={under ?? []} className="tutorial-demo__card--under" />
            <Play cards={cards} className="tutorial-demo__card--over" />
          </>
        )}

        {/* You had nothing that beats the pile: the hand stands down and the game
            raises the very badge the real table shows (§10.7), then passes for you. */}
        {kind === "passAuto" && (
          <>
            <Play cards={cards} className="tutorial-demo__card--dim" />
            <span className="tutorial-demo__autopass">{autoPassLabel}</span>
          </>
        )}

        {/* You could have played, but tap Pass to sit the trick out (§7.5). The
            pile you are facing sits up top; the Pass button presses on the loop. */}
        {kind === "passChoose" && (
          <>
            <Play cards={cards} className="tutorial-demo__card--pile" />
            <span className="tutorial-demo__pass-btn">{passLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
