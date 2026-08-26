# Daifugo

Private multiplayer Daifugo (Japanese card game) for the author and friends. 3–8
players, landscape-only web client, authoritative server on GCP Cloud Run.

**`docs/SPEC.md` is the source of truth.** Every GitHub issue cites it by section
(`§5.6`, `§7.2`). Read the cited sections before implementing — do not infer rules
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
  sweep from a second instance safe (§15).
- **No bare strings enter `GameState`.** History and banners are i18n keys with
  params (§11). Retrofitting the history log later is painful.
- **House rules read the *resolved* rank after joker binding**, never
  `card.isJoker`. A joker bound to an 8 fires 8-giri (§5.5).

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
- The trickiest code in the project is the Phase B re-entry in §7.2. `7-8-9` must
  fire 7-pass, halt, and still fire 8-giri on resume. Plan before writing it.
