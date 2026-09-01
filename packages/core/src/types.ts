/**
 * Core domain types. Spec §2 is the source of truth for every shape in this file.
 *
 * The only deliberate narrowing of §2 is `HistoryEntry.key`, which is typed as
 * `HistoryKey` rather than `string` so that no bare string can enter `GameState`
 * (§11). `HistoryKey` is a subtype of `string`, so the shape is unchanged.
 */
import type { HistoryKey } from "./i18n-keys.js";

export type Suit = "S" | "H" | "D" | "C";

/** 1 = Ace, 2 = Two. Numeric value only. Strength order is separate. */
export type Rank = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 1 | 2;

export type Role =
  | { kind: "DAI_FUGO" }
  | { kind: "FUGO" }
  | { kind: "HEIMIN"; rank: number } // 1-indexed from the top
  | { kind: "HINMIN" }
  | { kind: "DAI_HINMIN" };

export type RoleKind = Role["kind"];

export interface Card {
  id: string; // "S-3", "H-11", "JKR-1", "JKR-2"
  suit: Suit | null; // null for joker
  rank: Rank | null; // null for joker
  isJoker: boolean;
}

/** How a joker was played. Absent binding means it was played pure. */
export interface JokerBinding {
  cardId: string; // "JKR-1" | "JKR-2"
  rank: Rank;
  suit: Suit;
}

export interface PlayCombo {
  cards: Card[];
  bindings: JokerBinding[]; // empty when no jokers, or jokers played pure
  /** Rank every card resolves to. null only for a pure joker play. */
  resolvedRank: Rank | null;
  /** Multiset of suits after binding. Pure jokers contribute null. */
  suits: (Suit | null)[];
  /** true when every card is a pure joker. */
  isPureJokerPlay: boolean;
}

export interface HouseRulesConfig {
  spade3BeatsJoker: boolean;
  fiveSkip: boolean;
  sevenPass: boolean;
  eightGiri: boolean;
  nineGiriMinPair: boolean;
  tenDiscard: boolean;
  elevenBack: boolean;
  kakumei: boolean;
  shibari: boolean;
}

export type HouseRuleKey = keyof HouseRulesConfig;

export type PendingAction =
  | { type: "RESOLVE_7_PASS"; count: number; sourcePlayerId: string; targetPlayerId: string }
  | { type: "RESOLVE_10_DISCARD"; count: number; playerId: string };

export interface Player {
  id: string; // stable across reconnect
  name: string;
  role: Role | null; // from the PREVIOUS round; drives exchange
  seatIndex: number;
  isReady: boolean;
  isConnected: boolean;
}

export interface HistoryEntry {
  key: HistoryKey; // i18n key, see §11
  params: Record<string, string | number>;
  /** Card ids in params that must be redacted for players outside `visibleTo`. */
  privateCardParams?: string[];
  visibleTo?: string[]; // player ids; undefined means everyone
}

export type GameStatus = "LOBBY" | "EXCHANGE" | "IN_PROGRESS" | "ROUND_END" | "MATCH_END";

export interface ExchangeState {
  required: Record<string, number>; // playerId -> cards owed
  partner: Record<string, string>; // playerId -> recipient
  forced: Record<string, string[]>; // playerId -> pre-computed card ids (poor side)
  submitted: Record<string, string[]>;
}

export interface GameState {
  roomId: string;
  hostId: string;
  config: HouseRulesConfig;
  status: GameStatus;
  roundNumber: number; // 1-indexed
  roundLimit: number | null; // null = endless
  stateVersion: number; // increments on every applied action

  players: Player[]; // ordered by seatIndex
  hands: Record<string, Card[]>;
  /**
   * Every card out of play: the 10-discard sink, miyako-ochi hands (§4.5), and
   * the cards of each trick as it clears (§7.4). §2 names the first two; the
   * third follows from card conservation being a sum over hands, trick and
   * graveyard (§12.3) — a played card never returns to a hand, so this is the
   * only place an emptied trick can go.
   */
  graveyard: Card[];

