/**
 * The reducer (§7): `applyAction(state, action, playerId)`.
 *
 * Pure, and the purity is load-bearing. Randomness enters only through
 * `START_GAME.seed`, which `deck.ts` turns into a seeded PRNG; time enters only
 * through `TICK`. There is no `Date.now()` and no `Math.random()` in this package,
 * so replaying a stored seed reproduces a round exactly and a Firestore
 * transaction retry is safe (§14).
 *
 * Because the reducer has no clock, it does not invent a `deadline`: it nulls it
 * on every applied action, and the server stamps the new one — through
 * `stampDeadline`, in the same write — when it arms the timer (§8.4 step 5).
 * `TICK` is the one action that carries time, so it is the one place the reducer
 * writes a deadline itself (§7.6, §14).
 *
 * Everything the pipeline needs already exists elsewhere: the parser resolves
 * jokers (§5.5), the evaluator answers legality (§10.3), each house rule reports
 * what should happen (§6), and `turnOrder.ts` walks the seats. This file is only
 * the order the phases run in and the state writes they imply — which is exactly
 * where the interesting bugs live, so the phases are kept as separate functions
 * named after §7.1 rather than inlined into one reducer.
 *
 * State is produced by copy: `draft()` takes an exclusively-owned shallow copy,
 * every array field is *replaced* rather than mutated, and `commit()` bumps
 * `stateVersion` in one place. No caller's state is ever written through.
 */
import { parseCombo } from "./combo.js";
import { DEFAULT_HOUSE_RULES, mergeHouseRules } from "./config.js";
import {
  createDeck,
  createRng,
  deal,
  openingLeaderId,
  pickDealerIndex,
  reseat,
  shuffle,
} from "./deck.js";
import { checkLegality, generateLegalMoves, invertedIn, trickContextOf } from "./evaluator.js";
import { takeFromHand } from "./hand.js";
import { type ErrorCode, history, roleKey } from "./i18n-keys.js";
import {
  EXCHANGE_DURATION_MS,
  applyExchange,
  assignRoles,
  autoFillExchange,
  createExchangeState,
  finishOrderOf,
  isExchangeComplete,
  needsExchange,
  richPlayerIds,
  roundPoints,
  submitExchange,
  weakestSelection,
  withdrawFromExchange,
} from "./roles.js";
import {
  applyElevenBack,
  applyKakumei,
  fiveSkip,
  firesEightGiri,
  firesElevenBack,
  firesKakumei,
  firesNineGiri,
  resolveSevenPass,
  resolveTenDiscard,
  sevenPassPending,
  sevenPassTarget,
  shibariLock,
  spade3BeatsJoker,
  tenDiscardPending,
} from "./rules/index.js";
import {
  eligiblePlayerIds,
  hasDropped,
  hasFinished,
  inRoundPlayerIds,
  isInRound,
  nextEligibleIndex,
  seatIndexOf,
  seatingOf,
} from "./turnOrder.js";
import type {
  Card,
  ClientAction,
  ExchangeState,
  GameState,
  HouseRulesConfig,
  JokerBinding,
  PendingAction,
  PlayCombo,
  Player,
  Result,
} from "./types.js";
import { err, ok } from "./types.js";

/** §7.6: 60 seconds per turn. The server stamps it onto `deadline` (§8.4). */
export const TURN_DURATION_MS = 60_000;

/** §0: three to eight players. */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/* -------------------------------------------------------------------------- */
/* The reducer                                                                */
/* -------------------------------------------------------------------------- */

export function applyAction(
  state: GameState,
  action: ClientAction,
  playerId: string,
): Result<GameState, ErrorCode> {
  switch (action.type) {
    case "START_GAME":
      return startGame(state, playerId, action.seed);
    case "UPDATE_RULES":
      return updateRules(state, playerId, action.config);
    case "SET_ROUND_LIMIT":
      return setRoundLimit(state, playerId, action.limit);
    case "PLAY_CARDS":
      return playCards(state, playerId, action.cardIds, action.bindings);
    case "PASS":
      return pass(state, playerId);
    case "SUBMIT_7_PASS":
      return submitSevenPass(state, playerId, action.cardIds);
    case "SUBMIT_10_DISCARD":
      return submitTenDiscard(state, playerId, action.cardIds);
    case "EXCHANGE_CARDS":
      return exchangeCards(state, playerId, action.cardIds);
    case "TICK":
      return tick(state, action.now);
    default:
      return err("INVALID_ACTION");
  }
}

/* -------------------------------------------------------------------------- */
/* Drafting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * An exclusively-owned copy of `state` for a single action to write into.
 *
 * `hands` is the one nested container copied eagerly, because every phase writes
 * to it. Every other field is replaced wholesale by the code that changes it, so
 * a shallow copy is enough — and an array from the caller's state is never
 * mutated in place, which matters because history entries and combos are shared
 * by reference across every state descended from them.
 */
function draft(state: GameState): GameState {
  return { ...state, hands: { ...state.hands } };
}

/**
 * The one place `stateVersion` is bumped and `deadline` is written (§8.4).
 *
 * The default is null, which every clockless action takes: the reducer cannot
 * know what "now + 60s" is, so the server stamps the new deadline through
 * `stampDeadline` as part of the same write. `TICK` passes one explicitly,
 * because it is the only action that carries time (§7.6).
 */
function commit(next: GameState, deadline: number | null = null): Result<GameState, ErrorCode> {
  return ok({ ...next, stateVersion: next.stateVersion + 1, deadline });
}

function log(next: GameState, entry: GameState["history"][number]): void {
  next.history = [...next.history, entry];
}

