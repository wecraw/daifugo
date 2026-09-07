/**
 * The middle band: what is on the table, and the state that changes what beats it.
 *
 * The three badges are the ones §10.9 calls out as secondary feedback — the suit
 * lock, the 11-back, and the revolution — and they are read straight off the
 * state rather than inferred from the trick, because `isRevolution` persists for
 * the round while `trickInverted` and `suitLock` reset on a clear (§2). They sit
 * under the pile, beneath the name of whoever laid it: every one of them is a
 * condition on what may beat that pile, so they belong beside it rather than
 * off in the corner of the band. The row keeps its height when it is empty, so
 * a lock appearing mid-trick never shunts the cards.
 *
 * The stack keeps every play of the current trick rather than only the top one,
 * so you can see what was beaten and by how much — but only the newest is live:
 * the beaten plays shrink back, drain of colour and lose their shadow, so the
 * one card that has to be answered is never confused with the heap under it. Jokers render under their
 * binding (§5.4). A trick wider than the band tightens its overlap and then
 * sheds its oldest plays, because the newest one — the one that has to be beaten
 * — is the one that may never be clipped; `fitTrickStack` owns that arithmetic.
 *
 * During `EXCHANGE` there is no trick yet: the band holds the exchange ring,
 * centred (§10.10). The exchange UI itself is its own issue.
 */
import type { CSSProperties } from "react";
import { EXCHANGE_DURATION_MS, type PublicGameState } from "@daifugo/core";
import { kaidanLockGlyph, suitLockGlyphs } from "../glyphs";
import { useTranslate } from "../i18n/index";
import { fitTrickStack, liveTrickOffset } from "../layout/tableLayout";
import { CardFace } from "./CardFace";
import { TurnTimer } from "./TurnTimer";

export function TrickArea({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const lock = room.suitLock ?? [];
  const kaidan = room.kaidanLock ?? null;
  // "Table is open" is advice for the seat that is up, and everyone else
  // reading it as an invitation is what §10.9 warns about — so off a viewer's
  // turn the band says nothing at all. Who the table is waiting on is said over
  // the hand instead, where the player is already looking.
  const activeId = room.turnOrder[room.activePlayerIndex] ?? null;
  const isMyTurn = room.status === "IN_PROGRESS" && activeId === room.myPlayerId;
  const waiting = room.status === "IN_PROGRESS" && !isMyTurn && activeId !== null;
  const top = room.currentTrick.length - 1;
  const cardCounts = room.currentTrick.map((play) => play.combo.cards.length);
  const fit = fitTrickStack(cardCounts);
  const { firstVisibleIndex, overlap } = fit;

  return (
    <section
      className="trick-area"
      aria-label={t("ui.table.trickArea")}
      style={{ "--trick-live-offset": `${liveTrickOffset(cardCounts, fit)}px` } as CSSProperties}
    >
      {room.status === "EXCHANGE" ? (
        <div className="trick-area__centre">
          <TurnTimer deadline={room.deadline} durationMs={EXCHANGE_DURATION_MS} size="banner" />
          <p className="trick-area__note">{t("ui.table.exchange")}</p>
        </div>
      ) : room.currentTrick.length === 0 ? (
        <div className="trick-area__centre">
          {!waiting && <p className="trick-area__note">{t("ui.table.leadOpen")}</p>}
        </div>
      ) : (
        <ol
          className="trick-area__stack"
          style={{ "--trick-overlap": `${overlap}px` } as CSSProperties}
        >
          {room.currentTrick.slice(firstVisibleIndex).map((play, offset) => {
            const index = firstVisibleIndex + offset;
            return (
              <li
                key={`${index}-${play.playedBy}`}
                className={`trick-area__play trick-area__play--${index === top ? "live" : "beaten"}`}
                style={
                  {
                    zIndex: index,
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
            );
          })}
        </ol>
      )}

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
        {kaidan !== null && (
          <span
            className="badge badge--rule"
            title={t("ui.trick.kaidanLock", { rank: kaidanLockGlyph(kaidan) })}
          >
            {t("rule.kaidan")} {kaidanLockGlyph(kaidan)}
          </span>
        )}
      </div>
    </section>
  );
}

function nameOf(room: PublicGameState, playerId: string): string {
  return room.players.find((seat) => seat.id === playerId)?.name ?? playerId;
}
