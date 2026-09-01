/**
 * The fuzz harness (§12.3 test 24).
 *
 * Drives whole *matches* — deal, exchange, trick play, round end, reseat, deal
 * again — at 3 to 8 players, choosing every action from `generateLegalMoves` and
 * the same submission shapes a client can send, and checking invariants 21-23
 * (`tests/invariants.ts`) plus the reachable-state and finish-order properties in
 * `checks.ts` after every single one.
 *
 * Multi-round is not a luxury. Miyako-ochi (§4.5) reads the roles the *previous*
 * round assigned, so a harness that dealt one round and stopped could never reach
 * the demotion at all, and the demotion is exactly the transition that moves a
 * whole hand to the graveyard and takes a seat out of the round while `turnOrder`
 * keeps its length.
 *
 * A failure that cannot be reproduced is worthless, so nothing here throws: a run
 * returns its seed, the exact step log, and the failure text. The log is
 * self-describing — every step carries the player, the action and the clock
 * reading it was applied at — which makes a replay a pure function of the log,
 * with no PRNG in it. That is what lets `shrink` cut the log down to a minimal
 * sequence that still fails before anything is reported.
 *
 * The harness also plays the server's half of the clock (§8.4 step 5): the
 * reducer commits a null `deadline` and the driver stamps the new one in the same
 * step, exactly as the room does. Ticks are aimed at the deadline that is
 * standing, so the timeout paths of §7.6 are fuzzed alongside the voluntary ones
 * rather than being a separate mode.
 */
import { createRng, type Rng } from "../../src/deck.js";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  activePlayerId,
  applyAction,
  createGameState,
  queueJoin,
  queueLeave,
  stampDeadline,
} from "../../src/engine.js";
import { DEFAULT_HOUSE_RULES } from "../../src/config.js";
import { generateLegalMoves, trickContextOf } from "../../src/evaluator.js";
import { richPlayerIds } from "../../src/roles.js";
import type {
  Card,
  ClientAction,
  ClientActionType,
  ErrorCode,
  GameState,
  HouseRuleKey,
  Player,
  Result,
} from "../../src/index.js";
import { transitionErrors } from "../invariants.js";
import { roundEndErrors, stateErrors } from "./checks.js";

/** The reducer under test. Injectable so a deliberately broken one can be run. */
export type ApplyFn = (
  state: GameState,
  action: ClientAction,
  playerId: string,
) => Result<GameState, ErrorCode>;

/** Ticks are injected by the server, which is nobody's seat (§8.4). */
const SERVER_ID = "server";

/** An arbitrary but fixed epoch. The reducer only ever compares against it. */
const CLOCK_START = 1_700_000_000_000;

/**
 * One applied step, in a form that replays without re-deciding anything.
 *
 * `now` is the clock reading the step was applied at: the driver stamps the
 * deadline from it, so replaying a log reproduces every timeout too.
 */
export type FuzzStep =
  | { kind: "ACTION"; playerId: string; action: ClientAction; now: number }
  | { kind: "JOIN"; player: Player; now: number }
  | { kind: "LEAVE"; playerId: string; now: number };

export interface FuzzMatchOptions {
  seed: string;
  playerCount: number;
  /** Rounds to play before stopping. Two is the minimum that can reach §4.5. */
  rounds?: number;
  /** Queue joins and leaves mid-match as well (§7.7). */
  rosterChurn?: boolean;
  /** Defaults to `applyAction`. */
  apply?: ApplyFn;
  maxSteps?: number;
}

export interface FuzzStats {
  steps: number;
  rounds: number;
  plays: number;
  passes: number;
  ticks: number;
  timeouts: number;
  miyakoOchi: number;
  joins: number;
  leaves: number;
  /** How many of each action type were applied, for the §12.3 coverage gate. */
  actions: Partial<Record<ClientActionType, number>>;
}

export interface FuzzFailure {
  seed: string;
  playerCount: number;
  reason: string;
  /** The minimal log that still fails, after shrinking. */
  steps: FuzzStep[];
  /** Printable: the seed, the reason, and the log, ready to paste into a test. */
  report: string;
}

export type FuzzResult =
  { ok: true; stats: FuzzStats } | { ok: false; failure: FuzzFailure; stats: FuzzStats };

/* -------------------------------------------------------------------------- */
/* Random choices                                                             */
/* -------------------------------------------------------------------------- */

function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

