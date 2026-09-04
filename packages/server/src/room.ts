/**
 * The Socket.IO glue (§8.4): binds sockets to a {@link RoomManager} and turns its
 * `onUpdate` hook into per-recipient `roomState` broadcasts.
 *
 * Redaction is per seat (§8.5): every recipient gets `getPublicState(state, its
 * own playerId)`, so one broadcast is really N sanitized payloads. Round and
 * match transitions emit `roundFinished` / `matchFinished` once, tracked by the
 * last status seen for each room.
 *
 * Transport is WebSocket-only (§14). Broadcast uses Socket.IO's in-process adapter:
 * the service runs as a single instance, so every socket in a room is here. A socket
 * carries its own `resumeToken` and the seat behind it is resolved from Firestore,
 * so a reconnect after a redeploy still lands on the right seat.
 */
import {
  getPublicState,
  matchStandings,
  roundResults,
  type ErrorCode,
  type GameState,
  type GameStatus,
} from "@daifugo/core";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@daifugo/core";
import type { Server, Socket } from "socket.io";
import type { RoomDoc } from "./repository.js";
import { RoomManager } from "./roomManager.js";

export type DaifugoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type DaifugoSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * Owns the manager and the Socket.IO server, and is the manager's broadcast sink.
 * One per process; construct it, then hand `broadcast` to the manager as its
 * `onUpdate`.
 */
export class RoomHub {
  private readonly lastStatus = new Map<string, GameStatus>();
  private manager!: RoomManager;

  constructor(private readonly io: DaifugoServer) {}

  /**
   * Wire the manager after construction. The two reference each other — the hub
   * is the manager's broadcast sink and the manager is the hub's action target —
   * so one is built first and attached here before any socket connects.
   */
  attach(manager: RoomManager): void {
    this.manager = manager;
  }

  /**
   * The manager's `onUpdate` (§8.4 step 4): fan a stored doc out to every socket
   * in the room as its own redacted `roomState`, then emit any round/match
   * transition once.
   */
  broadcast = async (doc: RoomDoc): Promise<void> => {
    const sockets = await this.io.in(doc.roomId).fetchSockets();
    for (const socket of sockets) {
      const playerId = socket.data.playerId;
      if (playerId === null) continue;
      socket.emit("roomState", getPublicState(doc.state, playerId));
    }
    this.emitTransitions(doc.roomId, doc.state);
  };

  private emitTransitions(roomId: string, state: GameState): void {
    const previous = this.lastStatus.get(roomId);
    this.lastStatus.set(roomId, state.status);
    if (state.status === previous) return;
    if (state.status === "ROUND_END" || state.status === "MATCH_END") {
      this.io.in(roomId).emit("roundFinished", roundResults(state));
    }
    if (state.status === "MATCH_END") {
      this.io.in(roomId).emit("matchFinished", matchStandings(state));
    }
  }

  /** Register every `ClientToServerEvents` handler on a fresh connection (§8). */
  register(socket: DaifugoSocket): void {
    socket.data.roomId = null;
    socket.data.playerId = null;
    socket.data.resumeToken = null;

    socket.on("joinRoom", (roomId, playerName, resumeToken) => {
      void this.onJoin(socket, roomId, playerName, resumeToken);
    });

    socket.on("updateRules", (config) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.updateRules(roomId, playerId, config),
      );
    });
    socket.on("setRoundLimit", (limit) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.setRoundLimit(roomId, playerId, limit),
      );
    });
    socket.on("setReady", (ready) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.setReady(roomId, playerId, ready),
      );
    });
    socket.on("startGame", () => {
      void this.guarded(socket, (roomId, playerId) => this.manager.startGame(roomId, playerId));
    });
    socket.on("playCards", (cardIds, bindings) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.playCards(roomId, playerId, cardIds, bindings),
      );
    });
    socket.on("pass", () => {
      void this.guarded(socket, (roomId, playerId) => this.manager.pass(roomId, playerId));
    });
    socket.on("submit7Pass", (cardIds) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.submit7Pass(roomId, playerId, cardIds),
      );
    });
    socket.on("submit10Discard", (cardIds) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.submit10Discard(roomId, playerId, cardIds),
      );
    });
    socket.on("exchangeCards", (cardIds) => {
      void this.guarded(socket, (roomId, playerId) =>
        this.manager.exchangeCards(roomId, playerId, cardIds),
      );
    });

    socket.on("disconnect", () => {
      const { roomId, playerId } = socket.data;
      if (roomId !== null && playerId !== null) void this.manager.disconnect(roomId, playerId);
    });
  }

  /**
   * `joinRoom` (§8.1). On success the socket joins the io room, receives `joined`
   * with its token before any `roomState` (§8.1, test 30a), and then its first
   * redacted state; other seats already saw the change through `broadcast`.
   */
  private async onJoin(
    socket: DaifugoSocket,
    roomId: string,
    playerName: string,
    resumeToken?: string,
  ): Promise<void> {
    const result = await this.manager.join(roomId, playerName, resumeToken);
    if (!result.ok) {
      socket.emit("gameError", { code: result.error });
      return;
    }

    const { playerId, resumeToken: token } = result.value;
    socket.data = { roomId, playerId, resumeToken: token };
    await socket.join(roomId);

    // §8.1: `joined` reaches this socket alone, before its first `roomState`, so
    // the client can store the token unconditionally.
    socket.emit("joined", { roomId, playerId, resumeToken: token });

    const doc = await this.manager.get(roomId);
    if (doc !== null) socket.emit("roomState", getPublicState(doc.state, playerId));
  }

  /**
   * Run a manager action for an already-seated socket and report a failure to the
   * sender alone (§8.4 step 3). A socket that never joined is told so.
   */
  private async guarded(
    socket: DaifugoSocket,
    action: (roomId: string, playerId: string) => Promise<{ ok: boolean; error?: ErrorCode }>,
  ): Promise<void> {
    const { roomId, playerId } = socket.data;
    if (roomId === null || playerId === null) {
      socket.emit("gameError", { code: "ROOM_NOT_FOUND" });
      return;
    }
    const result = await action(roomId, playerId);
    if (!result.ok && result.error !== undefined) {
      socket.emit("gameError", { code: result.error });
    }
  }
}