function playerOf(state: GameState, playerId: string): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function activePlayerId(state: GameState): string | null {
  return state.turnOrder[state.activePlayerIndex] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Lobby                                                                      */
/* -------------------------------------------------------------------------- */

export interface NewGameOptions {
  roomId: string;
  hostId: string;
  /** Ordered by `seatIndex`, which for a fresh room is join order (§3.2). */
  players: readonly Player[];
  config?: Readonly<HouseRulesConfig>;
  roundLimit?: number | null;
}

/** A room in `LOBBY`, before any deal. The server's starting point (§8). */
export function createGameState(options: NewGameOptions): GameState {
  const players = options.players.map((player, index) => ({ ...player, seatIndex: index }));
  const hands: Record<string, Card[]> = {};
  const points: Record<string, number> = {};
  for (const player of players) {
    hands[player.id] = [];
    points[player.id] = 0;
  }

  return {
    roomId: options.roomId,
    hostId: options.hostId,
    config: { ...(options.config ?? DEFAULT_HOUSE_RULES) },
    status: "LOBBY",
    roundNumber: 0,
    roundLimit: options.roundLimit ?? null,
    stateVersion: 0,
    players,
    hands,
    graveyard: [],
    dealerId: players[0]?.id ?? "",
    turnOrder: players.map((player) => player.id),
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
    points,
    history: [],
  };
}

/**
 * Host-only rule toggles, from the lobby or between rounds (§8.2, §10.11).
 *
 * Unknown keys and non-boolean values are dropped by `mergeHouseRules` rather
 * than trusted: the patch arrives over the wire.
 */
function updateRules(
  state: GameState,
  playerId: string,
  config: Partial<HouseRulesConfig>,
): Result<GameState, ErrorCode> {
  if (playerId !== state.hostId) return err("NOT_HOST");
  if (state.status !== "LOBBY" && state.status !== "ROUND_END") return err("WRONG_STATUS");

  const next = draft(state);
  next.config = mergeHouseRules(state.config, config);
  return commit(next);
}

/** Host-only. `null` is endless; anything else must be a positive whole number (§9). */
function setRoundLimit(
  state: GameState,
  playerId: string,
  limit: number | null,
): Result<GameState, ErrorCode> {
  if (playerId !== state.hostId) return err("NOT_HOST");
  if (state.status !== "LOBBY" && state.status !== "ROUND_END") return err("WRONG_STATUS");
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) return err("INVALID_ROUND_LIMIT");
  // A limit only ends a round still to come. In `ROUND_END` after round r,
  // `roundNumber` is r and that round is already scored, so r itself is as
  // unreachable as r - 1: accepting it would leave the status at `ROUND_END`
  // and let `START_GAME` deal an r + 1 the limit was meant to forbid (§9).
  if (limit !== null && limit <= state.roundNumber) return err("INVALID_ROUND_LIMIT");

  const next = draft(state);
  next.roundLimit = limit;
  return commit(next);
}

/* -------------------------------------------------------------------------- */
/* Round start (§3)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Deal a round: the first one from `LOBBY`, every later one from `ROUND_END`.
 *
 * Round 1 seats in join order with a dealer drawn from the seed and skips the
 * exchange (§4.3). Every later round reseats around the previous round's finish
 * order — last place deals from seat 0, the winner sits at `N-1` (§3.2) — and
 * enters `EXCHANGE`, so `IN_PROGRESS` is reached from `exchangeCards` rather than
 * from here.
 */
function startGame(state: GameState, playerId: string, seed: string): Result<GameState, ErrorCode> {
  if (playerId !== state.hostId) return err("NOT_HOST");
  if (state.status === "EXCHANGE" || state.status === "IN_PROGRESS") {
    return err("GAME_ALREADY_STARTED");
  }
  if (state.status !== "LOBBY" && state.status !== "ROUND_END") return err("WRONG_STATUS");

  // The round boundary is where the queued roster changes land (§7.7), and the
  // count that matters is the one about to be dealt to, not the one that played
  // the round just ended.
  const roster = rosterAfterChanges(state);
  if (roster.length < MIN_PLAYERS) return err("NOT_ENOUGH_PLAYERS");
  if (roster.length > MAX_PLAYERS) return err("TOO_MANY_PLAYERS");

  const rng = createRng(seed);
  const first = state.status === "LOBBY";
  const next = draft(state);

  const rosterIds = roster.map((player) => player.id);
  const finishOrder = first ? rosterIds : previousFinishOrder(state, rosterIds);
  const turnOrder = first ? rosterIds : reseat(finishOrder);
  const dealerIndex = first ? pickDealerIndex(turnOrder.length, rng) : 0;

  next.roundNumber = state.roundNumber + 1;
  next.turnOrder = [...turnOrder];
  next.players = turnOrder.flatMap((id, seatIndex) => {
    const player = roster.find((seated) => seated.id === id);
    return player === undefined ? [] : [{ ...player, seatIndex }];
  });
  next.dealerId = turnOrder[dealerIndex] ?? state.dealerId;
  next.hands = deal(shuffle(createDeck(), rng), turnOrder, dealerIndex);
  next.points = Object.fromEntries(turnOrder.map((id) => [id, state.points[id] ?? 0]));
  next.pendingJoins = [];
  next.pendingLeaves = [];
  next.hostId = turnOrder.includes(state.hostId) ? state.hostId : (turnOrder[0] ?? state.hostId);

  next.graveyard = [];
  next.currentTrick = [];
  next.trickLeaderId = null;
  next.passedPlayerIds = [];
  next.finishedPlayerIds = [];
  next.droppedPlayerIds = [];
  next.isRevolution = false;
  next.trickInverted = false;
  next.suitLock = null;
  next.pendingAction = null;
  next.exchange = null;
  next.activePlayerIndex = 0;

  if (first) log(next, history("history.gameStarted", { round: next.roundNumber }));
  log(next, history("history.roundStarted", { round: next.roundNumber }));
  log(next, history("history.dealt", { dealer: next.dealerId }));

  if (needsExchange(next.roundNumber)) {
    next.status = "EXCHANGE";
    next.exchange = createExchangeState(finishOrder, next.hands);
    log(next, history("history.exchangeStarted", { round: next.roundNumber }));
  } else {
    beginTrickPlay(next);
  }

  return commit(next);
}

/**
 * Open the round's first trick: the 3 of Diamonds leads (§3.4).
 *
 * Round 1 reaches this straight from the deal; every later round reaches it when
 * the exchange applies, because the exchange can move the 3 of Diamonds.
 */
