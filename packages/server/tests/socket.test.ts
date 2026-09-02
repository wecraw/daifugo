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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
): Promise<{ socket: Client; joined: JoinedPayload; state: PublicGameState }> {
  const socket = connect();
  // Emits buffer until the socket connects, and both listeners are registered
  // before the emit, so neither event can be missed.
  const joinedP = once(socket, "joined");
  const stateP = once(socket, "roomState");
  socket.emit("joinRoom", roomId, name, resumeToken);
  const [joined] = await joinedP;
  const [state] = await stateP;
  return { socket, joined, state };
}

describe("Socket.IO contract (§8, §12.4)", () => {
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

  it("answers the health probe", async () => {
    const response = await server.app.inject({ method: "GET", url: "/healthz" });
    expect(response.json()).toEqual({ ok: true });
  });
});
