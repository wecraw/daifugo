/**
 * §12.3 test 24: the fuzz run.
 *
 * Thousands of full rounds at 3 through 8 players, every action drawn from
 * `generateLegalMoves` or from the same submission shapes a client can send, with
 * invariants 21-23 and the reachable-state properties of `fuzz/checks.ts`
 * asserted after every one. The driver lives in `fuzz/harness.ts`; this file is
 * the seed set, the gate, and the proof that the gate is not vacuous.
 *
 * Matches are multi-round on purpose. Miyako-ochi (§4.5) reads the roles the
 * previous round assigned, so it is unreachable before round 2 — a single-round
 * fuzz would never once exercise the transition that empties a hand into the
 * graveyard mid-round. The aggregate assertions below therefore include "the
 * demotion actually happened", because a fuzz run that never reaches a rule is
 * green for the wrong reason.
 *
 * CI runs the fixed seed set, which is deterministic: the same seeds produce the
 * same matches on every machine forever, so a red build is reproducible by
 * checking out the commit and running the same command. The nightly job sets
 * `FUZZ_RANDOM=1` and a larger `FUZZ_SEEDS`, which walks off the fixed set into
 * seeds nobody has tried; when one of those fails, the harness prints the seed
 * and the shrunk action log, and pinning it into `EXTRA_SEEDS` turns it into a
 * regression test.
 */
import { describe, expect, it } from "vitest";
import type { ClientActionType } from "../src/types.js";
import {
  replayFuzzLog,
  runFuzzMatch,
  shrinkFuzzLog,
  type ApplyFn,
  type FuzzStep,
  type FuzzStats,
} from "./fuzz/harness.js";
import { applyAction } from "../src/engine.js";

/** §0: every table size the game supports. */
const PLAYER_COUNTS = [3, 4, 5, 6, 7, 8] as const;

/**
 * Seeds per player count, and rounds per match.
 *
 * The defaults are the gate: six player counts times a hundred seeds times four
 * rounds is a little under two and a half thousand full rounds, which is the
 * "thousands of rounds" §12.3 asks for and takes about ten seconds. The nightly
 * job raises both. A developer may lower them for a quick local run, which turns
 * off the aggregate assertions below — they are statements about volume, and a
 * three-match run would fail them for the wrong reason.
 */
const DEFAULT_SEED_COUNT = 100;
const DEFAULT_ROUNDS = 4;
const SEED_COUNT = Number(process.env.FUZZ_SEEDS ?? DEFAULT_SEED_COUNT);
const ROUNDS = Number(process.env.FUZZ_ROUNDS ?? DEFAULT_ROUNDS);
const FULL_RUN = SEED_COUNT >= DEFAULT_SEED_COUNT && ROUNDS >= DEFAULT_ROUNDS;

/**
 * A run id, which is empty for the fixed set and random for the nightly job.
 *
 * `Math.random` is fine *here* and nowhere in `src` (§2): the id is printed with
 * every failure and re-running with `FUZZ_SEEDS`/`EXTRA_SEEDS` reproduces the
 * match exactly, because the harness itself takes all its randomness from the
 * seed string.
 */
const RUN_ID = process.env.FUZZ_RANDOM === "1" ? `${Date.now()}-${Math.random()}` : "";

/** Seeds pinned from a previous failure. A shrunk log belongs in a unit test. */
const EXTRA_SEEDS: string[] = [];

function seedsFor(): string[] {
  const generated = Array.from({ length: SEED_COUNT }, (_, index) => `${RUN_ID}seed-${index}`);
  return [...EXTRA_SEEDS, ...generated];
}

