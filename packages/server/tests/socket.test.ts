/**
 * §12.4 at the wire boundary: the Socket.IO contract of §8.
 *
 * These run a real server (built with an in-memory repository) on an ephemeral
 * port and talk to it with `socket.io-client`, so they cover what the manager
 * tests cannot: that `joined` reaches a socket before its first `roomState`
 * (test 30a), that a third party's `roomState` never carries another seat's card
 * ids (test 30), and that a non-host action comes back as `gameError` to the
 * sender alone (test 26).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type {
  ClientToServerEvents,
  JoinedPayload,
  PublicGameState,
  ServerToClientEvents,
} from "@daifugo/core";
import { buildServer } from "../src/app.js";
import { InMemoryRoomRepository } from "../src/repository.js";
import { RealScheduler } from "../src/timers.js";

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof buildServer>;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = buildServer({ repo: new InMemoryRoomRepository(), scheduler: new RealScheduler() });
  const address = await server.app.listen({ port: 0, host: "127.0.0.1" });
  url = address;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await server.io.close();
  await server.app.close();
});

function connect(): Client {
  const socket: Client = ioClient(url, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  return socket;
}

function once<E extends keyof ServerToClientEvents>(
  socket: Client,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>> {
  return new Promise((resolve) => {
    socket.once(event, ((...args: unknown[]) => resolve(args as never)) as never);
  });
}

async function createRoom(): Promise<string> {
  const response = await server.app.inject({ method: "POST", url: "/rooms" });
  return (response.json() as { roomId: string }).roomId;
}

/** Join a room and resolve once the seat's first `roomState` has arrived. */
async function join(
  roomId: string,
  name: string,
  resumeToken?: string,
  icon?: string,
): Promise<{ socket: Client; joined: JoinedPayload; state: PublicGameState }> {
  const socket = connect();
  // Emits buffer until the socket connects, and both listeners are registered
  // before the emit, so neither event can be missed.
  const joinedP = once(socket, "joined");
  const stateP = once(socket, "roomState");
  socket.emit("joinRoom", roomId, name, resumeToken, icon);
  const [joined] = await joinedP;
  const [state] = await stateP;
  return { socket, joined, state };
}

/**
 * §8.6: a seat says it is ready, and resolves once every socket named has seen
 * the broadcast. Each recipient is awaited explicitly because the broadcast
 * reaches them independently — a listener registered later would otherwise pick
 * up this state rather than the one the test is waiting for.
 */
async function ready(seat: { socket: Client }, ...observers: { socket: Client }[]): Promise<void> {
  const seen = [seat, ...observers].map((client) => once(client.socket, "roomState"));
  seat.socket.emit("setReady", true);
  await Promise.all(seen);
}

/** Whether the stored seat still counts as connected (§8.3). */
async function seatConnected(roomId: string, playerId: string): Promise<boolean> {
  const doc = await server.manager.get(roomId);
  return doc?.state.players.find((player) => player.id === playerId)?.isConnected ?? false;
}

/**
 * Close a client and resolve once the server has both dropped it from the io room
 * and had a turn to run its `disconnect` handler — the point after which the seat's
 * connection state is settled either way.
 */
