/**
 * The history log in the top strip (§10.1).
 *
 * Entries arrive as i18n keys with params, already redacted for this seat (§8.5,
 * §11), and `historyLine` is what turns one into a sentence — including resolving
 * the player ids the params carry against the roster, because the engine has no
 * names to give.
 *
 * Newest first. The strip fits about three lines and the interesting entry is
 * always the last one, so reading downwards into the past beats scrolling to keep
 * up with the bottom of a growing list.
 */
import type { PublicGameState } from "@daifugo/core";
import { historyLine } from "../history";
import { useTranslate } from "../i18n/index";

/** As many as the strip can scroll through without becoming a second screen. */
export const HISTORY_LINES = 8;

export function HistoryLog({
  room,
  limit = HISTORY_LINES,
}: {
  room: PublicGameState;
  limit?: number;
}) {
  const t = useTranslate();
  const start = Math.max(0, room.history.length - limit);
  const recent = room.history.slice(start);

  return (
    <ol className="history-log" aria-label={t("ui.table.history")}>
      {recent
        .map((entry, offset) => ({ entry, index: start + offset }))
        .reverse()
        .map(({ entry, index }) => (
          <li key={index} className="history-log__line">
            {historyLine(t, entry, room.players)}
          </li>
        ))}
    </ol>
  );
}
