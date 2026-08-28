/**
 * The reducer (§7): `applyAction(state, action, playerId)`.
 *
 * Pure, and the purity is load-bearing. Randomness enters only through
 * `START_GAME.seed`, which `deck.ts` turns into a seeded PRNG; time enters only
 * through `TICK`. There is no `Date.now()` and no `Math.random()` in this package,
 * so replaying a stored seed reproduces a round exactly and a Firestore
 * transaction retry is safe (§14).
 *
 * Because the reducer has no clock, it does not stamp `deadline`: it nulls it on
 * every applied action, and the server sets the new one when it arms the timer
 * (§8.4 step 5). `TICK` — the one action that carries time — belongs to §7.6 and
 * is a no-op here.
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
import { checkLegality, invertedIn, trickContextOf } from "./evaluator.js";
import { takeFromHand } from "./hand.js";
import { type ErrorCode, history, roleKey } from "./i18n-keys.js";
import {
  applyExchange,
  assignRoles,
  createExchangeState,
  finishOrderOf,
  isExchangeComplete,
  needsExchange,
  roundPoints,
  submitExchange,
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
  shibariLock,
  spade3BeatsJoker,
  tenDiscardPending,
} from "./rules/index.js";
import {
  eligiblePlayerIds,
  inRoundPlayerIds,
  isInRound,
  nextEligibleIndex,
  seatIndexOf,
  seatingOf,
} from "./turnOrder.js";
import type {
  Card,
  ClientAction,
  GameState,
  HouseRulesConfig,
  JokerBinding,
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
      // Timeout semantics are §7.6 and land with the roster changes they share a
      // boundary with. Until then time never advances the game, which is the
      // conservative half of "a TICK before `deadline` is a no-op" (§14).
      return ok(state);
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

/** The one place `stateVersion` is bumped and `deadline` is surrendered (§8.4). */
function commit(next: GameState): Result<GameState, ErrorCode> {
  return ok({ ...next, stateVersion: next.stateVersion + 1, deadline: null });
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
  if (state.players.length < MIN_PLAYERS) return err("NOT_ENOUGH_PLAYERS");
  if (state.players.length > MAX_PLAYERS) return err("TOO_MANY_PLAYERS");

  const rng = createRng(seed);
  const first = state.status === "LOBBY";
  const next = draft(state);

  const turnOrder = first
    ? state.turnOrder
    : reseat(finishOrderOf(state.finishedPlayerIds, state.turnOrder, state.droppedPlayerIds));
  const dealerIndex = first ? pickDealerIndex(turnOrder.length, rng) : 0;

  next.roundNumber = state.roundNumber + 1;
  next.turnOrder = [...turnOrder];
  next.players = turnOrder.flatMap((id, seatIndex) => {
    const player = playerOf(state, id);
    return player === undefined ? [] : [{ ...player, seatIndex }];
  });
  next.dealerId = turnOrder[dealerIndex] ?? state.dealerId;
  next.hands = deal(shuffle(createDeck(), rng), turnOrder, dealerIndex);

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
    const finishOrder = finishOrderOf(
      state.finishedPlayerIds,
      state.turnOrder,
      state.droppedPlayerIds,
    );
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
  const leaderId = openingLeaderId(next.hands) ?? next.turnOrder[0] ?? null;
  next.status = "IN_PROGRESS";
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

  const hands = applyExchange(submitted.value, state.hands);
  if (!hands.ok) return hands;

  for (const [giver, recipient] of Object.entries(submitted.value.partner)) {
    const given = submitted.value.forced[giver] ?? submitted.value.submitted[giver] ?? [];
    log(
      next,
      history(
        "history.exchangeGave",
        { player: giver, target: recipient, cards: given.join(" "), count: given.length },
        { privateCardParams: ["cards"], visibleTo: [giver, recipient] },
      ),
    );
  }

  next.hands = hands.value;
  next.exchange = null;
  log(next, history("history.exchangeCompleted", { round: next.roundNumber }));
  beginTrickPlay(next);
  return commit(next);
}

/* -------------------------------------------------------------------------- */
/* PLAY_CARDS (§7.1)                                                          */
/* -------------------------------------------------------------------------- */

function playCards(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
  bindings?: readonly JokerBinding[],
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
    history("history.played", {
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
  if ((next.hands[playerId]?.length ?? 0) === 0 && !next.finishedPlayerIds.includes(playerId)) {
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

function pass(state: GameState, playerId: string): Result<GameState, ErrorCode> {
  if (state.status !== "IN_PROGRESS") return err("WRONG_STATUS");
  if (state.pendingAction !== null) return err("PENDING_ACTION_BLOCKS");
  if (activePlayerId(state) !== playerId) return err("NOT_YOUR_TURN");
  if (state.currentTrick.length === 0) return err("CANNOT_PASS_AS_LEADER");
  if (state.passedPlayerIds.includes(playerId)) return err("ALREADY_PASSED");

  const next = draft(state);
  next.passedPlayerIds = [...state.passedPlayerIds, playerId];
  log(next, history("history.passed", { player: playerId }));

  // Everyone except one has passed: the trick returns to whoever last played.
  //
  // "Except one" is measured against the trick leader, not against a raw count.
  // Normally the leader is the one player left eligible and the two readings
  // agree, but a leader who has finished or been demoted (§4.5) is not eligible
  // at all, and counting seats alone would then clear the trick one pass early —
  // robbing the last eligible player of the turn in which they could have beaten
  // the play still sitting on the table.
  const stillOwedATurn = eligiblePlayerIds(seatingOf(next)).filter(
    (id) => id !== next.trickLeaderId,
  );
  if (stillOwedATurn.length === 0) {
    log(next, history("history.allPassed", { leader: next.trickLeaderId ?? "" }));
    clearTrick(next, next.trickLeaderId);
    return commit(next);
  }

  const advanced = nextEligibleIndex(seatingOf(next), next.activePlayerIndex);
  if (advanced !== null) next.activePlayerIndex = advanced;
  return commit(next);
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
  log(
    next,
    history(
      "history.tenDiscard",
      {
        player: playerId,
        cards: discard.value.discarded.map((card) => card.id).join(" "),
        count: discard.value.discarded.length,
      },
      { privateCardParams: ["cards"], visibleTo: [playerId] },
    ),
  );

  resumePipeline(next, playerId, combo);
  return commit(next);
}