async function close(socket: Client, roomId: string): Promise<void> {
  const id = socket.id;
  socket.disconnect();
  await vi.waitFor(async () => {
    const sockets = await server.io.in(roomId).fetchSockets();
    expect(sockets.some((other) => other.id === id)).toBe(false);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("Socket.IO contract (§8, §12.4)", () => {
  it("broadcasts selected icons to other players and preserves them on resume", async () => {
    const roomId = await createRoom();
    const first = await join(roomId, "Will", undefined, "🦊");
    const update = once(first.socket, "roomState");
    const second = await join(roomId, "Alex", undefined, "🐸");
    const [state] = await update;
    expect(state.players.map((player) => player.icon)).toEqual(["🦊", "🐸"]);
    expect(second.state.players[0]?.icon).toBe("🦊");
    const resumed = await join(roomId, "Will", first.joined.resumeToken);
    expect(resumed.state.players[0]?.icon).toBe("🦊");
  });

  it("delivers `joined` with the resumeToken before the first `roomState` (test 30a)", async () => {
    const roomId = await createRoom();
    const socket = connect();

    const order: string[] = [];
    socket.onAny((event: string) => order.push(event));

    // Both listeners are registered before the emit so the near-simultaneous
    // `joined` and `roomState` cannot race past a late `once`.
    const joinedP = once(socket, "joined");
    const stateP = once(socket, "roomState");
    socket.emit("joinRoom", roomId, "Will");
    const [joined] = await joinedP;
    await stateP;

    expect(joined.roomId).toBe(roomId);
    expect(joined.playerId).toBeTruthy();
    expect(joined.resumeToken).toBeTruthy();
    expect(order.indexOf("joined")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("joined")).toBeLessThan(order.indexOf("roomState"));
  });

  it("never leaks another seat's card ids to a third party (test 30)", async () => {
    const roomId = await createRoom();
    const host = await join(roomId, "Will");
    const alex = await join(roomId, "Alex");
    const sam = await join(roomId, "Sam");
    await ready(alex, host, sam);
    await ready(sam, host, alex);

    // Each seat's next roomState after the deal.
    const hostState = once(host.socket, "roomState");
    const alexState = once(alex.socket, "roomState");
    const samState = once(sam.socket, "roomState");
    host.socket.emit("startGame");

    const [hostView] = await hostState;
    const [alexView] = await alexState;
    const [samView] = await samState;

    expect(hostView.status).toBe("IN_PROGRESS");
    // Alex's own hand is present; Will's and Sam's are only counts.
    expect(alexView.myHand.length).toBeGreaterThan(0);
    expect(alexView.hands[host.joined.playerId]).toEqual({
      cardCount: hostView.myHand.length,
    });

    // Alex's whole payload contains none of Will's or Sam's card ids (§8.5). The
    // graveyard is empty at deal time, so there is no public card to allow. Ids
    // are matched quoted, so "S-1" is not mistaken for a substring of "S-11".
    const alexJson = JSON.stringify(alexView);
    for (const card of [...hostView.myHand, ...samView.myHand]) {
      expect(alexJson).not.toContain(`"${card.id}"`);
    }
  });

  it("rejects a non-host startGame with gameError to the sender alone (test 26)", async () => {
    const roomId = await createRoom();
    await join(roomId, "Will");
    const alex = await join(roomId, "Alex");
    await join(roomId, "Sam");

    const errorP = once(alex.socket, "gameError");
    alex.socket.emit("startGame");
    const [error] = await errorP;
    expect(error.code).toBe("NOT_HOST");
  });

  it("readies a seat and holds the deal until the table has (test 26a, §8.6)", async () => {
    const roomId = await createRoom();
    const host = await join(roomId, "Will");
    const alex = await join(roomId, "Alex");
    const sam = await join(roomId, "Sam");

    // The host's own start is refused while the table is unready, and the
    // refusal reaches the sender alone (§8.4 step 3).
    const refusedP = once(host.socket, "gameError");
    host.socket.emit("startGame");
    const [refused] = await refusedP;
    expect(refused.code).toBe("PLAYERS_NOT_READY");

    // `setReady` sets the sender's flag and broadcasts it to the whole table.
    const seenByHost = once(host.socket, "roomState");
    alex.socket.emit("setReady", true);
    const [afterAlex] = await seenByHost;
    const readyOf = (state: PublicGameState, id: string): boolean =>
      state.players.find((player) => player.id === id)?.isReady ?? false;
    expect(readyOf(afterAlex, alex.joined.playerId)).toBe(true);
    expect(readyOf(afterAlex, sam.joined.playerId)).toBe(false);

    await ready(sam, host);
    const dealt = once(host.socket, "roomState");
    host.socket.emit("startGame");
    const [afterDeal] = await dealt;
    expect(afterDeal.status).toBe("IN_PROGRESS");
    // The deal consumes readiness, so the next lobby asks again (§8.6).
    expect(afterDeal.players.every((player) => !player.isReady)).toBe(true);
  });

  it("reclaims the seat when a socket rejoins with its resumeToken (test 25)", async () => {
    const roomId = await createRoom();
    const host = await join(roomId, "Will");
    await join(roomId, "Alex");

    // The original socket drops; a new socket resumes with the stored token.
    host.socket.disconnect();
    const resumed = await join(roomId, "Will", host.joined.resumeToken);

    expect(resumed.joined.playerId).toBe(host.joined.playerId);
    expect(resumed.joined.resumeToken).toBe(host.joined.resumeToken);
    expect(resumed.state.players.filter((p) => p.id === host.joined.playerId)).toHaveLength(1);
    expect(resumed.state.players).toHaveLength(2);
  });

  it("holds the disconnect grace while a second socket still holds the seat (§8.3)", async () => {
    const roomId = await createRoom();
    const host = await join(roomId, "Will");
    await join(roomId, "Alex");

    // A second tab replays the stored session onto the same seat (§8.1).
    const secondTab = await join(roomId, "Will", host.joined.resumeToken);
    expect(secondTab.joined.playerId).toBe(host.joined.playerId);

    // Closing it leaves the original socket seated, so the seat stays connected
    // and no removal grace is armed against a player who is still at the table.
    await close(secondTab.socket, roomId);
    expect(await seatConnected(roomId, host.joined.playerId)).toBe(true);

    // The last socket closing is the one that starts the grace.
    await close(host.socket, roomId);
    expect(await seatConnected(roomId, host.joined.playerId)).toBe(false);
  });

  it("relays a quick reaction to the whole room, sender included", async () => {
    const roomId = await createRoom();
    const first = await join(roomId, "Will");
    const second = await join(roomId, "Alex");

    const heard = [once(first.socket, "reaction"), once(second.socket, "reaction")];
    second.socket.emit("sendReaction", "getBent");
    for (const [payload] of await Promise.all(heard)) {
      expect(payload).toEqual({ playerId: second.joined.playerId, reaction: "getBent" });
    }

    // Nothing was stored: a reaction is relayed and forgotten, so the room's
    // version is exactly where it was.
    const doc = await server.manager.get(roomId);
    expect(doc?.state.stateVersion).toBe(second.state.stateVersion);
  });

  it("drops an unknown reaction and one sent inside the cooldown, silently", async () => {
    const roomId = await createRoom();
    const first = await join(roomId, "Will");
    const second = await join(roomId, "Alex");

    const seen: unknown[] = [];
    first.socket.on("reaction", (payload) => seen.push(payload));
    const errors: unknown[] = [];
    second.socket.on("gameError", (payload) => errors.push(payload));

    // An id that is not in the pool never leaves the server.
    second.socket.emit("sendReaction", "'; DROP TABLE" as never);
    // The first of these lands; the second is inside `REACTION_COOLDOWN_MS`.
    second.socket.emit("sendReaction", "skull");
    second.socket.emit("sendReaction", "skull");

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual([{ playerId: second.joined.playerId, reaction: "skull" }]);
    // A dropped reaction is not an error the sender needs to see (§8.0 is about
    // plays; this is not one).
    expect(errors).toEqual([]);
  });

  it("answers the health probe", async () => {
    const response = await server.app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true });
  });
});

it("explicit lobby leave releases the name immediately for a fresh join", async () => {
  const roomId = await createRoom();
  const first = await join(roomId, "Will");
  const second = await join(roomId, "Sam");
  await new Promise<void>((resolve) => first.socket.emit("leaveRoom", resolve));
  const doc = await server.manager.get(roomId);
  expect(doc?.state.players.map((player) => player.name)).toEqual(["Sam"]);
  expect(doc?.state.hostId).toBe(second.joined.playerId);
  first.socket.disconnect();
  const rejoined = await join(roomId, "Will");
  expect(rejoined.joined.playerId).not.toBe(first.joined.playerId);
  expect(rejoined.state.players.map((player) => player.name)).toEqual(["Sam", "Will"]);
});
