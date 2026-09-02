/**
 * Room creation, joining, reconnect, and the server-authoritative action loop
 * (§8). Every read and write goes through a {@link RoomRepository}, so no game
 * state is ever held in process memory and two instances pointed at one Firestore
 * serve the same room identically (§14).
 *
 * The manager is deliberately socket-agnostic: it takes a repository, a
 * {@link Scheduler}, and an `onUpdate` broadcast hook, and exposes plain async
 * methods. The Socket.IO layer (`room.ts`, `index.ts`) wires those methods to
 * events and turns `onUpdate` into per-recipient `roomState` broadcasts. Tests
 * drive the manager directly against an in-memory repository and a manual clock.
 */
import {
  applyAction,
  createGameState,
  err,
  ok,
  queueJoin,
  queueLeave,
  stampDeadline,
  type ClientAction,
  type ErrorCode,
  type GameState,
  type HouseRulesConfig,
  type JokerBinding,
  type Player,
  type Result,
} from "@daifugo/core";
import {
  generateGameSeed,
  generateJoinCode,
  generatePlayerId,
  generateResumeToken,
} from "./ids.js";
import {
  RoomExistsError,
  RoomNotFoundError,
  withState,
  type RoomDoc,
  type RoomRepository,
} from "./repository.js";
import { DISCONNECT_GRACE_MS, deadlineKey, graceKey, type Scheduler } from "./timers.js";

/** The seat a `join` resolved to (§8.1), returned so the socket can issue `joined`. */
export interface JoinOutcome {
  playerId: string;
  resumeToken: string;
  /** True when the token reclaimed an existing seat rather than taking a new one. */
  reconnected: boolean;
}

export interface RoomManagerOptions {
  repo: RoomRepository;
  scheduler: Scheduler;
  /**
   * Called with the freshly stored doc after every write (and after a reconnect
   * even when nothing changed), so the socket layer can broadcast. Kept optional
   * so tests can inspect the repository directly instead.
   */
  onUpdate?: (doc: RoomDoc) => void | Promise<void>;
  config?: Readonly<HouseRulesConfig>;
}

export class RoomManager {
  private readonly repo: RoomRepository;
  private readonly scheduler: Scheduler;
  private readonly onUpdate?: (doc: RoomDoc) => void | Promise<void>;
  private readonly config?: Readonly<HouseRulesConfig>;

  constructor(options: RoomManagerOptions) {
    this.repo = options.repo;
    this.scheduler = options.scheduler;
    this.onUpdate = options.onUpdate;
    this.config = options.config;
  }

