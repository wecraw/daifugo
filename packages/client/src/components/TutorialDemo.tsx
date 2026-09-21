/**
 * Small auto-playing demos for the tutorial's basics (§5). Each is a looped CSS
 * animation over real `CardFace`s — a card (or matching set) led onto the pile, a
 * higher play beating it, a pass sweeping the pile — so a reader sees the
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

/** Which mechanic a demo stage plays out. */
export type DemoKind = "lead" | "beat" | "pass";

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
}: {
  kind: DemoKind;
  label: string;
  /** The cards that move: the led/passed play, or the play that does the beating. */
  cards: readonly Card[];
  /** Beat only: the play sitting on the pile that `cards` lands on top of. */
  under?: readonly Card[];
  /** Pass only: the localized word on the pass pill (`ui.action.pass`). */
  passLabel?: string;
}) {
  return (
    <div className="tutorial-demo" data-demo={kind} role="img" aria-label={label}>
      <div className="tutorial-demo__stage" aria-hidden="true">
        {kind === "lead" && <Play cards={cards} className="tutorial-demo__card--lead" />}

        {kind === "beat" && (
          <>
            <Play cards={under ?? []} className="tutorial-demo__card--under" />
            <Play cards={cards} className="tutorial-demo__card--over" />
          </>
        )}

        {kind === "pass" && (
          <>
            <Play cards={cards} className="tutorial-demo__card--sweep" />
            <span className="tutorial-demo__pass">{passLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