function beginTrickPlay(next: GameState): void {
  next.status = "IN_PROGRESS";

  // Normally the 3 of Diamonds decides it. It can be missing from every hand only
  // when its holder left during the exchange (§7.7) and their cards went to the
  // graveyard, in which case the nearest seat still in the round opens instead.
  const seating = seatingOf(next);
  const holder = openingLeaderId(next.hands);
  const leaderId =
    holder !== null && isInRound(holder, seating)
      ? holder
      : (inRoundPlayerIds(seating)[0] ?? next.turnOrder[0] ?? null);

  next.trickLeaderId = leaderId;
  next.activePlayerIndex = leaderId === null ? 0 : Math.max(0, next.turnOrder.indexOf(leaderId));
}

/* -------------------------------------------------------------------------- */
/* Exchange (§4.3)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A rich player's `EXCHANGE_CARDS` choice. The poor side has nothing to send:
 * their cards were computed at phase start and `submitExchange` tells them so
 * with `EXCHANGE_FORCED` rather than a bare refusal (§8.0).
 *
 * The transfer applies atomically once the last rich player submits (§4.3), which
 * is also what opens the first trick.
 */
function exchangeCards(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): Result<GameState, ErrorCode> {
  if (state.status !== "EXCHANGE" || state.exchange === null) return err("NOT_IN_EXCHANGE");

  const submitted = submitExchange(state.exchange, playerId, cardIds, state.hands[playerId] ?? []);
  if (!submitted.ok) return submitted;

  const next = draft(state);
  next.exchange = submitted.value;
  if (!isExchangeComplete(submitted.value)) return commit(next);

  const failed = completeExchange(next, submitted.value);
  if (failed !== null) return err(failed);
  return commit(next);
}

/**
 * Apply every transfer at once and open the first trick (§4.3).
 *
 * Shared by the last submission, the deadline (§4.4), and a leave that dissolves
 * the last outstanding pair (§7.7), so the three cannot drift. `autoGivenIds`
 * names the rich players the clock chose for: they get a second, public line
 * saying the choice was automatic, since the private `exchangeGave` entry looks
 * exactly like a deliberate one.
 */
function completeExchange(
  next: GameState,
  exchange: ExchangeState,
  autoGivenIds: readonly string[] = [],
): ErrorCode | null {
  const hands = applyExchange(exchange, next.hands);
  if (!hands.ok) return hands.error;

  for (const [giver, recipient] of Object.entries(exchange.partner)) {
    const given = exchange.forced[giver] ?? exchange.submitted[giver] ?? [];
    log(
      next,
      history(
        "history.exchangeGave",
        { player: giver, target: recipient, cards: given.join(" "), count: given.length },
        { privateCardParams: ["cards"], visibleTo: [giver, recipient] },
      ),
    );
    if (autoGivenIds.includes(giver)) {
      log(
        next,
        history("history.exchangeAutoGave", {
          player: giver,
          target: recipient,
          count: given.length,
        }),
      );
    }
  }

  next.hands = hands.value;
  next.exchange = null;
  log(next, history("history.exchangeCompleted", { round: next.roundNumber }));
  beginTrickPlay(next);
  return null;
}

/* -------------------------------------------------------------------------- */
/* PLAY_CARDS (§7.1)                                                          */
/* -------------------------------------------------------------------------- */

function playCards(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
  bindings?: readonly JokerBinding[],
  /** The turn timer chose this play (§7.6), which only the history line records. */
  auto = false,
): Result<GameState, ErrorCode> {
  /* PHASE 0 - VALIDATE ---------------------------------------------------- */
  if (state.status !== "IN_PROGRESS") return err("WRONG_STATUS");
  if (state.pendingAction !== null) return err("PENDING_ACTION_BLOCKS");
  if (activePlayerId(state) !== playerId) return err("NOT_YOUR_TURN");

  const hand = state.hands[playerId];
  if (hand === undefined) return err("PLAYER_NOT_FOUND");
  if (cardIds.length === 0) return err("EMPTY_SELECTION");

  const split = takeFromHand(hand, cardIds);
  if (!split.ok) return split;

  // The pre-play orientation. Phase A's revolution and 11-back apply to
  // subsequent plays only, so this context is built before anything is written.
  const ctx = trickContextOf(state);
  const parsed = parseCombo(split.value.selected, bindings, {
    top: ctx.top ?? null,
    inverted: invertedIn(ctx),
    isLegal: (candidate) => checkLegality(candidate, ctx).ok,
  });
  if (!parsed.ok) return parsed;

  const legality = checkLegality(parsed.value, ctx);
  if (!legality.ok) return legality;

  const combo = parsed.value;
  const previousTop = ctx.top ?? null;
  const next = draft(state);

  /* PHASE A - IMMEDIATE STATE EFFECTS ------------------------------------- */
  next.hands[playerId] = split.value.remaining;
  next.currentTrick = [...state.currentTrick, { combo, playedBy: playerId }];
  next.trickLeaderId = playerId;
  log(
    next,
    history(auto ? "history.autoPlayed" : "history.played", {
      player: playerId,
      cards: combo.cards.map((card) => card.id).join(" "),
      count: combo.cards.length,
    }),
  );
  if (spade3BeatsJoker(previousTop, combo, state.config)) {
    log(next, history("history.spade3BeatsJoker", { player: playerId }));
  }

  next.isRevolution = applyKakumei(state.isRevolution, combo, state.config);
  if (firesKakumei(combo, state.config)) {
    log(
      next,
      history(next.isRevolution ? "history.kakumei" : "history.kakumeiEnded", {
        player: playerId,
      }),
    );
  }

  next.trickInverted = applyElevenBack(state.trickInverted, combo, state.config);
  if (firesElevenBack(combo, state.config)) {
    log(
      next,
      history(next.trickInverted ? "history.elevenBack" : "history.elevenBackEnded", {
        player: playerId,
      }),
    );
  }

  const lock = shibariLock(previousTop, combo, state.suitLock, state.config);
  next.suitLock = lock;
  if (lock !== null && state.suitLock === null) {
    log(next, history("history.shibariLocked", { player: playerId, suits: lock.join("") }));
  }

  /* PHASE B - INTERACTIVE RULE (halts the pipeline) ------------------------ */
  const remaining = split.value.remaining.length;
  const seating = seatingOf(next);
  const pending =
    sevenPassPending(combo, playerId, remaining, seating, state.config) ??
    tenDiscardPending(combo, playerId, remaining, state.config);
  if (pending !== null) {
    next.pendingAction = pending;
    return commit(next);
  }

  resumePipeline(next, playerId, combo);
  return commit(next);
}

