/**
 * The client shell: providers, the portrait gate, and the one routing decision
 * this issue owns — menu until the server seats us, room afterwards.
 *
 * The lobby and the table itself arrive with their own issues; what is here is
 * what the socket layer can already render on its own.
 */
import { OrientationGate } from "./components/OrientationGate";
import { ErrorBanner } from "./components/ErrorBanner";
import { MainMenu } from "./components/MainMenu";
import { RoomShell } from "./components/RoomShell";
import { I18nProvider } from "./i18n/index";
import { SocketProvider, useSocket, type SocketProviderProps } from "./context/SocketContext";
import type { TranslateParams } from "./i18n/index";

function Screen() {
  const { room, error, clearError } = useSocket();
  return (
    <div className="app">
      {error !== null && (
        <ErrorBanner code={error.code} params={scalarParams(error.params)} onDismiss={clearError} />
      )}
      {room === null ? <MainMenu /> : <RoomShell room={room} />}
    </div>
  );
}

/** `gameError.params` is `Record<string, unknown>`; interpolation takes scalars. */
function scalarParams(params: Record<string, unknown> | undefined): TranslateParams | undefined {
  if (params === undefined) return undefined;
  const out: TranslateParams = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "number" ? value : String(value);
  }
  return out;
}

export interface AppProps {
  connect?: SocketProviderProps["connect"];
  fetchImpl?: SocketProviderProps["fetchImpl"];
}

export function App({ connect, fetchImpl }: AppProps = {}) {
  return (
    <I18nProvider>
      <SocketProvider connect={connect} fetchImpl={fetchImpl}>
        <OrientationGate>
          <Screen />
        </OrientationGate>
      </SocketProvider>
    </I18nProvider>
  );
}
