/**
 * One opponent's chip on the edge of the table (§10.1).
 *
 * It says the four things you look up mid-trick: how many cards they are holding,
 * what role they carried into the round, whether they are still live in this
 * trick, and whether they are actually there. The turn ring rides on the active
 * seat (§10.10).
 *
 * A chip is at most 96px wide and, on the top edge, 48px tall, so the count is a
 * bare number and presence is a dot. Both carry the sentence they stand for as
 * their accessible name, which is also what a test reads them by — the shorthand
 * is a size, not a loss.
 *
 * The chip does not decide any of that. `status` comes from core's eligibility
 * helpers via `seatStatus` — a finished or demoted player keeps their chair in
 * `turnOrder` and eligibility is derived, never removed — so the client never
 * grows a second opinion about who is still in the round.
 *
 * The role shows as a mark rather than its name because `role.DAI_HINMIN` does
 * not fit in a 56px strip; the translated name is the chip's title, so it stays
 * reachable.
 */
import { roleKey, type Player, type Role } from "@daifugo/core";
import { ROLE_GLYPH } from "../glyphs";
import { useTranslate } from "../i18n/index";
import type { SeatEdge, SeatStatus } from "../layout/tableLayout";
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
  deadline,
  turnDurationMs,
}: PlayerSeatProps) {
  const t = useTranslate();
  const classes = [
    "player-seat",
    `player-seat--${edge}`,
    `player-seat--${status}`,
    isActive ? "player-seat--active" : "",
    demoted ? "player-seat--demoted" : "",
    player.isConnected ? "" : "player-seat--offline",
  ].filter((name) => name !== "");

  return (
    <div className={classes.join(" ")} data-player-id={player.id} data-seat-edge={edge}>
      <div className="player-seat__line">
        {player.role !== null && <RoleMark role={player.role} />}
        <span className="player-seat__name">{player.name}</span>
        {isActive && <TurnTimer deadline={deadline} durationMs={turnDurationMs} size="seat" />}
      </div>
      <div className="player-seat__line player-seat__line--quiet">
        <span
          className="player-seat__count"
          title={t("ui.seat.cards", { count: cardCount })}
          aria-label={t("ui.seat.cards", { count: cardCount })}
        >
          {cardCount}
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
  return (
    <span className="player-seat__role" title={name} aria-label={name}>
      {ROLE_GLYPH[role.kind]}
    </span>
  );
}
