/**
 * §12.4 test 30b — the boot re-arm (§14).
 *
 * The fast-path `setTimeout` dies with the process, so a redeploy or a crash
 * would strand an in-flight turn and hang the table. Startup queries the rooms
 * with a live `deadline` and arms each one.
 *
 * The restart is modelled the way the reconnect tests model theirs: a *second*
 * `RoomManager` on a fresh clock, sharing only the repository, so nothing it does
 * can come from in-process state. The query itself is asserted separately against
 * a recording double, so its shape is pinned without a live Firestore.
 */
import { describe, expect, it, vi } from "vitest";
import { TURN_DURATION_MS, type ErrorCode } from "@daifugo/core";
import { RoomManager } from "../src/roomManager.js";
import { InMemoryRoomRepository, withState } from "../src/repository.js";
import { ManualScheduler, RealScheduler, deadlineKey } from "../src/timers.js";
import { DEADLINE_FIELD, armedRoomsQuery, type ArmedQuerySource } from "../src/firestore.js";

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: ErrorCode }): T {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error}`);
  return result.value;
}

/** Create a room, seat three players, and deal — leaving a live turn deadline. */
async function startedRoom(manager: RoomManager): Promise<string> {
  const roomId = await manager.createRoom();
  const host = unwrap(await manager.join(roomId, "Will"));
  unwrap(await manager.join(roomId, "Alex"));
  unwrap(await manager.join(roomId, "Sam"));
  unwrap(await manager.startGame(roomId, host.playerId));
  return roomId;
}

describe("boot re-arm (§14, test 30b)", () => {
  it("fires a past deadline promptly and arms a future one", async () => {
    const repo = new InMemoryRoomRepository();
    const before = new ManualScheduler(1_000);
    const dying = new RoomManager({ repo, scheduler: before });

    // Room A's turn is dealt at t=1_000, so its deadline lands at t=61_000.
    const roomA = await startedRoom(dying);
    // Room B is dealt later, at t=50_000, so its deadline lands at t=110_000.
    await before.advance(49_000);
    const roomB = await startedRoom(dying);
    // Room C never left the lobby: no deadline, nothing to re-arm.
    const roomC = await dying.createRoom();

    const docA = (await repo.get(roomA))!;
    const docB = (await repo.get(roomB))!;
    expect(docA.deadline).toBe(1_000 + TURN_DURATION_MS);
    expect(docB.deadline).toBe(50_000 + TURN_DURATION_MS);
    expect((await repo.get(roomC))!.deadline).toBeNull();

    // The process dies. A new one boots at t=70_000: room A's deadline is already
    // in the past, room B's is still ahead.
    const after = new ManualScheduler(70_000);
    const booted = new RoomManager({ repo, scheduler: after });

    expect(await booted.rearmAll()).toBe(2);
    expect(after.has(deadlineKey(roomA))).toBe(true);
    expect(after.has(deadlineKey(roomB))).toBe(true);
    expect(after.has(deadlineKey(roomC))).toBe(false);

    // The overdue room ticks straight away rather than being skipped, and its
    // next deadline is measured off the deadline that expired, not off boot time
    // (§7.6) — replaying a late tick converges on the live timeline.
    await after.advance(0);
    const tickedA = (await repo.get(roomA))!;
    expect(tickedA.state.stateVersion).toBeGreaterThan(docA.state.stateVersion);
    expect(tickedA.deadline).toBe(docA.deadline! + TURN_DURATION_MS);

    // The room whose deadline is still ahead was armed, not fired.
    const untouchedB = (await repo.get(roomB))!;
    expect(untouchedB.state.stateVersion).toBe(docB.state.stateVersion);
    expect(untouchedB.deadline).toBe(docB.deadline);

    // It then fires on its own schedule, as if the process had never restarted.
    await after.advance(docB.deadline! - after.now());
    const tickedB = (await repo.get(roomB))!;
    expect(tickedB.state.stateVersion).toBeGreaterThan(docB.state.stateVersion);
    expect(tickedB.deadline).toBe(docB.deadline! + TURN_DURATION_MS);
  });

  it("is safe to run while a live timer is already armed for the same room", async () => {
    // A re-arm racing the timer it duplicates lands at most one transition: the
    // loser's `TICK` arrives before the (already advanced) deadline and is a
    // no-op, and the commit is a `stateVersion` CAS (§14).
    const repo = new InMemoryRoomRepository();
    const scheduler = new ManualScheduler(1_000);
    const manager = new RoomManager({ repo, scheduler });
    const roomId = await startedRoom(manager);
    const dealt = (await repo.get(roomId))!;

    await manager.rearmAll();
    await manager.rearmAll();
    await scheduler.advance(TURN_DURATION_MS);

    const doc = (await repo.get(roomId))!;
    expect(doc.deadline).toBe(dealt.deadline! + TURN_DURATION_MS);
    // Exactly one transition, not one per arming: re-arming is idempotent.
    expect(doc.state.stateVersion).toBe(dealt.state.stateVersion + 1);
  });

  it("fires an overdue deadline on the wall clock shortly after boot (§14 acceptance)", async () => {
    // The manual clock cannot show that a *negative* delay is clamped rather
    // than dropped, which is the whole behaviour a redeploy that outlasts a turn
    // depends on. This one runs on `RealScheduler`.
    const repo = new InMemoryRoomRepository();
    const manager = new RoomManager({ repo, scheduler: new RealScheduler() });
    const roomId = await startedRoom(manager);
    const dealt = (await repo.get(roomId))!;

    // Rewind the stored deadline into the past: the process died mid-turn and
    // the restart took longer than the turn had left. `stateVersion` is
    // deliberately untouched — this is the clock moving, not an action.
    const overdue = Date.now() - 1_000;
    await repo.mutate(roomId, (d) => withState(d, { ...d.state, deadline: overdue }, Date.now()));

    expect(await manager.rearmAll()).toBe(1);
    await vi.waitFor(async () => {
      const doc = (await repo.get(roomId))!;
      expect(doc.state.stateVersion).toBeGreaterThan(dealt.state.stateVersion);
      expect(doc.deadline).toBe(overdue + TURN_DURATION_MS);
    });
  });

  it("lists only rooms whose deadline is set", async () => {
    const repo = new InMemoryRoomRepository();
    const scheduler = new ManualScheduler(1_000);
    const manager = new RoomManager({ repo, scheduler });

    const lobby = await manager.createRoom();
    expect(await repo.listArmed()).toEqual([]);

    const playing = await startedRoom(manager);
    expect(await repo.listArmed()).toEqual([
      { roomId: playing, deadline: 1_000 + TURN_DURATION_MS },
    ]);
    expect((await repo.get(lobby))!.deadline).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The Firestore query shape, without a Firestore                             */
/* -------------------------------------------------------------------------- */

/** Records the query calls `armedRoomsQuery` makes instead of running them. */
class RecordingQuery implements ArmedQuerySource<RecordingQuery> {
  readonly filters: { field: string; op: string; value: number }[] = [];
  readonly projections: string[][] = [];

  where(field: string, op: ">", value: number): RecordingQuery {
    this.filters.push({ field, op, value });
    return this;
  }

  select(...fields: string[]): RecordingQuery {
    this.projections.push(fields);
    return this;
  }
}

describe("armedRoomsQuery (§14)", () => {
  it("filters on the single denormalized deadline field and projects to it", () => {
    const recorder = new RecordingQuery();
    expect(armedRoomsQuery(recorder)).toBe(recorder);

    // One filter on one field: the automatic index covers it, so there is no
    // composite index to declare and no FAILED_PRECONDITION to handle (§14).
    expect(recorder.filters).toEqual([{ field: DEADLINE_FIELD, op: ">", value: 0 }]);
    expect(DEADLINE_FIELD).toBe("deadline");

    // Projected, so a restart never pulls a serialized GameState over the wire.
    expect(recorder.projections).toEqual([[DEADLINE_FIELD]]);
  });
});
