/**
 * Firestore repository against the emulator (§14).
 *
 * Skipped unless `FIRESTORE_EMULATOR_HOST` is set, so a plain `npm test` needs no
 * Java: run it via `npm run test:emulator` (or in CI) which starts the emulator
 * first. When it does run it exercises the real `FirestoreRoomRepository` — the
 * `create`/`get` round trip, the `stateVersion` compare-and-set that makes two
 * instances safe, and the denormalized `status`/`deadline` fields the sweeper
 * (#22) will index.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAction, createGameState, type GameState, type Player } from "@daifugo/core";
import { RoomExistsError, RoomNotFoundError, withState, type RoomDoc } from "../src/repository.js";
import { createFirestore, FirestoreRoomRepository } from "../src/firestore.js";
import type { Firestore } from "@google-cloud/firestore";

const emulatorOn = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
// The client requires an explicit project id even against the emulator (§14).
process.env.FIRESTORE_PROJECT_ID ??= "daifugo-emulator-test";

function seedDoc(roomId: string): RoomDoc {
  const state = createGameState({
    roomId,
    hostId: "host",
    players: [
      { id: "host", name: "Will", role: null, seatIndex: 0, isReady: false, isConnected: true },
    ],
  });
  return {
    roomId,
    state,
    tokens: { "token-1": "host" },
    status: state.status,
    deadline: state.deadline,
    stateVersion: state.stateVersion,
    updatedAt: 0,
  };
}

function bump(state: GameState): GameState {
  return { ...state, status: "IN_PROGRESS", deadline: 123, stateVersion: state.stateVersion + 1 };
}

/** A fully dealt round-1 state: hands, a history log, jokers — the real payload. */
function dealtState(roomId: string): GameState {
  const players: Player[] = ["a", "b", "c"].map((id, seatIndex) => ({
    id,
    name: id.toUpperCase(),
    role: null,
    seatIndex,
    isReady: false,
    isConnected: true,
  }));
  const lobby = createGameState({ roomId, hostId: "a", players });
  const started = applyAction(lobby, { type: "START_GAME", seed: "emulator-seed" }, "a");
  if (!started.ok) throw new Error(`could not deal: ${started.error}`);
  return started.value;
}

describe.skipIf(!emulatorOn)("FirestoreRoomRepository against the emulator (§14)", () => {
  let db: Firestore;
  let repo: FirestoreRoomRepository;

  beforeAll(() => {
    db = createFirestore();
    repo = new FirestoreRoomRepository(db, `rooms-test-${Date.now()}`);
  });

  afterAll(async () => {
    await db.terminate();
  });

  it("round-trips a room and denormalizes status and deadline", async () => {
    const doc = seedDoc("ALPHA1");
    await repo.create(doc);

    const read = await repo.get("ALPHA1");
    expect(read?.roomId).toBe("ALPHA1");
    expect(read?.tokens["token-1"]).toBe("host");
    expect(read?.status).toBe("LOBBY");
    expect(read?.state.hostId).toBe("host");
  });

  it("refuses to overwrite an existing room", async () => {
    await repo.create(seedDoc("ALPHA2"));
    await expect(repo.create(seedDoc("ALPHA2"))).rejects.toBeInstanceOf(RoomExistsError);
  });

  it("throws RoomNotFoundError when mutating a missing room", async () => {
    await expect(repo.mutate("NOPE99", (d) => d)).rejects.toBeInstanceOf(RoomNotFoundError);
  });

  it("applies a mutation and lifts the new status/deadline to the top level", async () => {
    await repo.create(seedDoc("ALPHA3"));
    const written = await repo.mutate("ALPHA3", (d) => withState(d, bump(d.state), 5));

    expect(written.status).toBe("IN_PROGRESS");
    expect(written.deadline).toBe(123);
    const read = await repo.get("ALPHA3");
    expect(read?.status).toBe("IN_PROGRESS");
    expect(read?.deadline).toBe(123);
    expect(read?.stateVersion).toBe(read?.state.stateVersion);
  });

  it("serializes concurrent writes under the transaction CAS", async () => {
    await repo.create(seedDoc("ALPHA4"));
    // Five increments racing on one doc must all land: the transaction retries
    // the losers against fresh state, so the final version reflects every write
    // (§14). Emulator contention is slow, hence the generous timeout.
    const writes = 5;
    await Promise.all(
      Array.from({ length: writes }, () =>
        repo.mutate("ALPHA4", (d) => withState(d, bump(d.state), 0)),
      ),
    );
    const read = await repo.get("ALPHA4");
    expect(read?.state.stateVersion).toBe(writes);
  }, 20_000);

  it("returns the unchanged doc when the mutator is a no-op", async () => {
    await repo.create(seedDoc("ALPHA5"));
    const result = await repo.mutate("ALPHA5", () => null);
    expect(result.status).toBe("LOBBY");
    expect(result.stateVersion).toBe(0);
  });

  it("round-trips a fully dealt state — hands, history, and card conservation", async () => {
    const state = dealtState("ALPHA6");
    const base = seedDoc("ALPHA6");
    await repo.create({ ...base, tokens: { "t-a": "a" } });
    await repo.mutate("ALPHA6", (d) => withState(d, state, 7));

    const read = await repo.get("ALPHA6");
    expect(read).not.toBeNull();
    const stored = read!.state;

    // Every hand survives intact, and the deck is still whole through the
    // serialization boundary (§12.3 invariant, checked after a Firestore trip).
    const inHands = Object.values(stored.hands).reduce((n, hand) => n + hand.length, 0);
    expect(inHands + stored.currentTrick.length + stored.graveyard.length).toBe(54);
    expect(stored.hands["a"]!.length).toBe(state.hands["a"]!.length);
    // History entries keep their key and params (no bare strings, §11).
    expect(stored.history.length).toBe(state.history.length);
    expect(stored.history[0]!.key).toBe(state.history[0]!.key);
    expect(read!.status).toBe("IN_PROGRESS");
  });
});