/* -------------------------------------------------------------------------- */
/* Phases C to F (§7.1, §7.2)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Phases C through F, the resume point after a pending action (§7.2).
 *
 * `SUBMIT_7_PASS` and `SUBMIT_10_DISCARD` re-enter here rather than clearing the
 * flag and advancing, because the transfer can empty the hand (§7.3) and D, E and
 * F have not run. Phase B is deliberately not re-entered: a combo resolves to one
 * rank (§5.3), so it cannot fire a second interactive rule.
 */
function resumePipeline(next: GameState, playerId: string, combo: PlayCombo): void {
  next.pendingAction = null;

  /* PHASE C - AGARI ------------------------------------------------------- */
  // An empty hand is an agari only for a player still in the round. A player who
  // left mid-round (§7.7) has an empty hand because it went to the graveyard, and
  // the pipeline runs on behalf of the play they abandoned: they are already in
  // `droppedPlayerIds` and must not climb out of it as a first-place finisher.
  const inRound = isInRound(playerId, seatingOf(next));
  if (
    inRound &&
    (next.hands[playerId]?.length ?? 0) === 0 &&
    !next.finishedPlayerIds.includes(playerId)
  ) {
    next.finishedPlayerIds = [...next.finishedPlayerIds, playerId];
    log(
      next,
      history("history.agari", { player: playerId, position: next.finishedPlayerIds.length }),
    );
    if (next.finishedPlayerIds.length === 1) applyMiyakoOchi(next, playerId);
  }

  if (inRoundPlayerIds(seatingOf(next)).length <= 1) {
    endRound(next);
    return;
  }

  /* PHASE D - TRICK ENDERS ------------------------------------------------ */
  if (firesEightGiri(combo, next.config)) {
    log(next, history("history.eightGiri", { player: playerId }));
    clearTrick(next, playerId);
    return;
  }
  if (firesNineGiri(combo, next.config)) {
    log(next, history("history.nineGiri", { player: playerId }));
    clearTrick(next, playerId);
    return;
  }

  /* PHASE E - 5-SKIP ------------------------------------------------------ */
  const skip = fiveSkip(combo, playerId, seatingOf(next), next.config);
  if (skip.kind === "CLEAR_TRICK") {
    log(next, history("history.fiveSkipCleared", { player: playerId }));
    clearTrick(next, skip.leaderId);
    return;
  }
  if (skip.kind === "SKIP") {
    log(
      next,
      history("history.fiveSkip", {
        player: playerId,
        count: skip.skippedPlayerIds.length,
        skipped: skip.skippedPlayerIds.join(" "),
      }),
    );
    next.activePlayerIndex = skip.nextIndex;
    return;
  }

  /* PHASE F - ADVANCE ----------------------------------------------------- */
  const seating = seatingOf(next);
  const advanced = nextEligibleIndex(seating, next.activePlayerIndex);
  if (advanced === null || advanced === next.activePlayerIndex) {
    // Nobody but the player is still owed a turn in this trick: there is no one
    // to beat the play, so the trick ends rather than looping back onto itself.
    clearTrick(next, playerId);
    return;
  }
  next.activePlayerIndex = advanced;
}

/**
 * Miyako-ochi (§4.5): the previous `DAI_HINMIN` winning throws the previous
 * `DAI_FUGO` out of the capital, in last place, whatever their hand holds.
 *
 * Always on, so there is no config branch. It reads the *carried* roles on
 * `Player.role` — the previous round's — and never a resolved rank, which is what
 * keeps it clear of §6's rank-trigger machinery. Round 1 carries no roles, so it
 * cannot fire; a 2nd-or-later agari never reaches here; and a `DAI_FUGO` who has
 * already finished, been demoted, or left is no longer in the round.
 *
 * The demoted hand goes to the graveyard, so card conservation still holds at 54
 * (§12.3), and `turnOrder` is untouched: they stay in it and leave only the
 * eligibility predicate.
 */
function applyMiyakoOchi(next: GameState, winnerId: string): void {
  if (playerOf(next, winnerId)?.role?.kind !== "DAI_HINMIN") return;

  const seating = seatingOf(next);
  const demoted = next.turnOrder.find(
    (id) =>
      id !== winnerId && playerOf(next, id)?.role?.kind === "DAI_FUGO" && isInRound(id, seating),
  );
  if (demoted === undefined) return;

  const hand = next.hands[demoted] ?? [];
  next.graveyard = [...next.graveyard, ...hand];
  next.hands[demoted] = [];
  // Appended last, and kept last: a later mid-round leave (§7.7) inserts before
  // this entry, never after it.
  next.droppedPlayerIds = [...next.droppedPlayerIds, demoted];
  log(
    next,
    history("history.miyakoOchi", {
      player: winnerId,
      target: demoted,
      count: hand.length,
    }),
  );
}

/**
 * §7.4. `isRevolution` is deliberately untouched: it lasts the round.
 *
 * The cleared cards go to the graveyard. §7.4 says only `currentTrick = []`, but
 * card conservation is a sum over hands, trick and graveyard (§12.3), and a
 * played card can never return to a hand — the graveyard is the only sink there
 * is, so emptying the trick anywhere else would lose the cards.
 */
function clearTrick(next: GameState, leaderId: string | null): void {
  next.graveyard = [...next.graveyard, ...next.currentTrick.flatMap((play) => play.combo.cards)];
  next.currentTrick = [];
  next.passedPlayerIds = [];
  next.trickInverted = false;
  next.suitLock = null;
  next.trickLeaderId = leaderId;
  log(next, history("history.trickCleared", { leader: leaderId ?? "" }));

  if (leaderId === null) return;
  const seating = seatingOf(next);
  const index = seatIndexOf(leaderId, seating);
  if (index === -1) return;

  // A leader who has finished or dropped (§4.5, §7.7) still holds the lead
  // nominally; the turn goes to the nearest eligible player to their left.
  if (isInRound(leaderId, seating)) {
    next.activePlayerIndex = index;
    return;
  }
  const advanced = nextEligibleIndex(seating, index);
  if (advanced !== null) next.activePlayerIndex = advanced;
}