/** `count` distinct cards from a hand, chosen without replacement. */
function pickCards(rng: Rng, hand: readonly Card[], count: number): string[] {
  const pool = [...hand];
  const chosen: string[] = [];
  for (let taken = 0; taken < count && pool.length > 0; taken++) {
    const index = Math.floor(rng() * pool.length);
    chosen.push(pool[index]?.id ?? "");
    pool.splice(index, 1);
  }
  return chosen;
}

/* -------------------------------------------------------------------------- */
/* Applying a step                                                            */
/* -------------------------------------------------------------------------- */

function player(id: string, seatIndex: number): Player {
  return { id, name: id.toUpperCase(), role: null, seatIndex, isReady: true, isConnected: true };
}

function lobbyOf(playerCount: number): GameState {
  const players = Array.from({ length: playerCount }, (_, index) => player(`p${index}`, index));
  return createGameState({ roomId: "fuzz", hostId: "p0", players });
}

/**
 * Apply one step the way the room does (§8.4): the reducer runs, then the
 * deadline is stamped from the clock in the same write.
 *
 * `TICK` is the exception, and it matters: a fired tick re-arms off the deadline
 * that expired rather than off `now` (§14), so stamping over it would erase the
 * one property that makes a late sweep converge with a punctual one.
 */
function applyStep(apply: ApplyFn, state: GameState, step: FuzzStep): Result<GameState, ErrorCode> {
  const applied =
    step.kind === "ACTION"
      ? apply(state, step.action, step.playerId)
      : step.kind === "JOIN"
        ? queueJoin(state, step.player)
        : queueLeave(state, step.playerId);
  if (!applied.ok) return applied;
  const isTick = step.kind === "ACTION" && step.action.type === "TICK";
  return { ok: true, value: isTick ? applied.value : stampDeadline(applied.value, step.now) };
}

/** Every failure one transition can produce, in one list. */
function transitionFailures(before: GameState, after: GameState, demoted: string[]): string[] {
  return [
    ...transitionErrors(before, after),
    ...stateErrors(after),
    ...roundEndErrors(before, after, demoted),
  ];
}

/** The players miyako-ochi demoted between two states, read from the history. */
function demotedBetween(before: GameState, after: GameState): string[] {
  return after.history
    .slice(before.history.length)
    .filter((entry) => entry.key === "history.miyakoOchi")
    .map((entry) => String(entry.params.target));
}

/* -------------------------------------------------------------------------- */
/* Choosing the next step                                                     */
/* -------------------------------------------------------------------------- */

/** A tick aimed at the deadline that is standing, so it actually fires (§7.6). */
function tickStep(state: GameState, now: number): FuzzStep {
  const at = Math.max(now, state.deadline ?? now);
  return { kind: "ACTION", playerId: SERVER_ID, action: { type: "TICK", now: at }, now: at };
}

/** Who is still going to be dealt to, were the round to end now (§7.7). */
function stayingIds(state: GameState): string[] {
  return state.players.map((seated) => seated.id).filter((id) => !state.pendingLeaves.includes(id));
}

function rosterStep(state: GameState, rng: Rng, now: number, nextJoinId: number): FuzzStep | null {
  const staying = stayingIds(state);
  const roster = staying.length + state.pendingJoins.length;

  if (chance(rng, 0.4) && roster < MAX_PLAYERS) {
    return { kind: "JOIN", player: player(`q${nextJoinId}`, roster), now };
  }
  // A leave that would take the next deal below three players is not a case the
  // engine is meant to survive (§0): the room would simply sit in `ROUND_END`.
  if (staying.length - 1 < MIN_PLAYERS) return null;
  return { kind: "LEAVE", playerId: pick(rng, staying), now };
}

function exchangeStep(state: GameState, rng: Rng, now: number): FuzzStep {
  const exchange = state.exchange;
  if (exchange === null) return tickStep(state, now);

  const owing = richPlayerIds(exchange).filter(
    (id) => exchange.submitted[id] === undefined && !state.pendingLeaves.includes(id),
  );
  if (owing.length === 0 || chance(rng, 0.15)) return tickStep(state, now);

  const giver = pick(rng, owing);
  const count = exchange.required[giver] ?? 0;
  const hand = state.hands[giver] ?? [];
  if (count === 0 || hand.length < count) return tickStep(state, now);

  return {
    kind: "ACTION",
    playerId: giver,
    action: { type: "EXCHANGE_CARDS", cardIds: pickCards(rng, hand, count) },
    now,
  };
}

