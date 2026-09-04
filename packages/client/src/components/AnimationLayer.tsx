/**
 * The animation layer: §10.9's feedback, drawn over an already-correct table.
 *
 * It is one absolutely-positioned overlay across the whole 844x390 frame, and it
 * takes **no pointer events at all** — that is what "animations never block input"
 * means in a layout where the hand row sits under the middle of the table. What
 * decides when an entry appears and disappears is `useTableAnimations`; what is
 * here is the shape each one takes and the direction it travels.
 *
 * Every element carries its own `animation-duration` as an inline style rather
 * than as a class, because the pacing is data — a skip's arcs are one per seat it
 * passed over — and a stylesheet cannot know it. The *sequencing* is not here at
 * all: an entry reaches this component only once it has started, so a
 * miyako-ochi's wait for the agari it follows (§4.5) is already spent by the time
 * anything below renders. `data-delay-ms` records what that wait was.
 *
 * The layer is `aria-hidden`: every banner here restates a line the history log
 * already carries in full (§11), and announcing the same event twice is worse
 * than announcing it once. The log is the accessible copy of all of this.
 */
import type { CSSProperties } from "react";
import { ruleKey, type PublicGameState } from "@daifugo/core";
import { GRAVEYARD_TRAVEL, travelCssVariables, travelTo } from "../animation/geometry";
import { SKIP_MS, SKIP_STAGGER_MS, type TableAnimation } from "../animation/events";
import { useTranslate, type Translate } from "../i18n/index";
import { seatEdgeOf } from "../layout/tableLayout";
import { CardFace } from "./CardFace";

/** More card backs than this in flight is a smear rather than a count. */
const MAX_TRAVELLING_CARDS = 6;

export function AnimationLayer({
  room,
  animations,
}: {
  room: PublicGameState;
  animations: readonly TableAnimation[];
}) {
  const t = useTranslate();
  if (animations.length === 0) return null;

  return (
    <div className="table-anim" style={{ pointerEvents: "none" }} aria-hidden="true">
      {animations.map((animation) => (
        <Animation key={animation.id} room={room} animation={animation} t={t} />
      ))}
    </div>
  );
}

/** The per-entry timing every animation is positioned and paced by. */
function timing(animation: TableAnimation, extra: Record<string, string> = {}): CSSProperties {
  return { animationDuration: `${animation.durationMs}ms`, ...extra } as CSSProperties;
}

function nameOf(room: PublicGameState, playerId: string): string {
  return room.players.find((seat) => seat.id === playerId)?.name ?? playerId;
}

function Animation({
  room,
  animation,
  t,
}: {
  room: PublicGameState;
  animation: TableAnimation;
  t: Translate;
}) {
  const common = {
    "data-animation": animation.kind,
    "data-delay-ms": animation.delayMs,
    "data-duration-ms": animation.durationMs,
  };

  switch (animation.kind) {
    /* 1. Trick clear sweep: the trick slides off to the discard edge (§7.4). */
    case "trickSweep":
      return (
        <div
          {...common}
          className="table-anim__sweep"
          style={timing(animation, travelCssVariables({ x: 0, y: 0 }, GRAVEYARD_TRAVEL))}
        >
          {animation.cards.slice(0, MAX_TRAVELLING_CARDS).map((card) => (
            <CardFace key={card.id} card={card} />
          ))}
        </div>
      );

    /* 2. Revolution: the banner over the hand re-sorting under it (§10.8). */
    case "revolution":
      return (
        <div {...common} className="table-anim__revolution" style={timing(animation)}>
          <strong className="table-anim__title">{t("rule.kakumei")}</strong>
          <span className="table-anim__caption">
            {animation.on ? t("ui.animation.revolutionOn") : t("ui.animation.revolutionOff")}
          </span>
        </div>
      );

    /* 3. 7-pass: the cards visibly leave for the recipient's seat (§6). */
    case "sevenPass":
      return (
        <div
          {...common}
          className="table-anim__travel"
          style={timing(
            animation,
            travelCssVariables(
              travelTo(seatEdgeOf(room, animation.player)),
              travelTo(seatEdgeOf(room, animation.target)),
            ),
          )}
        >
          <span className="table-anim__label">{t("rule.sevenPass")}</span>
          <span className="table-anim__cards">
            <CardBacks count={animation.count} />
          </span>
          <span className="table-anim__caption">{nameOf(room, animation.target)}</span>
        </div>
      );

    /* Secondary: the 8-giri / 9-giri stamp. */
    case "giri":
      return (
        <div {...common} className="table-anim__stamp" style={timing(animation)}>
          <strong className="table-anim__title">{t(ruleKey(animation.rule))}</strong>
        </div>
      );

    /* Secondary: the skip arcing over each seat it passes over (§6). */
    case "skip":
      return (
        <>
          {animation.skipped.map((playerId, index) => (
            <div
              key={playerId}
              {...common}
              className="table-anim__skip"
              style={timing(animation, {
                ...travelCssVariables({ x: 0, y: 0 }, travelTo(seatEdgeOf(room, playerId))),
                animationDelay: `${index * SKIP_STAGGER_MS}ms`,
                animationDuration: `${SKIP_MS}ms`,
              })}
            >
              <span className="table-anim__label">{t("rule.fiveSkip")}</span>
              <span className="table-anim__caption">{nameOf(room, playerId)}</span>
            </div>
          ))}
        </>
      );

    /* The agari the miyako-ochi below waits for, and a win worth marking anyway. */
    case "agari":
      return (
        <div {...common} className="table-anim__agari" style={timing(animation)}>
          <strong className="table-anim__title">
            {t("ui.animation.agari", {
              player: nameOf(room, animation.player),
              position: animation.position,
            })}
          </strong>
        </div>
      );

    /*
     * Miyako-ochi (§4.5): the demoted hand sweeps to the graveyard. Without the
     * banner it reads as a bug — cards leaving a hand nobody played — so the
     * sentence is `history.miyakoOchi` itself, the same line the log carries. It
     * is not a house rule and has no `rule.*` key of its own.
     */
    case "miyakoOchi":
      return (
        <div
          {...common}
          className="table-anim__miyako"
          style={timing(
            animation,
            travelCssVariables(travelTo(seatEdgeOf(room, animation.target)), GRAVEYARD_TRAVEL),
          )}
        >
          <span className="table-anim__cards">
            <CardBacks count={animation.count} />
          </span>
          <strong className="table-anim__title">
            {t("history.miyakoOchi", {
              player: nameOf(room, animation.player),
              target: nameOf(room, animation.target),
              count: animation.count,
            })}
          </strong>
        </div>
      );
  }
}

/** Cards in flight are face down: what travels is a count, not a hand (§8.5). */
function CardBacks({ count }: { count: number }) {
  const shown = Math.min(Math.max(count, 0), MAX_TRAVELLING_CARDS);
  return (
    <>
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} className="card-back" />
      ))}
    </>
  );
}
