/**
 * The socket layer (§8, §14): one typed Socket.IO connection, the seat behind it,
 * and the latest `PublicGameState`.
 *
 * **Same origin, no configuration — on the web.** The client is served as static
 * assets off the same Cloud Run service as the server (§14), so `io()` is called
 * with no URL and connects back to the page's own origin. In dev, Vite proxies
 * `/socket.io` and `/rooms` to :4000, so the same-origin code path is what runs
 * locally too. The one exception is the iOS build, whose pages come from
 * `capacitor://localhost` and so must name the server outright; `serverUrl.ts`
 * owns that, and resolves to the same origin-relative calls everywhere else.
 *
 * **Transport is WebSocket-only** (§14): long-polling across a cold-started
 * instance is strictly worse and there is no fallback case worth supporting.
 *
 * **Identity is the resume token, not the socket id** (§8.1). The server issues one
 * on `joined`, emitted to this socket alone before its first `roomState`; a
 * successful resume echoes the same token back, so the payload is stored
 * unconditionally. It is replayed on every `joinRoom` — after a transport drop and
 * after a page reload alike — which is what reclaims the seat instead of taking a
 * new one.
 *
 * **A reload replays the seat by itself** (§8.1). The provider — not `MainMenu`,
 * which would have to render first — auto-rejoins on mount from `storedSession`,
 * so a player who reloads mid-round is back at the table without a click. The one
 * guard is age: a session stamped more than `SESSION_MAX_AGE_MS` ago, or written
 * before the stamp existed, is left for the menu's Rejoin button rather than
 * dragging next game night's browsers back into last week's finished lobby. The
 * two ways out stay what they were: `leaveRoom` clears the seat, and a room the
 * server has forgotten answers `ROOM_NOT_FOUND`, which drops the seat and falls
 * back to the menu without retrying.
 *
 * **The address bar carries the room code** (`roomUrl.ts`): `/ABC` once seated,
 * `/` once not. A load that arrives on `/ABC` auto-joins that code when this
 * browser already knows a name to join under — a stored seat's name, whatever
 * room it was for — and otherwise hands the code to `MainMenu` to prefill, since
 * a join without a name is not one the server would accept (§8.1). The loaded-on
 * code is captured once, before the sync effect below can rewrite it.
 *
 * Inside the iOS app the same code arrives a second way: a tapped invite link
 * opens the app rather than the web client (§14), and iOS hands the URL to
 * `onDeepLink` instead of navigating the web view. That is why `linkedRoomCode`
 * is state rather than a constant — the app can be pointed at a new room while
 * it is already running, and lands in it exactly as a fresh load on `/ABC`
 * would.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { readRoomCodeFromLocation, readRoomCodeFromUrl, syncRoomCodeToUrl } from "../roomUrl";
import { readStoredPlayerName, writeStoredPlayerName } from "../playerName";
import { readStoredPlayerIcon, writeStoredPlayerIcon } from "../playerIcon";
import { SESSION_STORAGE_KEY, readStored, writeStored } from "../storage";
import { serverUrl, socketUrl } from "../serverUrl";
import { onAppResume, onDeepLink } from "../native";
import { normalizePlayerIcon, SERVER_TO_CLIENT_EVENTS } from "@daifugo/core";
import type {
  ClientToServerEvents,
  GameErrorPayload,
  PublicGameState,
  ServerToClientEvents,
} from "@daifugo/core";

export type DaifugoClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** What the client sends: everything but `joinRoom`, which the provider owns. */
export type RoomAction = Exclude<keyof ClientToServerEvents, "joinRoom">;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";

export { SESSION_STORAGE_KEY };

/**
 * The seat this browser holds, persisted across reloads. `resumeToken` is the
 * whole point (§8.1); the room and name ride along so a reload can replay the
 * join without asking again.
 */
