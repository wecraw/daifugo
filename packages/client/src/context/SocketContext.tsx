/**
 * The socket layer (§8, §14): one typed Socket.IO connection, the seat behind it,
 * and the latest `PublicGameState`.
 *
 * **Same origin, no configuration.** The client is served as static assets off the
 * same Cloud Run service as the server (§14), so `io()` is called with no URL and
 * connects back to the page's own origin. There is no `VITE_SERVER_URL` and no
 * per-environment build. In dev, Vite proxies `/socket.io` and `/rooms` to :4000,
 * so the same-origin code path is what runs locally too.
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

export const SESSION_STORAGE_KEY = "daifugo.session";

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
    const raw = globalThis.localStorage?.getItem(SESSION_STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
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
  try {
    if (stamped === null) globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY);
    else globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(stamped));
  } catch {
    // A browser refusing storage costs a reconnect, not a crash.
  }
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
  /** `POST /rooms` (§8: the code must exist before anyone can join it), then join. */
  createRoom: (playerName: string) => Promise<string>;
  joinRoom: (roomId: string, playerName: string) => void;
  leaveRoom: () => void;
  clearError: () => void;
  /** Typed passthrough for every other client-to-server event; false when dropped offline. */
  send: <E extends RoomAction>(event: E, ...args: Parameters<ClientToServerEvents[E]>) => boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export interface SocketProviderProps {
  children: ReactNode;
  /** Overridden in tests. Production connects to the page's own origin (§14). */
  connect?: () => DaifugoClientSocket;
  /** Overridden in tests. */
  fetchImpl?: typeof fetch;
}

function defaultConnect(): DaifugoClientSocket {
  return io({ transports: ["websocket"], autoConnect: false });
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

  const socketRef = useRef<DaifugoClientSocket | null>(null);
  // The join to replay on `connect`, whether that is the first connect or a
  // reconnect after a drop. Held in a ref so the socket handlers, registered once,
  // always see the current intent.
  const pendingJoin = useRef<{ roomId: string; playerName: string } | null>(null);
  // Whether the current join attempt has been seated. A room-lifecycle error
  // before that is a failed join — including a replayed one after a reconnect —
  // and drops the stored seat *for that room*; the same code once seated is just
  // an error to show.
  const seated = useRef(false);
  const connectRef = useRef(connect ?? defaultConnect);

  useEffect(() => {
    const socket = connectRef.current();
    socketRef.current = socket;

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
      socket.emit("joinRoom", join.roomId, join.playerName, token);
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

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const joinRoom = useCallback((nextRoomId: string, playerName: string) => {
    const socket = socketRef.current;
    if (socket === null) return;
    pendingJoin.current = { roomId: nextRoomId, playerName };
    seated.current = false;
    setRoomId(nextRoomId);
    setError(null);
    setStatus("connecting");
    if (socket.connected) {
      const stored = readStoredSession();
      const token = stored?.roomId === nextRoomId ? stored.resumeToken : undefined;
      socket.emit("joinRoom", nextRoomId, playerName, token);
    } else {
      socket.connect();
    }
  }, []);

  // A reload replays the seat by itself: no click, no waiting for `MainMenu` to
  // render. Deliberately unguarded against a second run — StrictMode remounts the
  // socket effect above too, and the join has to be replayed onto the new socket.
  // It runs on mount only, so a `ROOM_NOT_FOUND` for a room the server has
  // forgotten ends at the menu instead of starting a retry loop.
  useEffect(() => {
    const stored = readStoredSession();
    if (stored === null || !isSessionFresh(stored, Date.now())) return;
    joinRoom(stored.roomId, stored.playerName);
  }, [joinRoom]);

  const createRoom = useCallback(
    async (playerName: string): Promise<string> => {
      const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch("/rooms", { method: "POST" });
      if (!response.ok) throw new Error(`POST /rooms failed: ${response.status}`);
      const body = (await response.json()) as { roomId: string };
      joinRoom(body.roomId, playerName);
      return body.roomId;
    },
    [fetchImpl, joinRoom],
  );

  const leaveRoom = useCallback(() => {
    pendingJoin.current = null;
    seated.current = false;
    writeStoredSession(null);
    setStoredSession(null);
    setRoom(null);
    setPlayerId(null);
    setRoomId(null);
    setError(null);
    setStatus("idle");
    socketRef.current?.disconnect();
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

  const value = useMemo<SocketContextValue>(
    () => ({
      status,
      room,
      playerId,
      roomId,
      error,
      storedSession,
      createRoom,
      joinRoom,
      leaveRoom,
      clearError,
      send,
    }),
    [
      status,
      room,
      playerId,
      roomId,
      error,
      storedSession,
      createRoom,
      joinRoom,
      leaveRoom,
      clearError,
      send,
    ],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const value = useContext(SocketContext);
  if (value === null) throw new Error("useSocket must be used inside a SocketProvider");
  return value;
}
