/**
 * Shared fixtures for the rule tests (§12.1).
 *
 * Combos are always built through the parser, never by hand: a `PlayCombo`
 * assembled literally could carry a resolved rank no real play could produce, and
 * every rule reads the resolved view (§5.4).
 */
import { parseCombo } from "../src/combo.js";
import { createDeck } from "../src/deck.js";
import { createGameState } from "../src/engine.js";
import type { SeatingContext } from "../src/turnOrder.js";
import type {
  Card,
  GameState,
  GameStatus,
  HouseRulesConfig,
  JokerBinding,
  PlayCombo,
  Player,
  Rank,
  Role,
  Suit,
} from "../src/types.js";

const DECK = createDeck();

export function card(id: string): Card {
  const found = DECK.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no such card: ${id}`);
  return found;
}

export function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

export function bind(cardId: string, rank: Rank, suit: Suit): JokerBinding {
  return { cardId, rank, suit };
}

/** Parse a selection, failing the fixture loudly rather than the assertion. */
export function combo(ids: string[], bindings?: JokerBinding[]): PlayCombo {
  const result = parseCombo(cards(...ids), bindings);
  if (!result.ok) throw new Error(`bad fixture: ${result.error}`);
  return result.value;
}

export interface SeatingOptions {
  finished?: string[];
  dropped?: string[];
  passed?: string[];
}

/** A seating context over `p0..p{n-1}`, with optional finished, dropped and passed sets. */
export function seatsOf(count: number, options: SeatingOptions = {}): SeatingContext {
  return {
    turnOrder: Array.from({ length: count }, (_, i) => `p${i}`),
    finishedPlayerIds: options.finished ?? [],
    droppedPlayerIds: options.dropped ?? [],
    passedPlayerIds: options.passed ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/* Engine fixtures (§7)                                                       */
/* -------------------------------------------------------------------------- */

export interface TrickPlayOptions {
  playedBy: string;
  cards: string[];
  bindings?: JokerBinding[];
}

export interface TableOptions {
  /** Player id to the card ids they hold. Turn order is the key order. */
  hands: Record<string, string[]>;
  /** Carried roles from the previous round, which is what miyako-ochi reads (§4.5). */
  roles?: Record<string, Role>;
  status?: GameStatus;
  roundNumber?: number;
  roundLimit?: number | null;
  config?: Partial<HouseRulesConfig>;
  /** Defaults to the first player in turn order. */
  active?: string;
  trick?: TrickPlayOptions[];
  trickLeaderId?: string | null;
  passed?: string[];
  finished?: string[];
  dropped?: string[];
  isRevolution?: boolean;
  trickInverted?: boolean;
  suitLock?: Suit[];
  points?: Record<string, number>;
}

/**
 * A mid-round `GameState` with hands dealt by hand.
 *
 * Every card the options do not name goes to the graveyard, so a two-card table
 * still satisfies card conservation at 54 (§12.3) and the invariant helper can
 * run against every state a test produces. That is deliberate: a fixture that
 * exempted itself from invariant 21 would exempt every test built on it.
 */
export function table(options: TableOptions): GameState {
  const ids = Object.keys(options.hands);
  const players: Player[] = ids.map((id, seatIndex) => ({
    id,
    name: id.toUpperCase(),
    role: options.roles?.[id] ?? null,
    seatIndex,
    isReady: true,
    isConnected: true,
  }));

  const base = createGameState({ roomId: "room", hostId: ids[0] ?? "", players });
  const hands: Record<string, Card[]> = {};
  for (const id of ids) hands[id] = cards(...(options.hands[id] ?? []));

  const trick = (options.trick ?? []).map((play) => ({
    combo: combo(play.cards, play.bindings),
    playedBy: play.playedBy,
  }));

  const held = new Set([
    ...Object.values(hands).flatMap((hand) => hand.map((c) => c.id)),
    ...trick.flatMap((play) => play.combo.cards.map((c) => c.id)),
  ]);

  const active = options.active ?? ids[0] ?? "";
  const lastPlay = trick[trick.length - 1];

  return {
    ...base,
    config: { ...base.config, ...options.config },
    status: options.status ?? "IN_PROGRESS",
    roundNumber: options.roundNumber ?? 2,
    roundLimit: options.roundLimit ?? null,
    hands,
    graveyard: createDeck().filter((c) => !held.has(c.id)),
    dealerId: ids[0] ?? "",
    turnOrder: ids,
    activePlayerIndex: Math.max(0, ids.indexOf(active)),
    currentTrick: trick,
    trickLeaderId:
      options.trickLeaderId !== undefined ? options.trickLeaderId : (lastPlay?.playedBy ?? null),
    passedPlayerIds: options.passed ?? [],
    finishedPlayerIds: options.finished ?? [],
    droppedPlayerIds: options.dropped ?? [],
    isRevolution: options.isRevolution ?? false,
    trickInverted: options.trickInverted ?? false,
    suitLock: options.suitLock ?? null,
    points: options.points ?? base.points,
  };
}

/** The id of the player whose turn it is. */
export function activeId(state: GameState): string | null {
  return state.turnOrder[state.activePlayerIndex] ?? null;
}

/** The card ids in a player's hand, for readable assertions. */
export function handIds(state: GameState, playerId: string): string[] {
  return (state.hands[playerId] ?? []).map((c) => c.id);
}