/**
 * Round end (§4.1, §9).
 *
 * The final remaining player takes the position directly above the dropped block,
 * which is what `finishOrderOf` produces. Roles are written onto `Player.role` for
 * the next round's exchange to read — and for miyako-ochi to read the round after
 * that — and points accumulate as `N - finishPosition`.
 */
function endRound(next: GameState): void {
  const finishOrder = finishOrderOf(next.finishedPlayerIds, next.turnOrder, next.droppedPlayerIds);
  const roles = assignRoles(finishOrder);
  const awarded = roundPoints(finishOrder);

  next.players = next.players.map((player) => ({
    ...player,
    role: roles[player.id] ?? player.role,
  }));
  next.points = { ...next.points };
  for (const [playerId, points] of Object.entries(awarded)) {
    next.points[playerId] = (next.points[playerId] ?? 0) + points;
  }

  next.pendingAction = null;
  next.status = "ROUND_END";
  log(next, history("history.roundEnded", { round: next.roundNumber }));
  for (const playerId of finishOrder) {
    const role = roles[playerId];
    if (role === undefined) continue;
    log(next, history("history.roleAssigned", { player: playerId, role: roleKey(role.kind) }));
  }

  if (next.roundLimit !== null && next.roundNumber >= next.roundLimit) {
    next.status = "MATCH_END";
    log(next, history("history.matchEnded", { round: next.roundNumber }));
  }
}

/* -------------------------------------------------------------------------- */
/* PASS (§7.5)                                                                */
/* -------------------------------------------------------------------------- */

function pass(
  state: GameState,
  playerId: string,
  /** The turn timer passed for them (§7.6). */
  auto = false,
): Result<GameState, ErrorCode> {
  if (state.status !== "IN_PROGRESS") return err("WRONG_STATUS");
  if (state.pendingAction !== null) return err("PENDING_ACTION_BLOCKS");
  if (activePlayerId(state) !== playerId) return err("NOT_YOUR_TURN");
  if (state.currentTrick.length === 0) return err("CANNOT_PASS_AS_LEADER");
  if (state.passedPlayerIds.includes(playerId)) return err("ALREADY_PASSED");

  const next = draft(state);
  next.passedPlayerIds = [...state.passedPlayerIds, playerId];
  log(next, history(auto ? "history.autoPassed" : "history.passed", { player: playerId }));
  advanceOrClearTrick(next);
  return commit(next);
}

/**
 * Hand the turn to the next eligible player, or clear the trick when nobody but
 * the leader is still owed one (§7.5).
 *
 * "Nobody but the leader" is measured against the trick leader, not against a raw
 * count. Normally the leader is the one player left eligible and the two readings
 * agree, but a leader who has finished, been demoted (§4.5), or left (§7.7) is
 * not eligible at all, and counting seats alone would then clear the trick one
 * pass early — robbing the last eligible player of the turn in which they could
 * have beaten the play still sitting on the table.
 *
 * Shared with the mid-round leave, which removes a seat from the trick in exactly
 * the way a pass does: by taking it out of the eligible set.
 */
function advanceOrClearTrick(next: GameState): void {
  const stillOwedATurn = eligiblePlayerIds(seatingOf(next)).filter(
    (id) => id !== next.trickLeaderId,
  );
  if (stillOwedATurn.length === 0) {
    log(next, history("history.allPassed", { leader: next.trickLeaderId ?? "" }));
    clearTrick(next, next.trickLeaderId);
    return;
  }

  const advanced = nextEligibleIndex(seatingOf(next), next.activePlayerIndex);
  if (advanced !== null) next.activePlayerIndex = advanced;
}

/* -------------------------------------------------------------------------- */
/* Pending actions (§7.2)                                                     */
/* -------------------------------------------------------------------------- */

/** The play that set the pending action: the trick top, which is still in place. */
function pendingCombo(state: GameState): PlayCombo | null {
  return state.currentTrick[state.currentTrick.length - 1]?.combo ?? null;
}

function submitSevenPass(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): Result<GameState, ErrorCode> {
  if (state.status !== "IN_PROGRESS") return err("WRONG_STATUS");
  const pending = state.pendingAction;
  const transfer = resolveSevenPass(pending, playerId, cardIds, state.hands[playerId] ?? []);
  if (!transfer.ok) return transfer;
  if (pending === null || pending.type !== "RESOLVE_7_PASS") return err("WRONG_PENDING_ACTION");

  const combo = pendingCombo(state);
  if (combo === null) return err("INVALID_ACTION");

  const next = draft(state);
  const target = pending.targetPlayerId;
  next.hands[playerId] = transfer.value.remaining;
  next.hands[target] = [...(state.hands[target] ?? []), ...transfer.value.given];
  log(
    next,
    history(
      "history.sevenPass",
      {
        player: playerId,
        target,
        cards: transfer.value.given.map((card) => card.id).join(" "),
        count: transfer.value.given.length,
      },
      { privateCardParams: ["cards"], visibleTo: [playerId, target] },
    ),
  );

  resumePipeline(next, playerId, combo);
  return commit(next);
}

function submitTenDiscard(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): Result<GameState, ErrorCode> {
  if (state.status !== "IN_PROGRESS") return err("WRONG_STATUS");
  const discard = resolveTenDiscard(
    state.pendingAction,
    playerId,
    cardIds,
    state.hands[playerId] ?? [],
  );
  if (!discard.ok) return discard;

  const combo = pendingCombo(state);
  if (combo === null) return err("INVALID_ACTION");

  const next = draft(state);
  next.hands[playerId] = discard.value.remaining;
  next.graveyard = [...state.graveyard, ...discard.value.discarded];
  // Public: the discarded cards go to the graveyard, which every seat can see
  // (§8.5), so the entry names them for everyone and needs no redacted pair.
  log(
    next,
    history("history.tenDiscard", {
      player: playerId,
      cards: discard.value.discarded.map((card) => card.id).join(" "),
      count: discard.value.discarded.length,
    }),
  );

  resumePipeline(next, playerId, combo);
  return commit(next);
}