  /* ---------------------------------------------------------------------- */
  /* Creation                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Create an empty room and return its short join code (§8). The room starts in
   * `LOBBY` with no players and no host; the first `join` seats the host (§8.2).
   *
   * Codes are minted with the CSPRNG (`ids.ts`) and retried on the vanishingly
   * rare collision, so uniqueness is enforced by the repository's `create`
   * rather than assumed.
   */
  async createRoom(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const roomId = generateJoinCode();
      const now = this.scheduler.now();
      const state = createGameState({ roomId, hostId: "", players: [], config: this.config });
      const doc: RoomDoc = {
        roomId,
        state,
        tokens: {},
        status: state.status,
        deadline: state.deadline,
        stateVersion: state.stateVersion,
        updatedAt: now,
      };
      try {
        await this.repo.create(doc);
        return roomId;
      } catch (error) {
        if (error instanceof RoomExistsError) continue;
        throw error;
      }
    }
    throw new Error("failed to allocate a unique room code");
  }

  /* ---------------------------------------------------------------------- */
  /* Joining and reconnect (§8.1, §8.2)                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Join a room, either taking a new seat or reclaiming one with a `resumeToken`
   * (§8.1).
   *
   * The whole decision runs inside the repository's compare-and-set transaction
   * against a fresh read, so a reconnect landing on a restarted process resolves
   * purely from the stored token map — never from in-process state (§12.4 test
   * 25). A fresh join mints a new player id and token; the first player to seat
   * becomes host (§8.2).
   */
  async join(
    roomId: string,
    playerName: string,
    resumeToken?: string,
  ): Promise<Result<JoinOutcome, ErrorCode>> {
    let captured: Result<JoinOutcome, ErrorCode> | null = null;

    let doc: RoomDoc;
    try {
      doc = await this.repo.mutate(roomId, (current) => {
        const decided = this.decideJoin(current, playerName, resumeToken);
        captured = decided.outcome;
        return decided.next;
      });
    } catch (error) {
      if (error instanceof RoomNotFoundError) return err("ROOM_NOT_FOUND");
      throw error;
    }

    const outcome = captured as Result<JoinOutcome, ErrorCode> | null;
    if (outcome === null || !outcome.ok) return outcome ?? err("INVALID_ACTION");

    // A reclaimed seat cancels the pending grace timer and the player is live
    // again; a fresh seat has none to cancel.
    if (outcome.value.reconnected) this.scheduler.clear(graceKey(roomId, outcome.value.playerId));
    this.arm(doc);
    await this.emit(doc);
    return outcome;
  }

  /**
   * Pure decision for one `join` attempt: given the current doc, produce the next
   * doc (or `null` for no write) and the outcome to return.
   *
   * Re-runnable on a CAS retry (`ids` are re-minted, which is harmless — only the
   * committed run's values are returned), so it closes over nothing but its
   * arguments.
   */
  private decideJoin(
    doc: RoomDoc,
    playerName: string,
    resumeToken?: string,
  ): { next: RoomDoc | null; outcome: Result<JoinOutcome, ErrorCode> } {
    const now = this.scheduler.now();

    // Reconnect: a known token whose player still holds a seat and has not left.
    if (resumeToken !== undefined) {
      const playerId = doc.tokens[resumeToken];
      if (playerId !== undefined && this.isReclaimable(doc.state, playerId)) {
        const reconnected = setConnected(doc.state, playerId, true);
        const outcome = ok({ playerId, resumeToken, reconnected: true });
        // Already-connected reconnect is a no-op write but still a valid resume.
        if (reconnected === null) return { next: null, outcome };
        return { next: withState(doc, reconnected, now), outcome };
      }
    }

    // Fresh seat.
    const playerId = generatePlayerId();
    const token = generateResumeToken();
    const player: Player = {
      id: playerId,
      name: playerName,
      role: null,
      seatIndex: doc.state.players.length,
      isReady: false,
      isConnected: true,
    };

    const joined = queueJoin(doc.state, player);
    if (!joined.ok) return { next: null, outcome: joined };

    // The first player to seat is host (§8.2). A fresh room carries `hostId ""`.
    let state = joined.value;
    if (state.hostId === "") state = { ...state, hostId: playerId };

    const next: RoomDoc = {
      ...withState(doc, state, now),
      tokens: { ...doc.tokens, [token]: playerId },
    };
    return { next, outcome: ok({ playerId, resumeToken: token, reconnected: false }) };
  }

  /** A seat is reclaimable while its player is still seated and not leaving (§8.1). */
  private isReclaimable(state: GameState, playerId: string): boolean {
    if (state.pendingLeaves.includes(playerId)) return false;
    return (
      state.players.some((p) => p.id === playerId) ||
      state.pendingJoins.some((p) => p.id === playerId)
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Action loop (§8.4)                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Apply a `ClientAction` under the repository CAS, stamp the deadline, arm the
   * fast-path timer, and broadcast (§8.4). `START_GAME` never arrives here — its
   * seed is server-minted, so callers use {@link startGame}.
   */
  async dispatch(
    roomId: string,
    playerId: string,
    action: ClientAction,
  ): Promise<Result<GameState, ErrorCode>> {
    let captured: Result<GameState, ErrorCode> | null = null;

    let doc: RoomDoc;
    try {
      doc = await this.repo.mutate(roomId, (current) => {
        const applied = applyAction(current.state, action, playerId);
        captured = applied;
        if (!applied.ok) return null;
        // A no-op action (an early `TICK`) leaves `stateVersion` untouched and
        // writes nothing (§7.6/§14).
        if (applied.value.stateVersion === current.state.stateVersion) return null;
        // `TICK` computes its own next deadline off the one that expired (§14);
        // every other action commits with a null deadline for the server to
        // stamp here (§8.4 step 5).
        const state =
          action.type === "TICK"
            ? applied.value
            : stampDeadline(applied.value, this.scheduler.now());
        captured = ok(state);
        return withState(current, state, this.scheduler.now());
      });
    } catch (error) {
      if (error instanceof RoomNotFoundError) return err("ROOM_NOT_FOUND");
      throw error;
    }

    const result = captured as Result<GameState, ErrorCode> | null;
    if (result === null) return err("INVALID_ACTION");
    if (result.ok) {
      this.arm(doc);
      await this.emit(doc);
    }
    return result;
  }

  /**
   * Start the game (§8.2). Host-only, enforced by the engine; the seed is minted
   * here with the CSPRNG and persisted with the dealt state, so any instance
   * rebuilds the same deal (§2, §14).
   */
  async startGame(roomId: string, playerId: string): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "START_GAME", seed: generateGameSeed() });
  }

  updateRules(
    roomId: string,
    playerId: string,
    config: Partial<HouseRulesConfig>,
  ): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "UPDATE_RULES", config });
  }

  setRoundLimit(
    roomId: string,
    playerId: string,
    limit: number | null,
  ): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "SET_ROUND_LIMIT", limit });
  }

  playCards(
    roomId: string,
    playerId: string,
    cardIds: string[],
    bindings?: JokerBinding[],
  ): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "PLAY_CARDS", cardIds, bindings });
  }

  pass(roomId: string, playerId: string): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "PASS" });
  }

  submit7Pass(
    roomId: string,
    playerId: string,
    cardIds: string[],
  ): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "SUBMIT_7_PASS", cardIds });
  }

  submit10Discard(
    roomId: string,
    playerId: string,
    cardIds: string[],
  ): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "SUBMIT_10_DISCARD", cardIds });
  }

  exchangeCards(
    roomId: string,
    playerId: string,
    cardIds: string[],
  ): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, playerId, { type: "EXCHANGE_CARDS", cardIds });
  }

  /**
   * Inject a `TICK` (§7.6). Called by the armed deadline timer and, in
   * production, by the boot re-arm (§14). Idempotent before the deadline: the engine
   * returns the same state and nothing is written.
   */
  tick(roomId: string, now: number = this.scheduler.now()): Promise<Result<GameState, ErrorCode>> {
    return this.dispatch(roomId, TICK_ACTOR, { type: "TICK", now });
  }

  /* ---------------------------------------------------------------------- */
  /* Connection lifecycle (§8.3)                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Mark a player disconnected and start the 30s seat-removal grace (§8.3). Turn
   * timers keep running for them in the meantime, so they auto-pass on schedule
   * and the table never stalls.
   */
  async disconnect(roomId: string, playerId: string): Promise<void> {
    let changed = false;
    let doc: RoomDoc;
    try {
      doc = await this.repo.mutate(roomId, (current) => {
        const state = setConnected(current.state, playerId, false);
        if (state === null) return null;
        changed = true;
        return withState(current, state, this.scheduler.now());
      });
    } catch (error) {
      if (error instanceof RoomNotFoundError) return;
      throw error;
    }

    this.scheduler.set(graceKey(roomId, playerId), DISCONNECT_GRACE_MS, () =>
      this.expireGrace(roomId, playerId),
    );
    if (changed) await this.emit(doc);
  }

  /**
   * Grace expired without a reconnect: remove the seat (§8.3). `queueLeave`
   * transfers the host if it was them (§8.2) and, mid-round, drops them to last
   * place (§7.7) — all in the engine, under the same CAS.
   */
  private async expireGrace(roomId: string, playerId: string): Promise<void> {
    let removed = false;
    let doc: RoomDoc;
    try {
      doc = await this.repo.mutate(roomId, (current) => {
        // Reconnected during the window: nothing to remove.
        const player = current.state.players.find((p) => p.id === playerId);
        if (player !== undefined && player.isConnected) return null;

        const left = queueLeave(current.state, playerId);
        if (!left.ok || left.value.stateVersion === current.state.stateVersion) return null;
        removed = true;
        const state = stampDeadline(left.value, this.scheduler.now());
        return withState(current, state, this.scheduler.now());
      });
    } catch (error) {
      if (error instanceof RoomNotFoundError) return;
      throw error;
    }

    if (removed) {
      this.arm(doc);
      await this.emit(doc);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Boot re-arm (§14)                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Re-arm every room that had a deadline pending when the previous process died
   * (§14). Called once at startup: the fast-path `setTimeout` dies with the
   * process, so without this a redeploy or a crash strands an in-flight turn and
   * the table hangs forever.
   *
   * Unconditional by design. A re-armed timer racing a live one is harmless — a
   * `TICK` before its deadline is a no-op (§7.6) and the commit is a
   * `stateVersion` CAS, so at most one transition lands per deadline — and a
   * deadline already in the past arms with a non-positive delay, which both
   * schedulers fire promptly rather than skip.
   *
   * Returns how many rooms were armed, for the boot log.
   */
  async rearmAll(): Promise<number> {
    const armed = await this.repo.listArmed();
    for (const room of armed) this.armDeadline(room.roomId, room.deadline);
    return armed.length;
  }

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                  */
  /* ---------------------------------------------------------------------- */

  /** The current doc, or `null` if the code is unknown. */
  get(roomId: string): Promise<RoomDoc | null> {
    return this.repo.get(roomId);
  }

  /* ---------------------------------------------------------------------- */
  /* Timer + broadcast plumbing                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Arm or clear the fast-path deadline timer for a room off its stored deadline
   * (§14). A state with no deadline (LOBBY, ROUND_END, MATCH_END) clears it.
   */
  private arm(doc: RoomDoc): void {
    this.armDeadline(doc.roomId, doc.state.deadline);
  }

  /**
   * Arm (or, for a null deadline, clear) one room's deadline timer.
   *
   * The `TICK` it injects carries the deadline that expired, not the wall clock
   * at firing: the engine measures the next deadline off the one that expired
   * (§7.6), so a timer that fires late — a re-armed one for a deadline already in
   * the past, say — lands the same transition a punctual one would have.
   */
  private armDeadline(roomId: string, deadline: number | null): void {
    const key = deadlineKey(roomId);
    if (deadline === null) {
      this.scheduler.clear(key);
      return;
    }
    this.scheduler.set(key, deadline - this.scheduler.now(), async () => {
      await this.tick(roomId, deadline);
    });
  }

  private async emit(doc: RoomDoc): Promise<void> {
    if (this.onUpdate !== undefined) await this.onUpdate(doc);
  }
}

/**
 * The actor id a server-injected `TICK` is dispatched under. `TICK` ignores its
 * player id (it carries time, not a seat, §7.6), so a sentinel that can never be
 * a real player id keeps the intent explicit.
 */
const TICK_ACTOR = "@server/tick";

/**
 * Flip one player's `isConnected`, bumping `stateVersion` (§2: never write state
 * without bumping it). Returns `null` when the flag already holds, so a duplicate
 * connect/disconnect writes nothing.
 *
 * Connection is server metadata the pure engine never reads (turn timers run
 * regardless of it, §8.3), but it rides on `Player` so the broadcast carries it,
 * so the manager owns this one narrow write outside `applyAction`.
 */
function setConnected(state: GameState, playerId: string, connected: boolean): GameState | null {
  const index = state.players.findIndex((p) => p.id === playerId);
  if (index === -1) return null;
  if (state.players[index]!.isConnected === connected) return null;
  const players = state.players.map((p, i) => (i === index ? { ...p, isConnected: connected } : p));
  return { ...state, players, stateVersion: state.stateVersion + 1 };
}