const totals: FuzzStats = {
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

function accumulate(stats: FuzzStats): void {
  totals.steps += stats.steps;
  totals.rounds += stats.rounds;
  totals.plays += stats.plays;
  totals.passes += stats.passes;
  totals.ticks += stats.ticks;
  totals.timeouts += stats.timeouts;
  totals.miyakoOchi += stats.miyakoOchi;
  totals.joins += stats.joins;
  totals.leaves += stats.leaves;
  for (const [type, count] of Object.entries(stats.actions)) {
    const key = type as ClientActionType;
    totals.actions[key] = (totals.actions[key] ?? 0) + count;
  }
}

describe("fuzz: random legal play over whole matches (test 24, §12.3)", () => {
  it.each(PLAYER_COUNTS)(
    "holds every invariant across %i-player matches",
    (playerCount) => {
      for (const [index, seed] of seedsFor().entries()) {
        // Every third match churns the roster (§7.7). Not every match: a leave
        // shrinks the table, and the point of the player-count sweep is to fuzz
        // each size rather than to drain them all towards three.
        const result = runFuzzMatch({
          seed,
          playerCount,
          rounds: ROUNDS,
          rosterChurn: index % 3 === 0,
        });
        if (!result.ok) throw new Error(result.failure.report);
        accumulate(result.stats);
      }
    },
    120_000,
  );

  it("fuzzes thousands of full rounds by default (§12.3 test 24)", () => {
    expect(PLAYER_COUNTS.length * DEFAULT_SEED_COUNT * DEFAULT_ROUNDS).toBeGreaterThan(2_000);
  });

  it.skipIf(!FULL_RUN)("reached the states the invariants are interesting in", () => {
    // The nightly job sets this, so a green run still says what it covered.
    if (process.env.FUZZ_STATS === "1") console.log(totals);
    // Thousands of rounds (§12.3 test 24), and not thousands of the same round:
    // the counters below are the rules the aggregate would be green without.
    expect(totals.rounds).toBeGreaterThan(1_000);
    expect(totals.plays).toBeGreaterThan(10_000);
    expect(totals.passes).toBeGreaterThan(10_000);
    // §7.6: the timeout paths are fuzzed alongside the voluntary ones.
    expect(totals.timeouts).toBeGreaterThan(100);
    // §4.5: unreachable before round 2, and the reason matches are multi-round.
    expect(totals.miyakoOchi).toBeGreaterThan(0);
    // §7.7: mid-match arrivals and departures.
    expect(totals.joins).toBeGreaterThan(0);
    expect(totals.leaves).toBeGreaterThan(0);
  });

  it.skipIf(!FULL_RUN)("drove every action type through the invariant checks (§12.3)", () => {
    // The §12.3 coverage question in its strongest form: not "is there a test for
    // this action" but "did every action in §2's union reach a commit with the
    // invariants asserted against it". `TICK` covers §7.6, the two submissions
    // cover §7.2, and the host actions cover §8.2.
    const exercised = Object.entries(totals.actions)
      .filter(([, count]) => count > 0)
      .map(([type]) => type)
      .sort();
    const expected: ClientActionType[] = [
      "EXCHANGE_CARDS",
      "PASS",
      "PLAY_CARDS",
      "SET_READY",
      "SET_ROUND_LIMIT",
      "START_GAME",
      "SUBMIT_10_DISCARD",
      "SUBMIT_7_PASS",
      "TICK",
      "UPDATE_RULES",
    ];
    expect(exercised).toEqual([...expected].sort());
  });
});

/* -------------------------------------------------------------------------- */
/* The gate is not vacuous                                                    */
/* -------------------------------------------------------------------------- */

/** 10-discard loses one of the cards it sinks: conservation drops to 53 (§12.3). */
const losesADiscardedCard: ApplyFn = (state, action, playerId) => {
  const result = applyAction(state, action, playerId);
  if (!result.ok || action.type !== "SUBMIT_10_DISCARD") return result;
  return { ok: true, value: { ...result.value, graveyard: result.value.graveyard.slice(0, -1) } };
};

/**
 * Miyako-ochi banks the demoted hand but leaves a copy in `hands` (§4.5).
 *
 * Deliberately the *subtle* version of the bug: the cards move rather than
 * duplicate, so all 54 are still accounted for and invariant 21 stays green. What
 * catches it is `stateErrors` — a player out of the round is holding cards.
 */
const keepsTheDemotedHand: ApplyFn = (state, action, playerId) => {
  const result = applyAction(state, action, playerId);
  if (!result.ok) return result;
  const demotion = result.value.history
    .slice(state.history.length)
    .find((entry) => entry.key === "history.miyakoOchi");
  if (demotion === undefined) return result;

  const count = Number(demotion.params.count);
  if (count === 0) return result;
  const graveyard = result.value.graveyard;
  return {
    ok: true,
    value: {
      ...result.value,
      graveyard: graveyard.slice(0, graveyard.length - count),
      hands: {
        ...result.value.hands,
        [String(demotion.params.target)]: graveyard.slice(graveyard.length - count),
      },
    },
  };
};

/** Run the seed set against a broken reducer and return the first failure. */
function firstFailure(apply: ApplyFn): string | null {
  for (const playerCount of PLAYER_COUNTS) {
    for (let index = 0; index < 8; index++) {
      const result = runFuzzMatch({ seed: `seed-${index}`, playerCount, rounds: ROUNDS, apply });
      if (!result.ok) return result.failure.report;
    }
  }
  return null;
}

describe("a deliberately introduced bug is caught (§12.3 acceptance)", () => {
  it("catches a card dropped in 10-discard", () => {
    const report = firstFailure(losesADiscardedCard);
    expect(report).toContain("invariant 21");
    // A failure nobody can reproduce is worthless: the report carries the seed
    // and the shrunk log, and it is short enough to read.
    expect(report).toContain("SUBMIT_10_DISCARD");
    expect(report).toContain("replay with:");
  }, 120_000);

  it("catches the demoted player's hand being left in `hands`", () => {
    const report = firstFailure(keepsTheDemotedHand);
    expect(report).toContain("is out of the round but still holds");
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Shrinking a refusal                                                        */
/* -------------------------------------------------------------------------- */

describe("a refused step shrinks to the step that was refused (§12.3)", () => {
  /**
   * A reducer that refuses `START_GAME` whatever the state.
   *
   * The refusal — a generated action the reducer rejects — is the regression the
   * harness is meant to minimize, and it is the one failure whose wording moves
   * as the log shrinks: deleting an earlier step renumbers "step 7 was refused"
   * into "step 6 was refused". Matching on that wording would reject every valid
   * deletion and report the whole log, so the shrink matches on the error code.
   */
  const refusesStartGame: ApplyFn = (state, action, playerId) =>
    action.type === "START_GAME"
      ? { ok: false, error: "NOT_HOST" }
      : applyAction(state, action, playerId);

  /** Host round-limit writes in the lobby: legal, unrelated, and removable. */
  const padding = (count: number): FuzzStep[] =>
    Array.from({ length: count }, (_, index) => ({
      kind: "ACTION" as const,
      playerId: "p0",
      action: { type: "SET_ROUND_LIMIT" as const, limit: index + 2 },
      now: 1_700_000_000_000 + index * 1_000,
    }));

  const options = { playerCount: 3, apply: refusesStartGame };
  const steps: FuzzStep[] = [
    ...padding(7),
    {
      kind: "ACTION",
      playerId: "p0",
      action: { type: "START_GAME", seed: "shrink" },
      now: 1_700_000_010_000,
    },
  ];

  it("drops every step the refusal does not depend on", () => {
    const failure = replayFuzzLog(steps, options);
    expect(failure?.index).toBe(7);
    expect(failure?.reason).toBe("step 7 was refused with NOT_HOST");

    const minimal = shrinkFuzzLog(steps, options, failure!.signature);
    expect(minimal).toHaveLength(1);
    expect(minimal[0]).toEqual(steps[7]);
  });

  it("reports the shrunk log's own numbering", () => {
    const failure = replayFuzzLog(steps, options);
    const minimal = shrinkFuzzLog(steps, options, failure!.signature);
    // The index in the text has to point into the log printed beside it.
    expect(replayFuzzLog(minimal, options)?.reason).toBe("step 0 was refused with NOT_HOST");
  });

  it("keeps a log whose failure it cannot reproduce", () => {
    // A signature that never occurs: shrinking a different failure would be
    // worse than shrinking nothing, so nothing is what it does.
    expect(shrinkFuzzLog(steps, options, "refused with WRONG_STATUS")).toEqual(steps);
  });
});