export interface StoredSession {
  roomId: string;
  playerName: string;
  resumeToken: string;
  /**
   * When the seat was last written, epoch ms. Absent on sessions written before
   * this field existed, which is why `isSessionFresh` treats it as stale.
   */
  savedAt?: number;
}

/**
 * How long a stored seat stays eligible for the mount-time auto-rejoin. Long
 * enough to cover any one sitting, short enough that the next evening starts at
 * the menu instead of in a finished lobby.
 */
export const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Whether the stored seat is recent enough to replay without asking. */
export function isSessionFresh(session: StoredSession, now: number): boolean {
  if (typeof session.savedAt !== "number") return false;
  return now - session.savedAt < SESSION_MAX_AGE_MS;
}

export function readStoredSession(): StoredSession | null {
  try {
    const raw = readStored(SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { roomId, playerName, resumeToken, savedAt } = parsed as Record<string, unknown>;
    if (typeof roomId !== "string" || typeof playerName !== "string") return null;
    if (typeof resumeToken !== "string") return null;
    return {
      roomId,
      playerName,
      resumeToken,
      savedAt: typeof savedAt === "number" ? savedAt : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Persists the seat, stamping it with the write time. Returns what was stored so
 * callers hold the same `savedAt` the next load will read back.
 */
function writeStoredSession(session: StoredSession | null): StoredSession | null {
  const stamped = session === null ? null : { ...session, savedAt: Date.now() };
  // A browser refusing storage costs a reconnect, not a crash (`storage.ts`).
  writeStored(SESSION_STORAGE_KEY, stamped === null ? null : JSON.stringify(stamped));
  return stamped;
}

export interface SocketContextValue {
  status: ConnectionStatus;
  /** The last state the server sent, already redacted for this seat (§8.5). */
  room: PublicGameState | null;
  playerId: string | null;
  roomId: string | null;
  /** The last `gameError`, for the sender only (§8.4). */
  error: GameErrorPayload | null;
  /** A seat this browser can reclaim without re-entering a name. */
  storedSession: StoredSession | null;
  /**
   * The room code this client has been pointed at — the path it loaded on, or
   * the last invite link opened into the app — for `MainMenu` to prefill.
   */
  linkedRoomCode: string | null;
  /** `POST /rooms` (§8: the code must exist before anyone can join it), then join. */
  createRoom: (playerName: string, icon?: string) => Promise<string>;
  joinRoom: (roomId: string, playerName: string, icon?: string) => void;
  leaveRoom: () => void;
  clearError: () => void;
  /** Typed passthrough for every other client-to-server event; false when dropped offline. */
  send: <E extends RoomAction>(event: E, ...args: Parameters<ClientToServerEvents[E]>) => boolean;
  /**
   * Listen to a server event that is not the room state — today, `reaction`
   * (`core/reactions.ts`), which is relayed rather than stored and so has no
   * `PublicGameState` field to read it back out of. Returns the unsubscribe.
   *
   * Registration is against a registry this provider owns, not the socket, so a
   * child effect — which runs before this provider's own mount effect — cannot
   * subscribe into a socket that does not exist yet, and a reconnect does not
   * lose the listener.
   */
  subscribe: <E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
  ) => () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export interface SocketProviderProps {
  children: ReactNode;
  /** Overridden in tests. Production connects to the server's origin (§14). */
  connect?: () => DaifugoClientSocket;
  /** Overridden in tests. */
  fetchImpl?: typeof fetch;
}

function defaultConnect(): DaifugoClientSocket {
  const options = { transports: ["websocket"], autoConnect: false };
  // `socketUrl()` is undefined on the web — the page's own origin, unchanged —
  // and the deployed origin inside the iOS app, which has none of its own.
  const url = socketUrl();
  return url === undefined ? io(options) : io(url, options);
}

export function SocketProvider({ children, connect, fetchImpl }: SocketProviderProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [room, setRoom] = useState<PublicGameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<GameErrorPayload | null>(null);
  const [storedSession, setStoredSession] = useState<StoredSession | null>(() =>
    readStoredSession(),
  );
  // Seeded at first render: the sync effect below rewrites the path as soon as
  // it runs, so the loaded-on code has to be read before that. A universal link
  // tapped later replaces it (`onDeepLink` below). The counter is what makes a
  // second tap of the *same* link a fresh intent rather than an unchanged value
  // the join effect would sleep through.
  const [linkedRoom, setLinkedRoom] = useState<{ code: string | null; taps: number }>(() => ({
    code: readRoomCodeFromLocation(),
    taps: 0,
  }));
  const linkedRoomCode = linkedRoom.code;

  const socketRef = useRef<DaifugoClientSocket | null>(null);
  // The join to replay on `connect`, whether that is the first connect or a
  // reconnect after a drop. Held in a ref so the socket handlers, registered once,
  // always see the current intent.
  const pendingJoin = useRef<{ roomId: string; playerName: string; icon?: string } | null>(null);
  // Whether the current join attempt has been seated. A room-lifecycle error
  // before that is a failed join — including a replayed one after a reconnect —
  // and drops the stored seat *for that room*; the same code once seated is just
  // an error to show.
  const seated = useRef(false);
  const connectRef = useRef(connect ?? defaultConnect);
  // Extra listeners per server event, owned here rather than on the socket: see
  // `subscribe` on the context value.
  const extraListeners = useRef(new Map<string, Set<(...args: never[]) => void>>());

  useEffect(() => {
    const socket = connectRef.current();
    socketRef.current = socket;

    // One forwarder per event, registered once, fanning out to whatever is in
    // the registry at the time it fires.
    for (const event of SERVER_TO_CLIENT_EVENTS) {
      socket.on(event, ((...args: never[]) => {
        for (const handler of extraListeners.current.get(event) ?? []) handler(...args);
      }) as never);
    }

    socket.on("connect", () => {
      const join = pendingJoin.current;
      if (join === null) {
        setStatus("connected");
        return;
      }
      // Replay the token if we hold one for this room; the server mints a fresh
      // seat when there is none, and echoes the same token back on a resume.
      const stored = readStoredSession();
      const token = stored?.roomId === join.roomId ? stored.resumeToken : undefined;
      seated.current = false;
      socket.emit(
        "joinRoom",
        join.roomId,
        join.playerName,
        token,
        ...(join.icon === undefined ? [] : [join.icon]),
      );
    });

    socket.on("joined", (payload) => {
      const join = pendingJoin.current;
      const session = writeStoredSession({
        roomId: payload.roomId,
        playerName: join?.playerName ?? "",
        resumeToken: payload.resumeToken,
      });
      setStoredSession(session);
      seated.current = true;
      setPlayerId(payload.playerId);
      setRoomId(payload.roomId);
      // Identity is restored, but the table still holds its pre-drop snapshot.
      // `roomState` below is the readiness boundary for rendering and actions.
    });

    socket.on("roomState", (state) => {
      setRoom(state);
      setStatus("connected");
    });

    socket.on("gameError", (payload) => {
      setError(payload);
      // A join that cannot succeed must not be retried on every reconnect: drop
      // the seat and fall back to the menu.
      const joinFailed =
        payload.code === "ROOM_NOT_FOUND" ||
        payload.code === "ROOM_FULL" ||
        payload.code === "NAME_TAKEN" ||
        payload.code === "WRONG_STATUS";
      if (joinFailed && !seated.current) {
        const failedRoomId = pendingJoin.current?.roomId;
        pendingJoin.current = null;
        // Only the seat for the room we just failed to enter is dead. A mistyped
        // code for some other room must not cost the seat this browser still
        // holds, because that token is the only way back into it (§8.1).
        const stored = readStoredSession();
        if (stored !== null && stored.roomId === failedRoomId) {
          writeStoredSession(null);
          setStoredSession(null);
        }
        // A join replayed after a drop can fail once the room is gone; without
        // clearing the last state the app keeps rendering an obsolete roster
        // instead of falling back to the menu.
        setRoom(null);
        setRoomId(null);
        setPlayerId(null);
        setStatus("idle");
        socket.disconnect();
      }
    });

    socket.on("disconnect", () => {
      // Socket.IO reconnects on its own; the seat survives because the token is
      // replayed on the next `connect` (§8.1, §8.3).
      setStatus(pendingJoin.current === null ? "idle" : "reconnecting");
    });

    // iOS suspends the WebView on background, freezing Socket.IO's reconnect
    // backoff along with everything else, so a player coming back to the app can
    // otherwise sit disconnected for as long as the frozen delay had left. The
    // seat itself is unaffected — the token is replayed on the next `connect`
    // (§8.1) — so all this needs to do is ask for that connect. No-op on the web.
    const stopResumeWatch = onAppResume(() => {
      if (pendingJoin.current === null || socket.connected) return;
      socket.connect();
    });

    return () => {
      stopResumeWatch();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const joinRoom = useCallback(
    (nextRoomId: string, playerName: string, icon = readStoredPlayerIcon()) => {
      const socket = socketRef.current;
      if (socket === null) return;
      pendingJoin.current = { roomId: nextRoomId, playerName, icon };
      if (icon !== undefined) writeStoredPlayerIcon(icon);
      // Every join runs through here, so this is the one place the name has to be
      // remembered — menu, rejoin link, and the mount-time auto-join alike.
      writeStoredPlayerName(playerName);
      seated.current = false;
      setRoomId(nextRoomId);
      setError(null);
      setStatus("connecting");
      if (socket.connected) {
        const stored = readStoredSession();
        const token = stored?.roomId === nextRoomId ? stored.resumeToken : undefined;
        socket.emit(
          "joinRoom",
          nextRoomId,
          playerName,
          token,
          ...(icon === undefined ? [] : [icon]),
        );
      } else {
        socket.connect();
      }
    },
    [],
  );

  // An invite link tapped on the phone points the running app at a room, which
  // is the same intent as a load on `/ABC` — so it feeds the same code path
  // rather than joining here. No-op on the web, where the browser navigates.
  useEffect(
    () =>
      onDeepLink((url) => {
        const code = readRoomCodeFromUrl(url);
        if (code !== null) setLinkedRoom((prev) => ({ code, taps: prev.taps + 1 }));
      }),
    [],
  );

  // A reload replays the seat by itself: no click, no waiting for `MainMenu` to
  // render. Deliberately unguarded against a second run — StrictMode remounts the
  // socket effect above too, and the join has to be replayed onto the new socket.
  // Nothing but a new link re-runs it, so a `ROOM_NOT_FOUND` for a room the
  // server has forgotten ends at the menu instead of starting a retry loop.
  useEffect(() => {
    const stored = readStoredSession();
    // A URL code is an explicit, just-expressed intent, so it outranks both the
    // stored seat's room and the freshness guard — a link pasted into a browser
    // that has been idle for a week is still a link to *this* room. The token is
    // replayed only when the stored seat is for that same room; `joinRoom`
    // decides that on its own.
    if (linkedRoomCode !== null) {
      // The seat's name first, then the name this browser plays under: a link
      // opened by someone whose last seat is long gone still knows who they are.
      const seatName = stored?.playerName ?? "";
      const name = seatName !== "" ? seatName : readStoredPlayerName();
      if (name !== "") joinRoom(linkedRoomCode, name);
      return;
    }
    if (stored === null || !isSessionFresh(stored, Date.now())) return;
    joinRoom(stored.roomId, stored.playerName);
  }, [joinRoom, linkedRoom]);

  // A successful profile mutation arrives through the authoritative room
  // broadcast. Only then update the reconnect intent and durable identity, so a
  // rejected name collision can never poison the next reload.
  useEffect(() => {
    if (room === null || playerId === null) return;
    const seat = [...room.players, ...room.pendingJoins].find((player) => player.id === playerId);
    const join = pendingJoin.current;
    if (seat === undefined || join === null) return;
    const icon = normalizePlayerIcon(seat.icon);
    if (join.playerName === seat.name && normalizePlayerIcon(join.icon) === icon) return;

    pendingJoin.current = { ...join, playerName: seat.name, icon };
    writeStoredPlayerName(seat.name);
    writeStoredPlayerIcon(icon);
    const stored = readStoredSession();
    if (stored !== null && stored.roomId === room.roomId) {
      const session = writeStoredSession({ ...stored, playerName: seat.name });
      setStoredSession(session);
    }
  }, [playerId, room]);

  // The address bar follows the seat. It is left alone while a join is in flight
  // — clearing it mid-connect would throw away the code a reload needs — and only
  // returns to `/` once there is no room and no join outstanding. `pendingJoin`
  // rather than `status` is what says "outstanding": the mount-time auto-join
  // sets it during the effect above, one render before `status` catches up.
  const activeRoomCode = room?.roomId ?? null;
  useEffect(() => {
    if (activeRoomCode !== null) syncRoomCodeToUrl(activeRoomCode);
    else if (pendingJoin.current === null) syncRoomCodeToUrl(null);
  }, [activeRoomCode, status]);

  const createRoom = useCallback(
    async (playerName: string, icon?: string): Promise<string> => {
      const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch(serverUrl("/rooms"), { method: "POST" });
      if (!response.ok) throw new Error(`POST /rooms failed: ${response.status}`);
      const body = (await response.json()) as { roomId: string };
      joinRoom(body.roomId, playerName, icon);
      return body.roomId;
    },
    [fetchImpl, joinRoom],
  );

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    const finish = (forgetSeat: boolean) => {
      pendingJoin.current = null;
      seated.current = false;
      // Offline departures retain the token until the server can be reached;
      // otherwise an immediate rejoin would collide with the grace-period seat.
      if (forgetSeat) {
        writeStoredSession(null);
        setStoredSession(null);
      }
      setRoom(null);
      setPlayerId(null);
      setRoomId(null);
      setError(null);
      setStatus("idle");
      socket?.disconnect();
    };
    if (socket?.connected) socket.emit("leaveRoom", () => finish(true));
    else finish(false);
  }, []);

  const send = useCallback<SocketContextValue["send"]>(
    (event, ...args) => {
      // Socket.IO buffers emits made while disconnected and flushes them after
      // reconnecting. A turn action is stale by then, so drop it at the source.
      if (status !== "connected") return false;
      const socket = socketRef.current;
      if (socket === null || !socket.connected) return false;
      // socket.io-client's overloads do not narrow through a generic event name;
      // the contract itself is enforced by `RoomAction` and `Parameters<>` above.
      (socket.emit as (name: string, ...rest: unknown[]) => void)(event, ...args);
      return true;
    },
    [status],
  );

  const clearError = useCallback(() => setError(null), []);

  const subscribe = useCallback<SocketContextValue["subscribe"]>((event, handler) => {
    const existing = extraListeners.current.get(event) ?? new Set<(...args: never[]) => void>();
    const listener = handler as (...args: never[]) => void;
    existing.add(listener);
    extraListeners.current.set(event, existing);
    return () => {
      existing.delete(listener);
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({
      status,
      room,
      playerId,
      roomId,
      error,
      storedSession,
      linkedRoomCode,
      createRoom,
      joinRoom,
      leaveRoom,
      clearError,
      send,
      subscribe,
    }),
    [
      status,
      room,
      playerId,
      roomId,
      error,
      storedSession,
      linkedRoomCode,
      createRoom,
      joinRoom,
      leaveRoom,
      clearError,
      send,
      subscribe,
    ],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const value = useContext(SocketContext);
  if (value === null) throw new Error("useSocket must be used inside a SocketProvider");
  return value;
}