function playStep(state: GameState, rng: Rng, now: number): FuzzStep {
  const pending = state.pendingAction;
  if (pending !== null) {
    if (chance(rng, 0.15)) return tickStep(state, now);
    const owner = pending.type === "RESOLVE_7_PASS" ? pending.sourcePlayerId : pending.playerId;
    const hand = state.hands[owner] ?? [];
    if (hand.length < pending.count) return tickStep(state, now);
    const cardIds = pickCards(rng, hand, pending.count);
    return {
      kind: "ACTION",
      playerId: owner,
      action:
        pending.type === "RESOLVE_7_PASS"
          ? { type: "SUBMIT_7_PASS", cardIds }
          : { type: "SUBMIT_10_DISCARD", cardIds },
      now,
    };
  }

  const active = activePlayerId(state);
  if (active === null) return tickStep(state, now);
  if (chance(rng, 0.08)) return tickStep(state, now);

  const moves = generateLegalMoves(state.hands[active] ?? [], trickContextOf(state));
  const canPass = state.currentTrick.length > 0 && !state.passedPlayerIds.includes(active);

  if (moves.length > 0 && (!canPass || chance(rng, 0.75))) {
    const move = pick(rng, moves);
    return {
      kind: "ACTION",
      playerId: active,
      action: {
        type: "PLAY_CARDS",
        cardIds: move.cards.map((card) => card.id),
        ...(move.bindings.length > 0 ? { bindings: move.bindings } : {}),
      },
      now,
    };
  }
  if (canPass) return { kind: "ACTION", playerId: active, action: { type: "PASS" }, now };
  return tickStep(state, now);
}

/* -------------------------------------------------------------------------- */
/* The driver                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Play one match and check every transition it produces.
 *
 * The loop stops at the requested round count, and a match that has not finished
 * within `maxSteps` is itself a failure: a state that admits no progressing
 * action would otherwise show up as a hung test rather than as the deadlock it
 * is. The other half of "no deadlock" is invariant 23 — a step that leaves
 * `stateVersion` where it was made no progress — which `transitionErrors` already
 * reports, so a state nothing can move is caught either way.
 */
export function runFuzzMatch(options: FuzzMatchOptions): FuzzResult {
  const rounds = options.rounds ?? 3;
  const maxSteps = options.maxSteps ?? 400 * rounds;
  const apply = options.apply ?? applyAction;
  const rng = createRng(`fuzz|${options.seed}|${options.playerCount}`);

  const stats: FuzzStats = {
    steps: 0,
    rounds: 0,
    plays: 0,
    passes: 0,
    ticks: 0,
    timeouts: 0,
    miyakoOchi: 0,
    joins: 0,
    leaves: 0,
    actions: {},
  };
  const log: FuzzStep[] = [];
  let state = lobbyOf(options.playerCount);
  let clock = CLOCK_START;
  let joinId = 0;
  let demotedThisRound: string[] = [];

  const fail = (reason: string, signature: string = reason): FuzzResult => ({
    ok: false,
    failure: shrinkFailure(options, log, reason, signature),
    stats,
  });

  while (stats.rounds < rounds) {
    if (state.status === "MATCH_END") break;
    if (log.length >= maxSteps) {
      return fail(`the match did not finish within ${maxSteps} steps: nothing is progressing`);
    }

    clock += 500 + Math.floor(rng() * 4000);
    const churn =
      options.rosterChurn === true && state.status !== "LOBBY" && chance(rng, 0.015)
        ? rosterStep(state, rng, clock, joinId)
        : null;
    const step = churn ?? nextStep(state, rng, clock, options);
    if (step === null) return fail(`no action is available from status ${state.status}`);
    if (step.kind === "JOIN") joinId++;

    const applied = applyStep(apply, state, step);
    log.push(step);
    clock = step.now;
    if (!applied.ok) {
      return fail(refusalReason(log.length - 1, applied.error), refusalSignature(applied.error));
    }

    const next = applied.value;
    const demoted = demotedBetween(state, next);
    demotedThisRound = [...demotedThisRound, ...demoted];
    const failures = transitionFailures(state, next, demotedThisRound);
    if (failures.length > 0) return fail(failures.join("; "));

    record(stats, step, demoted.length, state, next);
    if (next.roundNumber !== state.roundNumber) demotedThisRound = [];
    state = next;
  }

  return { ok: true, stats };
}