  dealerId: string; // previous round's last place
  turnOrder: string[]; // ALL player ids in seat order. Never mutated mid-round.
  activePlayerIndex: number; // index into turnOrder

  currentTrick: { combo: PlayCombo; playedBy: string }[];
  trickLeaderId: string | null; // last player who actually played
  passedPlayerIds: string[];
  finishedPlayerIds: string[]; // in order of going out (agari)
  /**
   * Players removed from the round without an agari: a miyako-ochi demotion
   * (§4.5) or a mid-round leave (§7.7). Pinned below everyone who still held
   * cards when the round ended, best-placed first, so the last entry is dead
   * last. A miyako-ochi entry stays last: a later leave inserts before it.
   */
  droppedPlayerIds: string[];

  isRevolution: boolean; // persists for the round
  trickInverted: boolean; // 11-back; resets on trick clear
  suitLock: Suit[] | null; // exact suit multiset lock; resets on trick clear

  pendingAction: PendingAction | null;
  exchange: ExchangeState | null;

  /** Epoch ms. Server authoritative. Clients render a countdown against it. */
  deadline: number | null;

  pendingJoins: Player[]; // applied at next round boundary
  pendingLeaves: string[];

  /**
   * Match standings: cumulative `N - finishPosition` per player (§9).
   *
   * The one field here that §2 does not list. §9 requires points to accumulate
   * across rounds and `matchFinished` to emit them, and neither `GameState` nor
   * `Player` as written in §2 has anywhere to keep them, so they live here rather
   * than being recomputed from a round history that the engine does not keep.
   */
  points: Record<string, number>;

  history: HistoryEntry[];
}

/**
 * The exchange as one viewer may see it (§4.3, §8.5).
 *
 * `required` and `partner` are public — who owes how many cards to whom is on the
 * table. The selections are not: `forced` names the poor side's automatically
 * chosen cards and `submitted` the rich side's chosen cards, both of which are
 * still in a hand until the phase applies. §2 does not omit `exchange` from
 * `PublicGameState`, but §12.4 test 30 deep-scans the payload for another
 * player's card ids, and these two fields carry them, so they are counted here
 * the same way hands are. The viewer's own selections come back as
 * `myForcedCards` / `mySubmittedCards`.
 */
export interface PublicExchangeState extends Omit<ExchangeState, "forced" | "submitted"> {
  forced: Record<string, { cardCount: number }>;
  submitted: Record<string, { cardCount: number }>;
}

export interface PublicGameState extends Omit<GameState, "hands" | "history" | "exchange"> {
  hands: Record<string, { cardCount: number }>;
  exchange: PublicExchangeState | null;
  myHand: Card[];
  myPlayerId: string;
  /** The viewer's own forced selection (§4.3), read-only. Empty when not forced. */
  myForcedCards: string[];
  /** What the viewer submitted this exchange, so a reconnect can render it (§8.1). */
  mySubmittedCards: string[];
  history: HistoryEntry[]; // already redacted for this viewer
}

export type ClientAction =
  | { type: "START_GAME"; seed: string }
  | { type: "PLAY_CARDS"; cardIds: string[]; bindings?: JokerBinding[] }
  | { type: "PASS" }
  | { type: "SUBMIT_7_PASS"; cardIds: string[] }
  | { type: "SUBMIT_10_DISCARD"; cardIds: string[] }
  | { type: "EXCHANGE_CARDS"; cardIds: string[] }
  | { type: "UPDATE_RULES"; config: Partial<HouseRulesConfig> }
  | { type: "SET_ROUND_LIMIT"; limit: number | null }
  | { type: "TICK"; now: number }; // server-injected, drives timeouts

export type ClientActionType = ClientAction["type"];

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

/** Discriminated result. `applyAction` returns `Result<GameState, ErrorCode>` (§7). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