/* -------------------------------------------------------------------------- */
/* Deadlines and TICK (§7.6, §14)                                             */
/* -------------------------------------------------------------------------- */

/**
 * How long the state's clock runs, or null when nothing about it can expire.
 *
 * `deadline` is the single field the deadline sweeper queries on (§14), so this
 * is what decides whether a stored room is swept at all: it must be set on every
 * state that can expire and null on every state that cannot. A `LOBBY` waits on
 * the host, a `ROUND_END` on the next deal, and a `MATCH_END` on nothing.
 */
export function timeoutDurationMs(state: Pick<GameState, "status">): number | null {
  switch (state.status) {
    case "EXCHANGE":
      return EXCHANGE_DURATION_MS;
    case "IN_PROGRESS":
      return TURN_DURATION_MS;
    default:
      return null;
  }
}

/**
 * Stamp the deadline of a state the reducer just produced (§8.4 step 5).
 *
 * The server's half of the clock: `applyAction` has no `Date.now()` to reach for,
 * so it commits with a null deadline and the server writes this result in the
 * same transaction. Writing it separately, or forgetting it, leaves a room the
 * sweeper cannot see.
 *
 * It carries no `stateVersion` bump of its own: the stamp belongs to the write
 * the action already made, not to a second one.
 */
export function stampDeadline(state: GameState, now: number): GameState {
  const duration = timeoutDurationMs(state);
  const deadline = duration === null ? null : now + duration;
  return state.deadline === deadline ? state : { ...state, deadline };
}

/**
 * `TICK` (§7.6, §14): the only action that carries time.
 *
 * Three of the four branches here are about *not* playing the game. A tick before
 * the deadline returns the very same object, which is what makes a duplicate
 * sweep from a second instance safe: the `stateVersion` CAS then has nothing to
 * write and at most one transition lands per deadline. A state that can no longer
 * expire surrenders its stale deadline so the sweeper stops finding it. A state
 * that can expire but carries no deadline is given one from `now`, so a room
 * written without a stamp heals instead of stalling.
 *
 * The deadline a fired tick writes is measured from the deadline that *expired*,
 * never from `now`. That is what makes the acceptance property hold: replaying N
 * elapsed ticks against a stale state converges on the state ticking them live
 * would have produced, because neither the transition nor the next deadline
 * depends on when the sweeper happened to wake up.
 */
function tick(state: GameState, now: number): Result<GameState, ErrorCode> {
  const duration = timeoutDurationMs(state);

  if (duration === null) {
    if (state.deadline === null) return ok(state);
    return commit(draft(state), null);
  }
  if (state.deadline === null) return commit(draft(state), now + duration);
  if (now < state.deadline) return ok(state);

  const expired = state.deadline;
  const fired = state.status === "EXCHANGE" ? exchangeTimeout(state) : turnTimeout(state);
  if (!fired.ok) return fired;

  const nextDuration = timeoutDurationMs(fired.value);
  return ok({
    ...fired.value,
    deadline: nextDuration === null ? null : expired + nextDuration,
  });
}

/** The player a pending action is waiting on (§7.2). */
function pendingOwner(pending: PendingAction): string {
  return pending.type === "RESOLVE_7_PASS" ? pending.sourcePlayerId : pending.playerId;
}

/** A draft carrying the "the clock ran out on this player" line (§7.6). */
function timedOut(state: GameState, playerId: string): GameState {
  const next = draft(state);
  log(next, history("history.turnTimeout", { player: playerId }));
  return next;
}

/**
 * The turn clock expiring (§7.6).
 *
 * The table is short: an owed 7-pass or 10-discard submits the weakest `k`, a
 * leader plays the weakest legal single, and a follower passes. It runs whatever
 * the player's connection state is doing, which is the point — a dropped player
 * auto-passes on schedule and the table never stalls (§8.3).
 */
function turnTimeout(state: GameState): Result<GameState, ErrorCode> {
  const pending = state.pendingAction;
  if (pending !== null) {
    const owner = pendingOwner(pending);
    const cardIds = weakestSelection(state.hands[owner] ?? [], pending.count);
    const marked = timedOut(state, owner);
    return pending.type === "RESOLVE_7_PASS"
      ? submitSevenPass(marked, owner, cardIds)
      : submitTenDiscard(marked, owner, cardIds);
  }

  const playerId = activePlayerId(state);
  if (playerId === null || !isInRound(playerId, seatingOf(state))) {
    return skipTimedOutSeat(state, playerId);
  }
  if (state.currentTrick.length > 0) return pass(timedOut(state, playerId), playerId, true);

  const move = weakestLegalMove(state, playerId);
  if (move === null) return skipTimedOutSeat(state, playerId);
  return playCards(
    timedOut(state, playerId),
    playerId,
    move.cards.map((card) => card.id),
    move.bindings,
    true,
  );
}

/**
 * The weakest legal single, or the weakest legal play of any size if the hand
 * somehow holds no single (§7.6).
 *
 * Generation and legality are the same code the player's own client dims the hand
 * with (§10.3), so the timer can never play something a human could not have.
 * Moves come back weakest first, which is what makes the first single the right
 * one.
 */
function weakestLegalMove(state: GameState, playerId: string): PlayCombo | null {
  const moves = generateLegalMoves(state.hands[playerId] ?? [], trickContextOf(state));
  return moves.find((move) => move.cards.length === 1) ?? moves[0] ?? null;
}

/**
 * The fallback that keeps `TICK` total: pass the turn on without playing.
 *
 * Reachable only from a state that should not exist — an active seat belonging to
 * a player who has finished, been demoted, or left, or a hand with no legal move
 * at all. Advancing anyway is what stops a sweeper from spinning on a room it can
 * never move, which matters more here than being right about a state that is
 * already wrong.
 */
