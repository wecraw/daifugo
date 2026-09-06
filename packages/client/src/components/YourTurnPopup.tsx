/**
 * The brief "your turn" flash over the trick area (§10.9-adjacent eye candy).
 *
 * It restates the persistent `game-table__turn` label the clock already shows,
 * so it is `aria-hidden`: the label is the accessible copy, this is decoration
 * that draws the eye at the moment the turn actually changes.
 */
import { useYourTurnPopup } from "../hooks/useYourTurnPopup";
import { useTranslate } from "../i18n/index";
import type { PublicGameState } from "@daifugo/core";

export function YourTurnPopup({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const show = useYourTurnPopup(room);
  if (!show) return null;

  return (
    <div className="your-turn-popup" aria-hidden="true">
      <span className="your-turn-popup__text">{t("ui.table.yourTurn")}</span>
    </div>
  );
}
