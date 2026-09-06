/**
 * What a seated player sees: whichever screen the room's status calls for.
 *
 * `LOBBY`, `ROUND_END` and `MATCH_END` are the lobby (§9, §10.11) — the roster
 * before the first deal, and the standings between rounds. `EXCHANGE` and
 * `IN_PROGRESS` are the table (§10.1).
 *
 * **The lobby owns its own frame; the table does not.** §10.1 budgets all 390px of
 * a landscape viewport to the table's three bands, so a room-code strip above it
 * would push the hand row off the screen. The room code, the persistent connection
 * state and the leave control therefore live inside `Lobby`, which composes them
 * into its own layout. The table uses its existing clock cell for exceptional
 * connection states and carries its own leave button (§7.7).
 *
 * It renders from `PublicGameState` — already redacted for this seat (§8.5) — so
 * every screen below reads the same input.
 */
import type { PublicGameState } from "@daifugo/core";
import { GameTable } from "./GameTable";
import { Lobby } from "./Lobby";

/** The statuses the lobby owns: before the first deal, and between rounds. */
function inLobby(room: PublicGameState): boolean {
  return room.status === "LOBBY" || room.status === "ROUND_END" || room.status === "MATCH_END";
}

export function RoomShell({ room }: { room: PublicGameState }) {
  if (!inLobby(room)) return <GameTable room={room} />;
  return <Lobby room={room} />;
}