/** The step to take from a state the match is still running through. */
function nextStep(
  state: GameState,
  rng: Rng,
  now: number,
  options: FuzzMatchOptions,
): FuzzStep | null {
  switch (state.status) {
    case "LOBBY":
    case "ROUND_END":
      return chance(rng, 0.12)
        ? hostStep(state, rng, now, options)
        : {
            kind: "ACTION",
            playerId: state.hostId,
            action: { type: "START_GAME", seed: `${options.seed}#${state.roundNumber + 1}` },
            now,
          };
    case "EXCHANGE":
      return exchangeStep(state, rng, now);
    case "IN_PROGRESS":
      return playStep(state, rng, now);
    default:
      return null;
  }
}

/**
 * The host fiddling between rounds (§8.2, §10.11): a rule toggle or a round
 * limit.
 *
 * Worth fuzzing rather than leaving to the unit tests, because a toggle changes
 * what the evaluator will accept in the round that follows — the harness plays
 * the rest of the match against whatever config it just wrote. A reachable round
 * limit is taken rarely: it ends the match, and a match that stops early is a
 * match that fuzzed fewer rounds.
 */
function hostStep(state: GameState, rng: Rng, now: number, options: FuzzMatchOptions): FuzzStep {
  if (chance(rng, 0.5)) {
    const key = pick(rng, Object.keys(DEFAULT_HOUSE_RULES) as HouseRuleKey[]);
    return {
      kind: "ACTION",
      playerId: state.hostId,
      action: { type: "UPDATE_RULES", config: { [key]: chance(rng, 0.8) } },
      now,
    };
  }
  const reachable = state.roundNumber + 1 + Math.floor(rng() * 2);
  const beyond = state.roundNumber + (options.rounds ?? 3) + 1;
  return {
    kind: "ACTION",
    playerId: state.hostId,
    action: {
      type: "SET_ROUND_LIMIT",
      limit: chance(rng, 0.4) ? null : chance(rng, 0.2) ? reachable : beyond,
    },
    now,
  };
}

function record(
  stats: FuzzStats,
  step: FuzzStep,
  demotions: number,
  before: GameState,
  after: GameState,
): void {
  stats.steps++;
  stats.miyakoOchi += demotions;
  if (step.kind === "JOIN") stats.joins++;
  if (step.kind === "LEAVE") stats.leaves++;
  if (step.kind === "ACTION") {
    stats.actions[step.action.type] = (stats.actions[step.action.type] ?? 0) + 1;
    if (step.action.type === "PLAY_CARDS") stats.plays++;
    if (step.action.type === "PASS") stats.passes++;
    if (step.action.type === "TICK") {
      stats.ticks++;
      if (after.history.length > before.history.length) stats.timeouts++;
    }
  }
  if (after.status === "ROUND_END" || after.status === "MATCH_END") {
    if (before.status !== after.status) stats.rounds++;
  }
}

/* -------------------------------------------------------------------------- */
/* Replay and shrinking                                                       */
/* -------------------------------------------------------------------------- */

export interface ReplayFailure {
  index: number;
  /**
   * What went wrong, free of where it went wrong.
   *
   * A refusal reads as `step 40 was refused with ...` for a human, and the step
   * number moves every time shrinking deletes an earlier step. Shrinking has to
   * ask whether the *same* failure survived a deletion, so it compares this —
   * the error code or the invariant text — and leaves the numbering to `reason`.
   */
  signature: string;
  reason: string;
}

/**
 * Replay a log against a fresh lobby, returning the first failure.
 *
 * No PRNG: every choice was recorded, so this is a pure function of the log and
 * the reducer. That is the whole point of the step shape — a reported failure is
 * reproducible by anyone who has the log, and shrinking can ask "does this
 * shorter log still fail the same way?" and get an answer it can trust.
 */
export function replayFuzzLog(
  steps: readonly FuzzStep[],
  options: Pick<FuzzMatchOptions, "playerCount" | "apply">,
): ReplayFailure | null {
  const apply = options.apply ?? applyAction;
  let state = lobbyOf(options.playerCount);
  let demotedThisRound: string[] = [];

  for (const [index, step] of steps.entries()) {
    const applied = applyStep(apply, state, step);
    if (!applied.ok) {
      return {
        index,
        signature: refusalSignature(applied.error),
        reason: refusalReason(index, applied.error),
      };
    }

    const next = applied.value;
    demotedThisRound = [...demotedThisRound, ...demotedBetween(state, next)];
    const failures = transitionFailures(state, next, demotedThisRound);
    if (failures.length > 0) {
      const reason = failures.join("; ");
      return { index, signature: reason, reason };
    }
    if (next.roundNumber !== state.roundNumber) demotedThisRound = [];
    state = next;
  }
  return null;
}

