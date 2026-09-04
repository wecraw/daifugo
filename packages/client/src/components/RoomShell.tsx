/**
 * What a seated player sees: the room code, the connection state, and whichever
 * screen the room's status calls for.
 *
 * `LOBBY`, `ROUND_END` and `MATCH_END` are the lobby (§9, §10.11) — the roster
 * before the first deal, and the standings between rounds. `EXCHANGE` and
 * `IN_PROGRESS` are the table, which lands with its own issue; until then they
 * keep the placeholder this shell started as.
 *
 * It renders from `PublicGameState` — already redacted for this seat (§8.5) — so
 * the components that replace it read the same input.
 */
import type { PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useTranslate, type I18nKey } from "../i18n/index";
import { Lobby } from "./Lobby";

const STATUS_KEY: Record<string, I18nKey> = {
  idle: "ui.connection.offline",
  connecting: "ui.connection.connecting",
  connected: "ui.connection.connected",
  reconnecting: "ui.connection.reconnecting",
};

/** The statuses the lobby owns: before the first deal, and between rounds. */
function inLobby(room: PublicGameState): boolean {
  return room.status === "LOBBY" || room.status === "ROUND_END" || room.status === "MATCH_END";
}

export function RoomShell({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { status, leaveRoom } = useSocket();

  return (
    <div className="room-shell">
      <header className="room-shell__header">
        <h1>{t("ui.room.code", { code: room.roomId })}</h1>
        <span className="room-shell__status">
          {t(STATUS_KEY[status] ?? "ui.connection.offline")}
        </span>
        <span className="room-shell__status">
          {t("ui.room.players", { count: room.players.length })}
        </span>
      </header>

      {inLobby(room) ? <Lobby room={room} /> : <p>{t("ui.room.waiting")}</p>}

      <button type="button" className="room-shell__leave" onClick={leaveRoom}>
        {t("ui.room.leave")}
      </button>
    </div>
  );
}
