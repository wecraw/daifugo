/**
 * The typed Socket.IO contracts of §8, shared verbatim by server and client.
 *
 * Core owns them so both ends are typechecked against one definition: the server
 * types its `Server<ClientToServerEvents, ServerToClientEvents>` and the client
 * its `Socket<ServerToClientEvents, ClientToServerEvents>` from here. Nothing in
 * this file imports socket.io — core stays a pure package with no runtime deps.
 *
 * `roomState` carries a `PublicGameState`, never a `GameState`: the sanitizer
 * runs per recipient before the broadcast (§8.4, §8.5).
 */
import type { ErrorCode } from "./i18n-keys.js";
import type { HouseRulesConfig, JokerBinding, PublicGameState, Role } from "./types.js";

/** The `gameError` payload. Emitted to the sender only (§8.4 step 3). */
export interface GameErrorPayload {
  code: ErrorCode;
  params?: Record<string, unknown>;
}

/** One line of the round-end result, in final finish order (§4.1). */
export interface RoundResult {
  playerId: string;
  role: Role;
}

/** One line of the match standings, cumulative across rounds (§9). */
export interface MatchStanding {
  playerId: string;
  points: number;
}

export interface ServerToClientEvents {
  roomState: (state: PublicGameState) => void;
  gameError: (error: GameErrorPayload) => void;
  roundFinished: (results: RoundResult[]) => void;
  matchFinished: (standings: MatchStanding[]) => void;
}

export interface ClientToServerEvents {
  joinRoom: (roomId: string, playerName: string, resumeToken?: string) => void;
  updateRules: (config: Partial<HouseRulesConfig>) => void;
  setRoundLimit: (limit: number | null) => void;
  startGame: () => void;
  playCards: (cardIds: string[], bindings?: JokerBinding[]) => void;
  pass: () => void;
  submit7Pass: (cardIds: string[]) => void;
  submit10Discard: (cardIds: string[]) => void;
  exchangeCards: (cardIds: string[]) => void;
}

export type ServerToClientEvent = keyof ServerToClientEvents;
export type ClientToServerEvent = keyof ClientToServerEvents;

/** Event names as values, for the server's dispatch table. Kept in step by a test. */
export const SERVER_TO_CLIENT_EVENTS = [
  "roomState",
  "gameError",
  "roundFinished",
  "matchFinished",
] as const satisfies readonly ServerToClientEvent[];

export const CLIENT_TO_SERVER_EVENTS = [
  "joinRoom",
  "updateRules",
  "setRoundLimit",
  "startGame",
  "playCards",
  "pass",
  "submit7Pass",
  "submit10Discard",
  "exchangeCards",
] as const satisfies readonly ClientToServerEvent[];

/** No server-to-server events; rooms live in one process per §14. */
export type InterServerEvents = Record<string, never>;

/**
 * What the server hangs off a socket. Socket id is not player id (§8.1): the
 * seat is resolved from `resumeToken` on join and kept here for the rest of the
 * connection.
 */
export interface SocketData {
  roomId: string | null;
  playerId: string | null;
  resumeToken: string | null;
}
