/**
 * A `PublicGameState` fixture for the component tests: one seat's already-redacted
 * view of a room (§8.5), with the fields a test cares about overridden.
 *
 * The lobby reads finish-order fields — `turnOrder`, `finishedPlayerIds`,
 * `droppedPlayerIds` — so they are spelled out per test rather than defaulted to
 * something a row order could accidentally agree with.
 */
import { DEFAULT_HOUSE_RULES, type Player, type PublicGameState } from "@daifugo/core";

export function player(id: string, name: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name,
    role: null,
    seatIndex: 0,
    isReady: false,
    isConnected: true,
    ...overrides,
  };
}

export function publicState(overrides: Partial<PublicGameState> = {}): PublicGameState {
  const players = overrides.players ?? [player("p_1", "Will"), player("p_2", "Alex")];
  return {
    roomId: "ABC234",
    hostId: "p_1",
    config: { ...DEFAULT_HOUSE_RULES },
    status: "LOBBY",
    roundNumber: 1,
    roundLimit: null,
    stateVersion: 1,
    players,
    hands: Object.fromEntries(players.map((seat) => [seat.id, { cardCount: 0 }])),
    myHand: [],
    myPlayerId: "p_1",
    graveyard: [],
    dealerId: "p_1",
    turnOrder: players.map((seat) => seat.id),
    activePlayerIndex: 0,
    currentTrick: [],
    trickLeaderId: null,
    passedPlayerIds: [],
    finishedPlayerIds: [],
    droppedPlayerIds: [],
    isRevolution: false,
    trickInverted: false,
    suitLock: null,
    pendingAction: null,
    exchange: null,
    deadline: null,
    pendingJoins: [],
    pendingLeaves: [],
    points: {},
    history: [],
    ...overrides,
  };
}
