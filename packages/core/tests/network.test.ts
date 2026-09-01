/**
 * §8: the typed Socket.IO contracts.
 *
 * The contracts are types, so most of this file is a compile-time assertion: it
 * only has to typecheck to be meaningful. The runtime assertions cover the event
 * name lists, which the server dispatch table is keyed by.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CLIENT_TO_SERVER_EVENTS,
  SERVER_TO_CLIENT_EVENTS,
  type ClientToServerEvent,
  type ClientToServerEvents,
  type JoinedPayload,
  type ServerToClientEvent,
  type ServerToClientEvents,
} from "../src/network.js";
import type { PublicGameState } from "../src/types.js";

describe("socket contracts (§8)", () => {
  it("enumerates the server-to-client events", () => {
    expect([...SERVER_TO_CLIENT_EVENTS].sort()).toEqual([
      "gameError",
      "joined",
      "matchFinished",
      "roomState",
      "roundFinished",
    ]);
  });

  it("enumerates the client-to-server events", () => {
    expect([...CLIENT_TO_SERVER_EVENTS].sort()).toEqual([
      "exchangeCards",
      "joinRoom",
      "pass",
      "playCards",
      "setRoundLimit",
      "startGame",
      "submit10Discard",
      "submit7Pass",
      "updateRules",
    ]);
  });

  it("keeps the name lists and the interfaces in step", () => {
    expectTypeOf<(typeof SERVER_TO_CLIENT_EVENTS)[number]>().toEqualTypeOf<
      keyof ServerToClientEvents
    >();
    expectTypeOf<(typeof CLIENT_TO_SERVER_EVENTS)[number]>().toEqualTypeOf<
      keyof ClientToServerEvents
    >();
    expectTypeOf<ServerToClientEvent>().toEqualTypeOf<keyof ServerToClientEvents>();
    expectTypeOf<ClientToServerEvent>().toEqualTypeOf<keyof ClientToServerEvents>();
  });

  it("carries the issued resume token back to the client (§8.1)", () => {
    expectTypeOf<Parameters<ServerToClientEvents["joined"]>[0]>().toEqualTypeOf<JoinedPayload>();
    expectTypeOf<JoinedPayload["resumeToken"]>().toEqualTypeOf<string>();
  });

  it("broadcasts sanitized state, never raw state", () => {
    expectTypeOf<
      Parameters<ServerToClientEvents["roomState"]>[0]
    >().toEqualTypeOf<PublicGameState>();
  });
});
