/**
 * §12.4 server acceptance, at the manager level: reconnect (25), host-only
 * rejection (26), and host transfer on disconnect (27).
 *
 * The manager holds no game state — everything is read from and written to a
 * `RoomRepository` — so these tests exercise the real thing against an in-memory
 * repository and a manual clock. Test 25 goes further and drives the reconnect
 * from a *second* manager instance sharing the one repository, which is exactly
 * the "different instance" the spec calls out: it can only resolve the seat from
 * a repository read, never from in-process state (§8.1, §14).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { isOk, type ErrorCode } from "@daifugo/core";
import { RoomManager, type JoinOutcome } from "../src/roomManager.js";
import { InMemoryRoomRepository, type RoomDoc } from "../src/repository.js";
import { DISCONNECT_GRACE_MS, ManualScheduler, graceKey } from "../src/timers.js";

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: ErrorCode }): T {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error}`);
  return result.value;
}

async function seatPlayer(
  manager: RoomManager,
  roomId: string,
  name: string,
): Promise<JoinOutcome> {
  return unwrap(await manager.join(roomId, name));
}

describe("RoomManager acceptance (§12.4)", () => {
  let repo: InMemoryRoomRepository;
  let scheduler: ManualScheduler;
  let manager: RoomManager;

  beforeEach(() => {
    repo = new InMemoryRoomRepository();
    scheduler = new ManualScheduler(1_000);
    manager = new RoomManager({ repo, scheduler });
  });

  async function docOf(roomId: string): Promise<RoomDoc> {
    const doc = await repo.get(roomId);
    expect(doc).not.toBeNull();
    return doc!;
  }

  /* ---------------------------------------------------------------------- */
  /* Test 25: reconnect reclaims the correct seat via resumeToken           */
  /* ---------------------------------------------------------------------- */

  it("reclaims the same seat when a resumeToken is replayed (test 25)", async () => {
    const roomId = await manager.createRoom();
    const host = await seatPlayer(manager, roomId, "Will");
    await seatPlayer(manager, roomId, "Alex");
    await seatPlayer(manager, roomId, "Sam");

    // A resume with the issued token returns the same seat, not a new one.
    const resumed = unwrap(await manager.join(roomId, "Will", host.resumeToken));
    expect(resumed.reconnected).toBe(true);
    expect(resumed.playerId).toBe(host.playerId);
    expect(resumed.resumeToken).toBe(host.resumeToken);

    const doc = await docOf(roomId);
    expect(doc.state.players).toHaveLength(3);
    expect(doc.state.players.filter((p) => p.id === host.playerId)).toHaveLength(1);
  });

  it("resolves a reconnect on a different instance from the repository, not memory (test 25)", async () => {
    // Instance A seats the host and issues the token.
    const roomId = await manager.createRoom();
    const host = await seatPlayer(manager, roomId, "Will");
    await seatPlayer(manager, roomId, "Alex");
    await seatPlayer(manager, roomId, "Sam");

    // The host drops; instance A marks them disconnected and arms grace.
    await manager.disconnect(roomId, host.playerId);
    expect(
      (await docOf(roomId)).state.players.find((p) => p.id === host.playerId)!.isConnected,
    ).toBe(false);

    // A *second* manager instance — a different Cloud Run instance — shares only
    // the repository. It never saw the join, so resolving the token proves the
    // seat came from a repository read (§8.1, §14).
    const instanceB = new RoomManager({ repo, scheduler: new ManualScheduler(5_000) });
    const resumed = unwrap(await instanceB.join(roomId, "Will", host.resumeToken));

    expect(resumed.reconnected).toBe(true);
    expect(resumed.playerId).toBe(host.playerId);
    const doc = await docOf(roomId);
    expect(doc.state.players.find((p) => p.id === host.playerId)!.isConnected).toBe(true);
  });

  it("issues a distinct seat and token to each fresh joiner", async () => {
    const roomId = await manager.createRoom();
    const a = await seatPlayer(manager, roomId, "Will");
    const b = await seatPlayer(manager, roomId, "Alex");

    expect(a.playerId).not.toBe(b.playerId);
    expect(a.resumeToken).not.toBe(b.resumeToken);
    expect(a.reconnected).toBe(false);
    expect(b.reconnected).toBe(false);
  });

  it("falls back to a fresh seat when the resumeToken is unknown", async () => {
    const roomId = await manager.createRoom();
    await seatPlayer(manager, roomId, "Will");
    const stranger = unwrap(await manager.join(roomId, "Nobody", "not-a-real-token"));
    expect(stranger.reconnected).toBe(false);
    expect((await docOf(roomId)).state.players).toHaveLength(2);
  });

  it("rejects a join to an unknown room with ROOM_NOT_FOUND", async () => {
    const result = await manager.join("ZZZZZZ", "Will");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ROOM_NOT_FOUND");
  });

  /* ---------------------------------------------------------------------- */
  /* Test 26: non-host updateRules and startGame are rejected               */
  /* ---------------------------------------------------------------------- */

  it("rejects updateRules and startGame from a non-host (test 26)", async () => {
    const roomId = await manager.createRoom();
    const host = await seatPlayer(manager, roomId, "Will");
    const other = await seatPlayer(manager, roomId, "Alex");
    await seatPlayer(manager, roomId, "Sam");

    const badRules = await manager.updateRules(roomId, other.playerId, { shibari: false });
    expect(badRules.ok).toBe(false);
    if (!badRules.ok) expect(badRules.error).toBe("NOT_HOST");

    const badStart = await manager.startGame(roomId, other.playerId);
    expect(badStart.ok).toBe(false);
    if (!badStart.ok) expect(badStart.error).toBe("NOT_HOST");

    // The host is accepted, so the rejection is about identity, not the action.
    const goodRules = await manager.updateRules(roomId, host.playerId, { shibari: false });
    expect(goodRules.ok).toBe(true);
    expect((await docOf(roomId)).state.config.shibari).toBe(false);

    const started = await manager.startGame(roomId, host.playerId);
    expect(started.ok).toBe(true);
    expect((await docOf(roomId)).state.status).toBe("IN_PROGRESS");
  });

  it("makes the first joiner host and no one else (test 26)", async () => {
    const roomId = await manager.createRoom();
    const host = await seatPlayer(manager, roomId, "Will");
    await seatPlayer(manager, roomId, "Alex");
    expect((await docOf(roomId)).state.hostId).toBe(host.playerId);
  });

  /* ---------------------------------------------------------------------- */
  /* Test 27: host transfer on disconnect                                   */
  /* ---------------------------------------------------------------------- */

  it("transfers the host to the longest-seated player after the grace expires (test 27)", async () => {
    const roomId = await manager.createRoom();
    const host = await seatPlayer(manager, roomId, "Will");
    const heir = await seatPlayer(manager, roomId, "Alex");
    await seatPlayer(manager, roomId, "Sam");

    await manager.disconnect(roomId, host.playerId);

    // Before the grace expires the host is unchanged and still seated (§8.3).
    await scheduler.advance(DISCONNECT_GRACE_MS - 1);
    expect((await docOf(roomId)).state.hostId).toBe(host.playerId);

    // Crossing the grace removes the seat and hands the room to the next-seated
    // connected player (§8.2).
    await scheduler.advance(1);
    const doc = await docOf(roomId);
    expect(doc.state.hostId).toBe(heir.playerId);
    expect(doc.state.players.some((p) => p.id === host.playerId)).toBe(false);
    expect(doc.state.players).toHaveLength(2);
  });

  it("keeps the host if they reconnect within the grace window (test 27)", async () => {
    const roomId = await manager.createRoom();
    const host = await seatPlayer(manager, roomId, "Will");
    await seatPlayer(manager, roomId, "Alex");
    await seatPlayer(manager, roomId, "Sam");

    await manager.disconnect(roomId, host.playerId);
    expect(scheduler.has(graceKey(roomId, host.playerId))).toBe(true);

    // They come back before the timer fires: the grace is cancelled.
    await scheduler.advance(DISCONNECT_GRACE_MS - 5_000);
    const resumed = unwrap(await manager.join(roomId, "Will", host.resumeToken));
    expect(resumed.reconnected).toBe(true);
    expect(scheduler.has(graceKey(roomId, host.playerId))).toBe(false);

    // Advancing past the original deadline no longer removes them.
    await scheduler.advance(DISCONNECT_GRACE_MS);
    const doc = await docOf(roomId);
    expect(doc.state.hostId).toBe(host.playerId);
    expect(doc.state.players).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Two instances on one repository behave as one room (§14 acceptance)        */
/* -------------------------------------------------------------------------- */

describe("interchangeable instances (§14)", () => {
  it("applies actions from either instance under the stateVersion CAS", async () => {
    const repo = new InMemoryRoomRepository();
    const instanceA = new RoomManager({ repo, scheduler: new ManualScheduler() });
    const instanceB = new RoomManager({ repo, scheduler: new ManualScheduler() });

    const roomId = await instanceA.createRoom();
    const host = unwrap(await instanceA.join(roomId, "Will"));
    unwrap(await instanceB.join(roomId, "Alex"));
    unwrap(await instanceA.join(roomId, "Sam"));

    // The host action can be served by the instance that did not seat them.
    const started = await instanceB.startGame(roomId, host.playerId);
    expect(started.ok).toBe(true);

    const seen = await repo.get(roomId);
    expect(seen?.state.status).toBe("IN_PROGRESS");
    // stateVersion strictly increased across the interleaved writes (§2).
    expect(seen!.stateVersion).toBeGreaterThan(0);
    expect(seen!.stateVersion).toBe(seen!.state.stateVersion);
  });

  it("makes a losing writer retry against fresh state on a CAS conflict", async () => {
    const repo = new InMemoryRoomRepository();
    const scheduler = new ManualScheduler();
    const manager = new RoomManager({ repo, scheduler });
    const roomId = await manager.createRoom();
    const host = unwrap(await manager.join(roomId, "Will"));
    unwrap(await manager.join(roomId, "Alex"));
    unwrap(await manager.join(roomId, "Sam"));

    // Inject a concurrent host action in the middle of the next mutation, so the
    // first computed write loses the CAS and must re-read and retry (§14).
    let conflictInjected = false;
    repo.onBeforeCommit = async () => {
      repo.onBeforeCommit = undefined; // fire once; the injected write must not re-trigger it
      conflictInjected = true;
      await manager.updateRules(roomId, host.playerId, { fiveSkip: false });
    };

    const result = await manager.updateRules(roomId, host.playerId, { shibari: false });
    expect(result.ok).toBe(true);
    expect(conflictInjected).toBe(true);

    // Both writes survived: the retry rebased onto the injected one.
    const doc = await repo.get(roomId);
    expect(doc!.state.config.shibari).toBe(false);
    expect(doc!.state.config.fiveSkip).toBe(false);
    expect(isOk(result)).toBe(true);
  });
});
