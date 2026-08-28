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
- **A `TICK` arriving before `deadline` is a no-op.** This is what makes a duplicate
  sweep from a second instance safe (§14).
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
