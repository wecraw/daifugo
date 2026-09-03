/**
 * What a seated player sees until the lobby and the table land in their own
 * issues: the room code, the seat count, and the connection state.
 *
 * It renders from `PublicGameState` — already redacted for this seat (§8.5) — so
 * the components that replace it read the same input.
 */
import type { PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useTranslate, type I18nKey } from "../i18n/index";

const STATUS_KEY: Record<string, I18nKey> = {
  idle: "ui.connection.offline",
  connecting: "ui.connection.connecting",
  connected: "ui.connection.connected",
  reconnecting: "ui.connection.reconnecting",
};

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
      </header>
      <p>{t("ui.room.players", { count: room.players.length })}</p>
      <ul className="room-shell__players">
        {room.players.map((player) => (
          <li key={player.id}>{player.name}</li>
        ))}
      </ul>
      <p>{t("ui.room.waiting")}</p>
      <button type="button" onClick={leaveRoom}>
        {t("ui.room.leave")}
      </button>
    </div>
  );
}
