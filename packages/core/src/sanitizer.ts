/**
 * Per-viewer state and history redaction (§8.5).
 *
 * The server holds one authoritative `GameState` and broadcasts a different
 * payload to every recipient (§8.4). Everything private to a seat is removed
 * here, in core, so neither the server nor the client can forget to do it:
 *
 * - other players' hands become a card count;
 * - the exchange's forced and submitted selections become counts (§4.3);
 * - history entries naming private cards are rewritten to their `*Redacted`
 *   counterpart, which takes a `count` where the original took card ids (§11).
 *
 * Player names are never redacted. A 7-pass reads "Will passed 3♠ to Alex" for
 * the two parties and "Will passed 1 card to Alex" for everyone else.
 */
import { isRedactableHistoryKey, redactedHistoryKey } from "./i18n-keys.js";
import type {
  Card,
  GameState,
  HistoryEntry,
  PublicExchangeState,
  PublicGameState,
} from "./types.js";

/* -------------------------------------------------------------------------- */
/* History (§8.5)                                                             */
/* -------------------------------------------------------------------------- */

/** Card ids in a private param are joined by a single space when logged. */
function countCards(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return 0;
  return value.trim().split(/\s+/).length;
}

function isVisibleTo(entry: HistoryEntry, viewerId: string): boolean {
  return entry.visibleTo === undefined || entry.visibleTo.includes(viewerId);
}

/**
 * Rewrite one entry for `viewerId`, or return `null` when the viewer must not
 * see it at all.
 *
 * Three cases:
 * - the viewer is a party to the entry, or the entry is public: unchanged, and
 *   returned by identity so a broadcast shares one frozen object;
 * - the entry names private cards and has a `*Redacted` counterpart: the key is
 *   swapped and the private params collapse into `count`;
 * - the entry is addressed to named players but carries no redactable cards:
 *   dropped, since `visibleTo` is the only thing it says about its audience.
 */
export function redactHistoryEntry(entry: HistoryEntry, viewerId: string): HistoryEntry | null {
  if (isVisibleTo(entry, viewerId)) return entry;

  const privateParams = entry.privateCardParams ?? [];
  if (privateParams.length === 0 || !isRedactableHistoryKey(entry.key)) return null;

  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(entry.params)) {
    if (!privateParams.includes(name) && name !== "count") params[name] = value;
  }
  params["count"] =
    typeof entry.params["count"] === "number"
      ? entry.params["count"]
      : privateParams.reduce((total, name) => total + countCards(entry.params[name]), 0);

  return Object.freeze({
    key: redactedHistoryKey(entry.key),
    params: Object.freeze(params),
  });
}

/** Redact a whole log in order, dropping entries the viewer is not a party to. */
export function redactHistory(history: readonly HistoryEntry[], viewerId: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const entry of history) {
    const redacted = redactHistoryEntry(entry, viewerId);
    if (redacted !== null) out.push(redacted);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* State (§8.4, §8.5)                                                         */
/* -------------------------------------------------------------------------- */

function countSelections(
  selections: Record<string, string[]>,
): Record<string, { cardCount: number }> {
  const out: Record<string, { cardCount: number }> = {};
  for (const [playerId, ids] of Object.entries(selections)) {
    out[playerId] = { cardCount: ids.length };
  }
  return out;
}

function publicExchange(state: GameState): PublicExchangeState | null {
  if (state.exchange === null) return null;
  return {
    required: { ...state.exchange.required },
    partner: { ...state.exchange.partner },
    forced: countSelections(state.exchange.forced),
    submitted: countSelections(state.exchange.submitted),
  };
}

/**
 * The state as `viewerId` may see it.
 *
 * `viewerId` need not hold a seat: a viewer with no hand gets an empty one
 * rather than an error, which is what a spectator or a player whose seat has
 * been removed sees. The result shares `Card` objects with `state` — cards are
 * immutable — but no container, so mutating the view cannot reach the
 * authoritative state.
 */
export function getPublicState(state: GameState, viewerId: string): PublicGameState {
  const hands: Record<string, { cardCount: number }> = {};
  for (const [playerId, hand] of Object.entries(state.hands)) {
    hands[playerId] = { cardCount: hand.length };
  }

  const myHand: Card[] = [...(state.hands[viewerId] ?? [])];

  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    turnOrder: [...state.turnOrder],
    currentTrick: state.currentTrick.map((play) => ({ ...play })),
    passedPlayerIds: [...state.passedPlayerIds],
    finishedPlayerIds: [...state.finishedPlayerIds],
    droppedPlayerIds: [...state.droppedPlayerIds],
    graveyard: [...state.graveyard],
    pendingJoins: state.pendingJoins.map((player) => ({ ...player })),
    pendingLeaves: [...state.pendingLeaves],
    points: { ...state.points },
    config: { ...state.config },
    hands,
    exchange: publicExchange(state),
    myHand,
    myPlayerId: viewerId,
    myForcedCards: [...(state.exchange?.forced[viewerId] ?? [])],
    mySubmittedCards: [...(state.exchange?.submitted[viewerId] ?? [])],
    history: redactHistory(state.history, viewerId),
  };
}
