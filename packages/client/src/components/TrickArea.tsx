/**
 * The middle band: what is on the table, and the state that changes what beats it.
 *
 * The three badges are the ones §10.9 calls out as secondary feedback — the suit
 * lock, the 11-back, and the revolution — and they are read straight off the
 * state rather than inferred from the trick, because `isRevolution` persists for
 * the round while `trickInverted` and `suitLock` reset on a clear (§2).
 *
 * The stack keeps every play of the current trick rather than only the top one,
 * so you can see what was beaten and by how much. Jokers render under their
 * binding (§5.4).
 *
 * During `EXCHANGE` there is no trick yet: the band holds the exchange ring,
 * centred (§10.10). The exchange UI itself is its own issue.
 */
import type { CSSProperties } from "react";
import { EXCHANGE_DURATION_MS, type PublicGameState } from "@daifugo/core";
import { suitLockGlyphs } from "../glyphs";
import { useTranslate } from "../i18n/index";
import { CardFace } from "./CardFace";
import { TurnTimer } from "./TurnTimer";

export function TrickArea({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const lock = room.suitLock ?? [];
  const top = room.currentTrick.length - 1;

  return (
    <section className="trick-area" aria-label={t("ui.table.trickArea")}>
      <div className="trick-area__banners">
        {room.isRevolution && <span className="badge badge--rule">{t("rule.kakumei")}</span>}
        {room.trickInverted && <span className="badge badge--rule">{t("rule.elevenBack")}</span>}
        {lock.length > 0 && (
          <span
            className="badge badge--rule"
            title={t("ui.trick.suitLock", { suits: suitLockGlyphs(lock) })}
          >
            {t("rule.shibari")} {suitLockGlyphs(lock)}
          </span>
        )}
      </div>

      {room.status === "EXCHANGE" ? (
        <div className="trick-area__centre">
          <TurnTimer deadline={room.deadline} durationMs={EXCHANGE_DURATION_MS} size="banner" />
          <p className="trick-area__note">{t("ui.table.exchange")}</p>
        </div>
      ) : room.currentTrick.length === 0 ? (
        <div className="trick-area__centre">
          <p className="trick-area__note">{t("ui.table.leadOpen")}</p>
        </div>
      ) : (
        <ol className="trick-area__stack">
          {room.currentTrick.map((play, index) => (
            <li
              key={`${index}-${play.playedBy}`}
              className="trick-area__play"
              style={
                {
                  zIndex: index,
                  opacity: Math.max(0.35, 1 - (top - index) * 0.22),
                  "--depth": top - index,
                } as CSSProperties
              }
            >
              <span className="trick-area__cards">
                {play.combo.cards.map((card) => (
                  <CardFace
                    key={card.id}
                    card={card}
                    binding={play.combo.bindings.find((bound) => bound.cardId === card.id)}
                  />
                ))}
              </span>
              {index === top && (
                <span className="trick-area__player">
                  {t("ui.trick.playedBy", { player: nameOf(room, play.playedBy) })}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function nameOf(room: PublicGameState, playerId: string): string {
  return room.players.find((seat) => seat.id === playerId)?.name ?? playerId;
}
