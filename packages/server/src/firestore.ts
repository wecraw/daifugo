/**
 * The deployed `RoomRepository` (§14): one Firestore document per room.
 *
 * Follows the pattern in `crossrace-server/firestore.js` — an explicit
 * `FIRESTORE_PROJECT_ID` is required in any deployed runtime rather than relying
 * on auto-detect, so a misconfigured deploy fails loudly at boot instead of
 * silently writing to the wrong project.
 *
 * Concurrency is a Firestore transaction with a compare-and-set on `stateVersion`
 * (§14): the transaction reads the room, the mutator computes the next state
 * (whose `stateVersion` the engine has already incremented, #8), and the write
 * commits only if the room has not changed underneath. A stale action loses and
 * Firestore retries the transaction against fresh state. The denormalized
 * `status` and `deadline` fields ride along on every write so the boot re-arm
 * (§14) can find rooms with a live deadline without deserializing every room.
 *
 * The emulator is wired in through `FIRESTORE_EMULATOR_HOST`, which the client
 * library honours automatically; `FIRESTORE_PROJECT_ID` is still required, so
 * local and CI runs pass a throwaway project id alongside the emulator host.
 */
import { Firestore, type Settings } from "@google-cloud/firestore";
import {
  ConcurrencyError,
  type ArmedRoom,
  MAX_CAS_ATTEMPTS,
  RoomExistsError,
  RoomNotFoundError,
  type RoomDoc,
  type RoomMutator,
  type RoomRepository,
} from "./repository.js";

/** Default collection holding one document per room. */
export const ROOMS_COLLECTION = "rooms";

/** The denormalized top-level field the boot re-arm queries on (§14). */
export const DEADLINE_FIELD = "deadline";

/**
 * The minimum of Firestore's `Query` the boot re-arm query needs, so
 * {@link armedRoomsQuery} can be built and asserted against a recording double
 * in a unit test rather than a live Firestore.
 */
export interface ArmedQuerySource<Q extends ArmedQuerySource<Q>> {
  where(field: string, op: ">", value: number): Q;
  select(...fields: string[]): Q;
}

/**
 * The boot re-arm query (§14): every room whose `deadline` is still set.
 *
 * Single-field, so the automatic index covers it — no `firestore.indexes.json`,
 * no composite index, no `FAILED_PRECONDITION` to handle.
 *
 * `> 0` rather than `!= null` is what expresses "non-null" here: a Firestore
 * range filter only matches values of the compared type, so nulls (and missing
 * fields) drop out, and a `deadline` is epoch ms and therefore always positive
 * when it is set at all.
 *
 * `select` projects to the one field the re-arm reads, so a restart never pulls a
 * whole serialized `GameState` over the wire; the room id comes from the document
 * id.
 */
export function armedRoomsQuery<Q extends ArmedQuerySource<Q>>(source: ArmedQuerySource<Q>): Q {
  return source.where(DEADLINE_FIELD, ">", 0).select(DEADLINE_FIELD);
}

/**
 * Construct a Firestore client, requiring an explicit project id (§14).
 *
 * `FIRESTORE_PROJECT_ID` is mandatory: auto-detect is convenient in a Google
 * runtime and a trap everywhere else, so this throws rather than guess.
 * `ignoreUndefinedProperties` lets the optional history fields (`visibleTo`,
 * `privateCardParams`, §2) serialize cleanly — Firestore rejects `undefined`
 * otherwise.
 */
export function createFirestore(overrides: Settings = {}): Firestore {
  const projectId = process.env.FIRESTORE_PROJECT_ID;
  if (projectId === undefined || projectId.trim() === "") {
    throw new Error(
      "FIRESTORE_PROJECT_ID is required. Set it explicitly rather than relying on " +
        "auto-detect (§14). For the local emulator, also set FIRESTORE_EMULATOR_HOST.",
    );
  }
  return new Firestore({ projectId, ignoreUndefinedProperties: true, ...overrides });
}

export class FirestoreRoomRepository implements RoomRepository {
  private readonly collection;

  constructor(
    private readonly db: Firestore,
    collectionName: string = ROOMS_COLLECTION,
  ) {
    this.collection = db.collection(collectionName);
  }

  async create(doc: RoomDoc): Promise<void> {
    const ref = this.collection.doc(doc.roomId);
    try {
      await ref.create(serialize(doc));
    } catch (error) {
      // Firestore surfaces an already-exists write as code 6 (ALREADY_EXISTS).
      if (isAlreadyExists(error)) throw new RoomExistsError(doc.roomId);
      throw error;
    }
  }

  async get(roomId: string): Promise<RoomDoc | null> {
    const snapshot = await this.collection.doc(roomId).get();
    const data = snapshot.data();
    return data === undefined ? null : (data as RoomDoc);
  }

  async listArmed(): Promise<ArmedRoom[]> {
    const snapshot = await armedRoomsQuery(this.collection).get();
    return snapshot.docs.map((doc) => ({
      roomId: doc.id,
      deadline: doc.get(DEADLINE_FIELD) as number,
    }));
  }

  async mutate(roomId: string, mutate: RoomMutator): Promise<RoomDoc> {
    const ref = this.collection.doc(roomId);
    // The transaction already gives read-your-write isolation and retries on
    // contention; the explicit CAS on `stateVersion` (§14) is what makes a stale
    // action a no-op even across a retry boundary, and keeps the InMemory and
    // Firestore repositories behaving identically.
    return this.db
      .runTransaction(
        async (tx): Promise<RoomDoc> => {
          const snapshot = await tx.get(ref);
          const current = snapshot.data() as RoomDoc | undefined;
          if (current === undefined) throw new RoomNotFoundError(roomId);

          const next = mutate(current);
          if (next === null) return current;

          tx.set(ref, serialize(next));
          return next;
        },
        { maxAttempts: MAX_CAS_ATTEMPTS },
      )
      .catch((error: unknown) => {
        if (error instanceof RoomNotFoundError) throw error;
        if (isAborted(error)) throw new ConcurrencyError(roomId);
        throw error;
      });
  }
}

/**
 * Firestore stores plain data; the `RoomDoc` already is plain, but history
 * entries are frozen and `structuredClone`-hostile spots do not exist here, so a
 * shallow structured copy is enough to hand the driver an unfrozen, plain object.
 */
function serialize(doc: RoomDoc): RoomDoc {
  return JSON.parse(JSON.stringify(doc)) as RoomDoc;
}

interface GrpcError {
  code?: number;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as GrpcError).code === 6;
}

function isAborted(error: unknown): boolean {
  // ABORTED (10) is what a transaction that exhausted its retries surfaces.
  return typeof error === "object" && error !== null && (error as GrpcError).code === 10;
}
