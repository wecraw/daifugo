/**
 * The persistence boundary (§14): one document per room, holding the serialized
 * `GameState` plus the small amount of server metadata the pure engine never
 * sees.
 *
 * State lives here, not in process memory, so a redeploy or a crash does not
 * destroy an in-flight match (§14). Every mutation goes through {@link
 * RoomRepository.mutate}, a read-modify-write that compare-and-sets on
 * `stateVersion` — a stale action loses the CAS and retries against fresh state.
 * `stateVersion` already increments on every applied action (#8), so no new
 * concurrency primitive is introduced.
 *
 * This module defines the contract and an in-memory implementation used by tests
 * and local runs without a Firestore. `firestore.ts` provides the deployed one.
 */
import type { GameState, GameStatus } from "@daifugo/core";

/**
 * One room's document.
 *
 * `state` is the authoritative game state, mutated only through the core engine.
 * The rest is server bookkeeping:
 *
 * - `tokens` maps each issued `resumeToken` to the player id it reclaims (§8.1).
 *   It lives in the doc, not in an instance, so a reconnect landing on a
 *   restarted process still resolves against a repository read (§12.4 test 25).
 * - `status`, `deadline`, and `stateVersion` are denormalized copies of the same
 *   fields inside `state`, lifted to the top level so the boot re-arm (#22) can
 *   query rooms with a live deadline without deserializing every room (§14).
 */
export interface RoomDoc {
  roomId: string;
  state: GameState;
  /** resumeToken -> playerId (§8.1). Persisted so reconnect is instance-agnostic. */
  tokens: Record<string, string>;
  /** Denormalized from `state.status`; queryable without reading `state` (§14). */
  status: GameStatus;
  /** Denormalized from `state.deadline`; what the boot re-arm queries on (§14). */
  deadline: number | null;
  /** Denormalized from `state.stateVersion`; the compare-and-set key. */
  stateVersion: number;
  /** Epoch ms of the last write. Diagnostics only. */
  updatedAt: number;
}

/** Rebuild the denormalized top-level fields from the state a mutation produced. */
export function withState(doc: RoomDoc, state: GameState, now: number): RoomDoc {
  return {
    ...doc,
    state,
    status: state.status,
    deadline: state.deadline,
    stateVersion: state.stateVersion,
    updatedAt: now,
  };
}

/** Thrown when a room code does not resolve. The socket layer maps it to `ROOM_NOT_FOUND`. */
export class RoomNotFoundError extends Error {
  constructor(readonly roomId: string) {
    super(`room not found: ${roomId}`);
    this.name = "RoomNotFoundError";
  }
}

/** Thrown when {@link RoomRepository.create} is asked to overwrite an existing room. */
export class RoomExistsError extends Error {
  constructor(readonly roomId: string) {
    super(`room already exists: ${roomId}`);
    this.name = "RoomExistsError";
  }
}

/**
 * A mutation of one room. Receives the current doc, returns the next one — or
 * `null` to signal "nothing changed", which writes nothing (a `TICK` before its
 * deadline is the canonical no-op, §7.6/§14).
 *
 * The function may run more than once: on a CAS conflict the repository re-reads
 * and re-applies it, so it must be a pure function of the doc it is handed and
 * must not close over a previously read state.
 */
export type RoomMutator = (doc: RoomDoc) => RoomDoc | null;

export interface RoomRepository {
  /** Create a room, failing with {@link RoomExistsError} if the code is taken. */
  create(doc: RoomDoc): Promise<void>;
  /** The room, or `null` if the code is unknown. */
  get(roomId: string): Promise<RoomDoc | null>;
  /**
   * Read-modify-write under a compare-and-set on `stateVersion` (§14).
   *
   * Reads the room, applies `mutate`, and writes the result only if the room has
   * not changed underneath — retrying against fresh state on conflict. Returns
   * the doc that ended up stored (the mutated one, or the unchanged one when
   * `mutate` returned `null`). Throws {@link RoomNotFoundError} if the room is
   * gone.
   */
  mutate(roomId: string, mutate: RoomMutator): Promise<RoomDoc>;
}

/** How many times a losing CAS is retried before giving up. */
export const MAX_CAS_ATTEMPTS = 8;

export class ConcurrencyError extends Error {
  constructor(readonly roomId: string) {
    super(`gave up after ${MAX_CAS_ATTEMPTS} contended writes to room: ${roomId}`);
    this.name = "ConcurrencyError";
  }
}

/* -------------------------------------------------------------------------- */
/* In-memory implementation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A `RoomRepository` backed by a `Map`, for tests and for local runs without a
 * Firestore.
 *
 * It implements the same compare-and-set contract the Firestore one gets from a
 * transaction, by hand: `mutate` snapshots `stateVersion`, applies the mutator,
 * and only commits if the stored version still matches the snapshot. A test can
 * therefore inject a concurrent write (via {@link onBeforeCommit}) and watch the
 * losing writer re-read and retry, exactly as two Cloud Run instances contending
 * on one Firestore would (§14).
 *
 * Stored docs are deep-cloned on the way in and out, so a caller mutating what it
 * reads cannot reach into the store — the same isolation a serialization boundary
 * gives the Firestore impl for free.
 */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomDoc>();

  /**
   * Test seam: invoked after a mutator computes its result but before the CAS
   * check, so a test can simulate another instance writing in between. Runs at
   * most once per `mutate` call to avoid an infinite injected-conflict loop.
   */
  onBeforeCommit?: (roomId: string) => void | Promise<void>;

  async create(doc: RoomDoc): Promise<void> {
    if (this.rooms.has(doc.roomId)) throw new RoomExistsError(doc.roomId);
    this.rooms.set(doc.roomId, clone(doc));
  }

  async get(roomId: string): Promise<RoomDoc | null> {
    const doc = this.rooms.get(roomId);
    return doc === undefined ? null : clone(doc);
  }

  async mutate(roomId: string, mutate: RoomMutator): Promise<RoomDoc> {
    let hook = this.onBeforeCommit;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = this.rooms.get(roomId);
      if (current === undefined) throw new RoomNotFoundError(roomId);

      const expectedVersion = current.stateVersion;
      const next = mutate(clone(current));
      if (next === null) return clone(current);

      // The injected conflict fires once, then is cleared, so the retry lands.
      if (hook !== undefined) {
        await hook(roomId);
        hook = undefined;
      }

      const stored = this.rooms.get(roomId);
      if (stored === undefined) throw new RoomNotFoundError(roomId);
      if (stored.stateVersion === expectedVersion) {
        this.rooms.set(roomId, clone(next));
        return clone(next);
      }
      // Lost the CAS: someone wrote a newer version. Re-read and retry.
    }
    throw new ConcurrencyError(roomId);
  }

  /** Test/diagnostic helper: how many rooms are stored. */
  size(): number {
    return this.rooms.size;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