/**
 * Cut a failing log down to a minimal one that fails the same way.
 *
 * Two passes over the same idea. The log is first truncated at the step that
 * failed — everything after it is irrelevant by construction — and then each
 * earlier step is removed in turn and the remainder replayed. A step whose
 * removal makes the failure disappear, or makes a later step illegal, is put
 * back; a step nothing depends on is gone for good. What is left is a sequence in
 * which every step is load-bearing, which is the difference between a bug report
 * someone can read and a four-hundred-step transcript nobody will.
 */
export function shrinkFuzzLog(
  steps: readonly FuzzStep[],
  options: Pick<FuzzMatchOptions, "playerCount" | "apply">,
  signature: string,
): FuzzStep[] {
  const original = replayFuzzLog(steps, options);
  // The failure has to reproduce before it can be shrunk. It always does — the
  // driver just produced it from the same steps — but a harness that quietly
  // shrank a *different* failure would be worse than one that shrank nothing.
  if (original === null || original.signature !== signature) return [...steps];

  let best = steps.slice(0, original.index + 1);
  let removedSomething = true;
  let budget = 4000;

  while (removedSomething && budget > 0) {
    removedSomething = false;
    for (let index = best.length - 2; index >= 0 && budget > 0; index--) {
      budget--;
      const candidate = [...best.slice(0, index), ...best.slice(index + 1)];
      const replayed = replayFuzzLog(candidate, options);
      if (replayed === null || replayed.signature !== signature) continue;
      best = candidate.slice(0, replayed.index + 1);
      removedSomething = true;
    }
  }
  return best;
}

function shrinkFailure(
  options: FuzzMatchOptions,
  steps: readonly FuzzStep[],
  reason: string,
  signature: string,
): FuzzFailure {
  const minimal = shrinkFuzzLog(steps, options, signature);
  // A refusal names its step, and shrinking renumbers it, so the reported reason
  // is the one the minimal log actually produces. A failure the replay cannot
  // reproduce at all — a deadlock, or a state offering no action — never came
  // from a step in the first place, and keeps the driver's wording.
  const replayed = replayFuzzLog(minimal, options);
  const reported = replayed !== null && replayed.signature === signature ? replayed.reason : reason;
  return {
    seed: options.seed,
    playerCount: options.playerCount,
    reason: reported,
    steps: minimal,
    report: reportOf(options, minimal, reported),
  };
}

/** The refusal wording a reader sees, with the step it happened at. */
function refusalReason(index: number, error: string): string {
  return `step ${index} was refused with ${error}`;
}

/** The same refusal without the index: what shrinking matches on. */
function refusalSignature(error: string): string {
  return `refused with ${error}`;
}

/** The printable failure: seed, reason, and a log that can be pasted into a test. */
function reportOf(options: FuzzMatchOptions, steps: readonly FuzzStep[], reason: string): string {
  const lines = steps.map((step, index) => `  ${index}: ${describeStep(step)}`);
  return [
    `fuzz failure at ${options.playerCount} players, seed ${JSON.stringify(options.seed)}`,
    `  ${reason}`,
    "",
    "replay with:",
    `  replayFuzzLog(steps, { playerCount: ${options.playerCount} })`,
    "",
    `minimal action log (${steps.length} steps):`,
    ...lines,
    "",
    "as JSON:",
    JSON.stringify(steps),
  ].join("\n");
}

function describeStep(step: FuzzStep): string {
  if (step.kind === "JOIN") return `JOIN ${step.player.id}`;
  if (step.kind === "LEAVE") return `LEAVE ${step.playerId}`;
  const action = step.action;
  const detail =
    action.type === "PLAY_CARDS"
      ? ` ${action.cardIds.join(" ")}`
      : action.type === "SUBMIT_7_PASS" ||
          action.type === "SUBMIT_10_DISCARD" ||
          action.type === "EXCHANGE_CARDS"
        ? ` ${action.cardIds.join(" ")}`
        : action.type === "START_GAME"
          ? ` seed=${action.seed}`
          : action.type === "TICK"
            ? ` now=${action.now}`
            : "";
  return `${step.playerId} ${action.type}${detail}`;
}
