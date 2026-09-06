/**
 * What a seated player sees: whichever screen the room's status calls for.
 *
 * `LOBBY`, `ROUND_END` and `MATCH_END` are the lobby (§9, §10.11) — the roster
 * before the first deal, and the standings between rounds. `EXCHANGE` and
 * `IN_PROGRESS` are the table (§10.1). Between rounds there is a third: the
 * round-end curtain (§10.12), which is the table with the result over it.
 *
 * **The lobby owns its own frame; the table does not.** §10.1 budgets all 390px of
 * a landscape viewport to the table's three bands, so a room-code strip above it
 * would push the hand row off the screen. The room code, the persistent connection
 * state and the leave control therefore live inside `Lobby`, which composes them
 * into its own layout. The table uses its existing clock cell for exceptional
 * connection states and carries its own leave button (§7.7).
 *
 * **Between two rounds, which screen you get depends on whether you were in the
 * round.** The round is decided inside somebody's last play, so the status flips
 * to `ROUND_END` in the same commit that would otherwise replace the table with
 * the lobby — the deciding table gone before it has been looked at. A seat that
 * watched that happen keeps the table, with `RoundEndCurtain` over it and the
 * next round's one control on it (§10.12); a seat with no such transition — a
 * newcomer, a resume (§8.1) — gets the lobby, which is the screen that
 * introduces a room. The table under the curtain is `inert`: the curtain covers
 * it, but a Tab key would still reach the hand and the leave button behind. The
 * room itself is already at `ROUND_END` throughout — nothing here delays the
 * state, only the lobby's drawing of it.
 *
 * It renders from `PublicGameState` — already redacted for this seat (§8.5) — so
 * every screen below reads the same input.
 */
import type { PublicGameState } from "@daifugo/core";
import { useRoundEndCurtain } from "../hooks/useRoundEndCurtain";
import { GameTable } from "./GameTable";
import { Lobby } from "./Lobby";
import { RoundEndCurtain } from "./RoundEndCurtain";

/** The statuses the lobby owns: before the first deal, and between rounds. */
function inLobby(room: PublicGameState): boolean {
  return room.status === "LOBBY" || room.status === "ROUND_END" || room.status === "MATCH_END";
}

export function RoomShell({ room }: { room: PublicGameState }) {
  const curtain = useRoundEndCurtain(room);

  if (curtain.showing) {
    return (
      <div className="room-shell__curtain">
        <div className="room-shell__table" inert>
          <GameTable room={room} />
        </div>
        <RoundEndCurtain room={room} onDismiss={curtain.dismiss} />
      </div>
    );
  }
  if (!inLobby(room)) return <GameTable room={room} />;
  return <Lobby room={room} />;
}
