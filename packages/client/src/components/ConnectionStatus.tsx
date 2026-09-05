import type { ConnectionStatus as SocketConnectionStatus } from "../context/SocketContext";
import { useTranslate, type UiI18nKey } from "../i18n/index";

const STATUS_KEY: Record<SocketConnectionStatus, UiI18nKey> = {
  idle: "ui.connection.offline",
  connecting: "ui.connection.connecting",
  connected: "ui.connection.connected",
  reconnecting: "ui.connection.reconnecting",
};

export interface ConnectionStatusProps {
  status: SocketConnectionStatus;
  className: string;
}

/** A translated, live connection-state label shared by the lobby and table. */
export function ConnectionStatus({ status, className }: ConnectionStatusProps) {
  const t = useTranslate();
  return (
    <span className={className} role="status">
      {t(STATUS_KEY[status])}
    </span>
  );
}