function skipTimedOutSeat(state: GameState, playerId: string | null): Result<GameState, ErrorCode> {
  const next = draft(state);
  if (playerId !== null) log(next, history("history.turnTimeout", { player: playerId }));

  if (inRoundPlayerIds(seatingOf(next)).length <= 1) {
    endRound(next);
    return commit(next);
  }
  if (next.currentTrick.length === 0) {
    const advanced = nextEligibleIndex(seatingOf(next), next.activePlayerIndex);
    if (advanced !== null) next.activePlayerIndex = advanced;
    return commit(next);
  }
  advanceOrClearTrick(next);
  return commit(next);
}

/**
 * The exchange clock expiring (§4.4): every rich player who never chose gives
 * their weakest cards, and the whole table transfers at once.
 *
 * The poor side has nothing to time out on — their cards were computed at phase
 * start (§4.3) — so the fill is only ever over `richPlayerIds`.
 */
function exchangeTimeout(state: GameState): Result<GameState, ErrorCode> {
  const exchange = state.exchange;
  if (exchange === null) return ok(state);

  const autoGiven = richPlayerIds(exchange).filter((id) => exchange.submitted[id] === undefined);
  const next = draft(state);
  const failed = completeExchange(next, autoFillExchange(exchange, state.hands), autoGiven);
  if (failed !== null) return err(failed);
  return commit(next);
}

/* -------------------------------------------------------------------------- */
/* Roster changes (§7.7)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Someone arrives (§7.7).
 *
 * Not a `ClientAction`: the roster is the server's to change (§8.1), and the
 * union in §2 carries no join. In the lobby the seat is taken immediately —
 * there is no round to wait for — and at any other status the player waits in
 * `pendingJoins` until the next deal, because `turnOrder` is never mutated
 * mid-round (§2).
 */
export function queueJoin(state: GameState, player: Player): Result<GameState, ErrorCode> {
  const leaving = new Set(state.pendingLeaves);
  const roster = [
    ...state.players.filter((seated) => !leaving.has(seated.id)),
    ...state.pendingJoins,
  ];

  if (roster.some((seated) => seated.id === player.id)) return err("INVALID_ACTION");
  if (roster.some((seated) => seated.name.toLowerCase() === player.name.toLowerCase())) {
    return err("NAME_TAKEN");
  }
  if (roster.length >= MAX_PLAYERS) return err("ROOM_FULL");

  const next = draft(state);
  // A newcomer carries no role: they played no previous round, so miyako-ochi
  // cannot read them as either side of its pairing (§4.5).
  const joining: Player = { ...player, role: null, seatIndex: state.players.length };

  if (state.status === "LOBBY") {
    next.players = [...state.players, joining].map((seated, seatIndex) => ({
      ...seated,
      seatIndex,
    }));
    next.turnOrder = next.players.map((seated) => seated.id);
    next.hands[player.id] = [];
    next.points = { ...state.points, [player.id]: 0 };
  } else {
    next.pendingJoins = [...state.pendingJoins, joining];
  }

  log(next, history("history.playerJoined", { player: player.id }));
  return commit(next);
}

/**
 * Someone leaves (§7.7).
 *
 * The seat itself goes at the next round boundary, but the round they were in
 * cannot wait: they are treated as finishing **last**, so their hand goes to the
 * graveyard, eligibility loses them, and they take a place in `droppedPlayerIds`
 * — above a miyako-ochi demotion, which stays its last entry absolutely (§4.5).
 * The round then continues without them.
 *
 * Idempotent: a second leave from the same player is not an error, because a
 * disconnect and an explicit leave can race.
 */
export function queueLeave(state: GameState, playerId: string): Result<GameState, ErrorCode> {
  if (state.pendingLeaves.includes(playerId)) return ok(state);

  const expected = state.pendingJoins.some((player) => player.id === playerId);
  if (playerOf(state, playerId) === undefined && !expected) return err("PLAYER_NOT_FOUND");

  const next = draft(state);
  log(next, history("history.playerLeft", { player: playerId }));

  // Never seated: they simply stop arriving, and nothing else in the state knows
  // about them yet.
  if (expected) {
    next.pendingJoins = state.pendingJoins.filter((player) => player.id !== playerId);
    return commit(next);
  }

  if (state.status === "LOBBY") {
    next.players = state.players
      .filter((player) => player.id !== playerId)
      .map((player, seatIndex) => ({ ...player, seatIndex }));
    next.turnOrder = next.players.map((player) => player.id);
    next.hands = { ...next.hands };
    delete next.hands[playerId];
    next.points = { ...state.points };
    delete next.points[playerId];
    transferHost(next, playerId);
    return commit(next);
  }

  next.pendingLeaves = [...state.pendingLeaves, playerId];
  transferHost(next, playerId);

  if (state.status === "EXCHANGE" || state.status === "IN_PROGRESS") {
    const failed = dropFromRound(next, playerId);
    if (failed !== null) return err(failed);
  }
  return commit(next);
}

/**
 * The host leaving hands the room on to the longest-seated player who is staying
 * (§8.2).
 *
 * Immediate rather than deferred to the boundary, because `START_GAME` is
 * host-only: a room whose host walked out between rounds would otherwise have
 * nobody who could deal the next one.
 */
function transferHost(next: GameState, departingId: string): void {
  if (next.hostId !== departingId) return;
  const leaving = new Set([...next.pendingLeaves, departingId]);
  const heir = next.players.find((player) => !leaving.has(player.id));
  if (heir === undefined) return;
  next.hostId = heir.id;
  log(next, history("history.hostTransferred", { player: heir.id }));
}

/**
 * Take a leaver out of the round they were playing (§7.7).
 *
 * Their hand goes to the graveyard — card conservation is a sum over hands, trick
 * and graveyard (§12.3), so it is the only place it can go — and `turnOrder` is
 * left exactly as it was: they stop being eligible, they are not removed (§2).
 */
