import { PlayerIcon } from "./PlayerIcon";
/**
 * One opponent's chip on the edge of the table (§10.1).
 *
 * It says the four things you look up mid-trick: how many cards they are holding,
 * what role they carried into the round, whether they are still live in this
 * trick, and whether they are actually there. The turn ring rides on the active
 * seat (§10.10).
 *
 * A chip is a little over 100px wide and, on the top edge, under 60px tall, so
 * the count is a stack of face-down pips and presence is a dot. Both carry the
 * sentence they stand for as their accessible name, which is also what a test
 * reads them by — the shorthand is a size, not a loss. How far each pip sits
 * along from the last is `seatStackStep`, sized off the table's opening hand, so
 * eighteen cards still end inside the chip and the fan still shortens as they
 * are played.
 *
 * The chip does not decide any of that. `status` comes from core's eligibility
 * helpers via `seatStatus` — a finished or demoted player keeps their chair in
 * `turnOrder` and eligibility is derived, never removed — so the client never
 * grows a second opinion about who is still in the round.
 *
 * The role shows as a mark rather than its name because `role.DAI_HINMIN` does
 * not fit in a 56px strip; the translated name is the chip's title, so it stays
 * reachable. The Daifugo's mark is a drawn crown and gilds the chip it sits on,
 * because the top seat is the one everybody is playing against and a pair of
 * diamonds does not say that from across the table.
 */
import type { CSSProperties } from "react";
import { roleKey, type Player, type Role } from "@daifugo/core";
import { ROLE_GLYPH } from "../glyphs";
import { useTranslate } from "../i18n/index";
import { seatStackStep, type SeatEdge, type SeatStatus } from "../layout/tableLayout";
import { TurnTimer } from "./TurnTimer";

export interface PlayerSeatProps {
  player: Player;
  /** From the redacted view: everyone's count is public, their cards are not (§8.5). */
  cardCount: number;
  status: SeatStatus;
  /** 1-indexed agari place, or null while they are still holding cards. */
  finishPosition: number | null;
  edge: SeatEdge;
  isActive: boolean;
  /** Mid-miyako-ochi (§4.5): this chip is emptying and dropping to last. */
  demoted?: boolean;
  /** The largest hand this table deals; the pip fan is sized off it, not off
   *  `cardCount`, so the fan's length stays the count (see `seatStackStep`). */
  stackCapacity: number;
  /** `state.deadline`; only the active seat rings against it (§10.10). */
  deadline: number | null;
  turnDurationMs: number;
}

export function PlayerSeat({
  player,
  cardCount,
  status,
  finishPosition,
  edge,
  isActive,
  demoted = false,
  stackCapacity,
  deadline,
  turnDurationMs,
}: PlayerSeatProps) {
  const t = useTranslate();
  const crowned = player.role?.kind === "DAI_FUGO";
  const classes = [
    "player-seat",
    `player-seat--${edge}`,
    `player-seat--${status}`,
    crowned ? "player-seat--crowned" : "",
    isActive ? "player-seat--active" : "",
    demoted ? "player-seat--demoted" : "",
    player.isConnected ? "" : "player-seat--offline",
  ].filter((name) => name !== "");

  return (
    <div className={classes.join(" ")} data-player-id={player.id} data-seat-edge={edge}>
      <div className="player-seat__line">
        {player.role !== null && <RoleMark role={player.role} />}
        <PlayerIcon icon={player.icon} />
        <span className="player-seat__name">{player.name}</span>
        {isActive && <TurnTimer deadline={deadline} durationMs={turnDurationMs} size="seat" />}
      </div>
      <div className="player-seat__line player-seat__line--quiet">
        <span
          className="player-seat__stack"
          style={{ "--seat-pip-step": `${seatStackStep(stackCapacity, edge)}px` } as CSSProperties}
          title={t("ui.seat.cards", { count: cardCount })}
          aria-label={t("ui.seat.cards", { count: cardCount })}
        >
          {Array.from({ length: cardCount }, (_, index) => (
            <span key={index} className="player-seat__stack-card" aria-hidden="true" />
          ))}
        </span>
        {!player.isConnected && (
          <span
            className="player-seat__offline"
            title={t("ui.seat.disconnected")}
            aria-label={t("ui.seat.disconnected")}
          >
            ●
          </span>
        )}
        {status === "passed" && <span className="badge">{t("ui.seat.passed")}</span>}
        {status === "finished" && (
          <span className="badge badge--good">
            {t("ui.seat.finished", { position: finishPosition ?? 0 })}
          </span>
        )}
        {status === "dropped" && <span className="badge badge--warn">{t("ui.seat.dropped")}</span>}
        {demoted && <span className="badge badge--warn">{t("ui.animation.miyakoOchiSeat")}</span>}
      </div>
    </div>
  );
}

/** The role carried into this round (§2: `Player.role` is the previous round's). */
function RoleMark({ role }: { role: Role }) {
  const t = useTranslate();
  const name = t(roleKey(role.kind));
  const crowned = role.kind === "DAI_FUGO";
  return (
    <span
      className={`player-seat__role${crowned ? " player-seat__role--crown" : ""}`}
      title={name}
      aria-label={name}
    >
      {crowned ? <CrownMark /> : ROLE_GLYPH[role.kind]}
    </span>
  );
}

/**
 * The Daifugo's crown.
 *
 * Drawn rather than typeset: the chip is 124px wide, which is not room for
 * `role.DAI_FUGO` in either naming — "Grand Millionaire" ellipsizes to nothing
 * there — so the one seat everybody is playing against gets a mark you can pick
 * out at a glance instead of a longer string nobody can read. The name still
 * rides along on the wrapper's title and accessible name, as every role mark's
 * does.
 */
function CrownMark() {
  return (
    <svg className="crown-mark" viewBox="0 0 24 20" aria-hidden="true" focusable="false">
      <path d="M1.6 5.2 6.4 10 12 2.4 17.6 10l4.8-4.8-1.9 10.4H3.5Z" />
      <rect x="3.4" y="16.4" width="17.2" height="2.6" rx="1.1" />
    </svg>
  );
}
