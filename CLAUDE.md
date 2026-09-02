# Daifugo

Private multiplayer Daifugo (Japanese card game) for the author and friends. 3–8
players, landscape-only web client, authoritative server on GCP Cloud Run.

**`docs/SPEC.md` is the source of truth.** Every GitHub issue cites it by section
(`§5.5`, `§7.2`). Read the cited sections before implementing — do not infer rules
from the issue title alone. If the spec and this file disagree, the spec wins; if
the spec is silent, ask rather than inventing a rule.

## Non-negotiable invariants

These are load-bearing. Violating one breaks something far from where you changed it.

- **`applyAction` is pure.** Randomness enters only through `START_GAME.seed`; time
  enters only through `TICK`. No `Date.now()`, no `Math.random()` anywhere in
  `packages/core`.
- **Card conservation**: `sum(hands) + trick + graveyard === 54` after every action.
- **`turnOrder` is never mutated mid-round.** Length always equals player count.
  Finished and departed players stay in it; eligibility is derived, not removed.
- **`stateVersion` strictly increases**, and is the compare-and-set key for the
  Firestore transaction. Never write state without bumping it.
- **A `TICK` arriving before `deadline` is a no-op.** This is what makes re-arming a
  room's deadline on boot safe when a live timer is already armed for it (§14).
- **No bare strings enter `GameState`.** History and banners are i18n keys with
  params (§11). Retrofitting the history log later is painful. `HistoryEntry.key` is
  typed as `HistoryKey`, and entries are built only via the `history()` builder in
  `i18n-keys.ts`. Every key carrying `privateCardParams` has a `<key>Redacted`
  counterpart the sanitizer derives by appending `Redacted` (§11).
- **House rules read the *resolved* rank after joker binding**, never
  `card.isJoker`. A joker bound to an 8 fires 8-giri (§6). The single exception is
  the *beater* side of Spade-3-beats-joker, which matches the card id `S-3`: a
  joker bound to the 3 of Spades does not qualify (§5.4).

## Build order

`core` is a gate. Do not start client work (issues #15+) until §12.1–12.3 pass.

Within core: types and strength → combo and evaluator → rules → engine → test
matrix. Each issue depends on the one before it; they are not parallelizable.

## Commands

```bash
npm run test -w @daifugo/core   # must be green before any client work
npm run dev                     # server :4000, vite :5173
```

## Scope

**This is a private game for the author and under a dozen friends.** That is a
design constraint, not a disclaimer. Correctness in the game rules matters — the
engine invariants above are absolute. Operational hardening mostly does not: the
author controls when deploys happen, will not deploy mid-match, and accepts a
crash as a fine outcome. State already survives one (boot re-arm + the
`stateVersion` CAS + the no-op early `TICK`, §14), and that is the whole of the
resilience story this project wants.

**Weigh Codex review findings against that scope.** Codex reviews this repo on
`@codex review`, and its findings are usually technically correct — but it rates
severity for production services, and its instinct is to harden. A "P1" whose
failure needs a deploy during a live match, or a hundred concurrent players, or a
hostile client, is not a P1 here. Do not launder its severity rating into the
repo unexamined.

Before acting on one, ask what has to be true for the failure to happen, and
whether that is reachable for a dozen friends playing a card game. If it is not:
say so plainly and move on. If it turns out a claim in `docs/SPEC.md` is
*factually wrong*, fix the claim in a sentence or two — a wrong invariant is worth
correcting even when its consequences are unreachable — but do not write the
mitigation, the analysis, or the follow-up issue. Real setup steps that cost an
afternoon to rediscover (a missing API, a service-account flag) are worth
documenting; hypotheticals are not.

This has already gone wrong once: a Codex P1 about Cloud Run rollouts overlapping
two revisions produced 75 lines of spec and a follow-up issue for a scenario that
required deploying mid-game. Both were reverted in #42. When in doubt, err toward
less.

## Working style

- Write the tests from §12 first and confirm they fail before implementing. The
  spec pre-enumerates the test matrix; §12.1 maps 1:1 onto the rule files.
- Assert the invariants above after every action in every engine test, not just in
  the dedicated invariant tests.
- **Only N-of-a-kind exists.** No sequences, runs, or straights (§5.3). Cards of
  differing ranks never form a legal play, `PlayCombo` carries no combo type, and the
  count is `cards.length`. Every combo resolves to a single rank, so at most one
  rank-triggered house rule fires per play and the trigger count is the combo count.
- After a 7-pass or 10-discard resolves, the pipeline resumes at **Phase C**, not
  Phase B — the transfer can empty a hand (§7.3), and Phases D-F have not run yet.
  Phase B never fires twice, because a combo has one resolved rank (§7.2).
- **Every distinct illegality reason gets its own `ErrorCode`.** The client renders the
  reason inline on the disabled Play button (§10.6), so there is no `ILLEGAL_PLAY`
  bucket. The full enumeration is §8.0; a test fails if a catch-all reappears.
- **Core owns `rule.*` / `role.*` / `history.*` / `error.*`; the client owns `ui.*`.**
  Core exports `CoreI18nKey`; the client composes `CoreI18nKey | UiI18nKey` to
  typecheck its bundles (§11). Never move `ui.*` into core.