function dropFromRound(next: GameState, playerId: string): ErrorCode | null {
  const before = seatingOf(next);
  // Already at the bottom of the finish order: a miyako-ochi demotion (§4.5) or a
  // second leave. Inserting again would duplicate them in the dropped block.
  if (hasDropped(playerId, before)) return null;
  const finished = hasFinished(playerId, before);

  const hand = next.hands[playerId] ?? [];
  next.graveyard = [...next.graveyard, ...hand];
  next.hands[playerId] = [];
  next.droppedPlayerIds = insertLeaver(next.droppedPlayerIds, playerId, demotedThisRound(next));

  // Leaving after an agari still costs the place: §7.7 makes a mid-round leaver
  // last, and `finishOrderOf` reads an id in both lists as dropped — the later and
  // lower of the two facts. Nothing else moves: they were already out of
  // eligibility, out of the in-round count, and neither the active player nor the
  // owner or target of a pending action (a 7-pass never targets a finished seat).
  if (finished) return null;

  if (next.status === "EXCHANGE") return withdrawFromRoundExchange(next, playerId);

  // A pending action nobody is left to answer would halt the pipeline forever, so
  // the play that set it resumes without the transfer (§7.2). Phase C will not
  // read the emptied hand as an agari: they are already dropped.
  const pending = next.pendingAction;
  if (pending !== null && pendingOwner(pending) === playerId) {
    const combo = pendingCombo(next);
    next.pendingAction = null;
    if (combo !== null) {
      resumePipeline(next, playerId, combo);
      return null;
    }
  }

  // The recipient of an owed 7-pass leaving: the cards cannot follow them into a
  // departed seat, so the transfer retargets to the nearest player still in the
  // round to the left of the source — the same predicate that chose the target in
  // the first place (§6). With nobody left to give to, the pending action is what
  // Phase B would never have set, and the pipeline runs on without it (§7.2).
  if (
    pending !== null &&
    pending.type === "RESOLVE_7_PASS" &&
    pending.targetPlayerId === playerId
  ) {
    const source = pending.sourcePlayerId;
    const retarget = sevenPassTarget(source, seatingOf(next));
    if (retarget !== null) {
      next.pendingAction = { ...pending, targetPlayerId: retarget };
    } else {
      const combo = pendingCombo(next);
      next.pendingAction = null;
      if (combo !== null) {
        resumePipeline(next, source, combo);
        return null;
      }
    }
  }

  if (inRoundPlayerIds(seatingOf(next)).length <= 1) {
    endRound(next);
    return null;
  }
  if (activePlayerId(next) !== playerId) return null;

  // They were to act. With no trick in front of them they held the lead, which
  // moves to the nearest eligible seat to their left; otherwise the turn passes
  // exactly as a pass would move it.
  if (next.currentTrick.length === 0) {
    const advanced = nextEligibleIndex(seatingOf(next), next.activePlayerIndex);
    if (advanced !== null) {
      next.activePlayerIndex = advanced;
      next.trickLeaderId = next.turnOrder[advanced] ?? next.trickLeaderId;
      log(next, history("history.leadPassed", { leader: next.trickLeaderId ?? "" }));
    }
    return null;
  }
  advanceOrClearTrick(next);
  return null;
}

/**
 * A leave during the exchange (§4.3, §7.7): the pair dissolves.
 *
 * Their partner keeps their hand rather than giving it to nobody, and the phase
 * completes early if they were the last player it was waiting on — including the
 * degenerate case where dissolving the pair leaves nothing to wait for at all.
 */
function withdrawFromRoundExchange(next: GameState, playerId: string): ErrorCode | null {
  const exchange = next.exchange;
  if (exchange === null) return null;

  const withdrawn = withdrawFromExchange(exchange, playerId);
  next.exchange = withdrawn;
  if (!isExchangeComplete(withdrawn)) return null;
  return completeExchange(next, withdrawn);
}

/**
 * The player miyako-ochi demoted in the round now running, or null (§4.5).
 *
 * Read from the history, which records the demotion as it happens, rather than
 * inferred from the shape of `droppedPlayerIds`. The block itself cannot tell its
 * two kinds of entry apart once the demoted player *also* leaves the room: they
 * are then in `pendingLeaves` like any other leaver, and a later departure would
 * be filed below them — which is the one placement §4.5 forbids.
 *
 * The scan stops at this round's `roundStarted` entry, so a demotion from an
 * earlier round of the same match is not read as this one's.
 */
function demotedThisRound(state: GameState): string | null {
  for (let index = state.history.length - 1; index >= 0; index--) {
    const entry = state.history[index];
    if (entry === undefined || entry.key === "history.roundStarted") return null;
    if (entry.key === "history.miyakoOchi") return String(entry.params.target);
  }
  return null;
}

/**
 * Where a leaver sits in `droppedPlayerIds` (§4.5, §7.7).
 *
 * The block is ordered best-placed first, leavers in the order they left, and a
 * miyako-ochi demotion is always its last element — the rule is absolute in that
 * direction. So a leaver goes in immediately before the demotion, and simply on
 * the end when there is no demotion to stay behind.
 */
function insertLeaver(
  dropped: readonly string[],
  playerId: string,
  demoted: string | null,
): string[] {
  const index = demoted === null ? -1 : dropped.indexOf(demoted);
  if (index === -1) return [...dropped, playerId];
  return [...dropped.slice(0, index), playerId, ...dropped.slice(index)];
}

/**
 * The roster the next deal runs on (§7.7): everyone still here, then everyone
 * who arrived while the round was running.
 */
function rosterAfterChanges(state: GameState): Player[] {
  const leaving = new Set(state.pendingLeaves);
  const staying = state.players.filter((player) => !leaving.has(player.id));
  const arriving = state.pendingJoins.filter(
    (player) => !leaving.has(player.id) && !staying.some((seated) => seated.id === player.id),
  );
  return [...staying, ...arriving];
}

/**
 * The finish order the next round reseats and pairs against (§3.2, §4.2, §7.7).
 *
 * It is the round just ended, restricted to the players who are still here.
 * Newcomers have no finish position at all, so they enter at the bottom: they
 * deal, they sit furthest from the winner, and they take the poor side of their
 * exchange pair. The spec fixes the roster the exchange uses but not where an
 * arrival lands in it; the bottom is the only end that costs a seated player
 * nothing they earned.
 */
function previousFinishOrder(state: GameState, rosterIds: readonly string[]): string[] {
  const played = finishOrderOf(
    state.finishedPlayerIds,
    state.turnOrder,
    state.droppedPlayerIds,
  ).filter((id) => rosterIds.includes(id));
  const arrived = rosterIds.filter((id) => !played.includes(id));
  return [...played, ...arrived];
}
