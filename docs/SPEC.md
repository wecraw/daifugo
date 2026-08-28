# DAIFUGO SPECIFICATION

---

## 0. Scope and v1 Decisions

| Decision | Value |
| :--- | :--- |
| Audience | Private game for the author and friends. Not a public product. |
| Bots / AI | Out of scope. |
| Player count | 3 to 8. |
| Orientation | Landscape only. Portrait shows a rotate prompt. |
| House rules | All nine ON by default. Toggles hidden behind a host-only advanced panel. |
| Match structure | Endless by default. Host may set a round limit or first-to-N. |
| Accessibility | Out of scope for v1. |
| Languages | English and Japanese, toggled from the main menu, persisted to localStorage. |
| Turn direction | Always to the left, defined as `nextSeat = (seat + 1) % N`. |

---

## 1. Workspace Layout

TypeScript monorepo, npm workspaces. All game logic isolated in a pure package
shared by an authoritative server and the client.

```text
daifugo-monorepo/
├── package.json
├── tsconfig.base.json
└── packages/
    ├── core/
    │   ├── src/
    │   │   ├── types.ts          # State models, cards, combos, actions
    │   │   ├── config.ts         # House rule config and defaults
    │   │   ├── deck.ts           # Deck generation, seeded shuffle, dealing
    │   │   ├── strength.ts       # Rank to strength index, effective order
    │   │   ├── combo.ts          # Combo parsing, joker binding resolution
    │   │   ├── evaluator.ts      # Combo comparison, legality, legal-move generation
    │   │   ├── rules/            # One file per house rule
    │   │   ├── roles.ts          # Role assignment and exchange pairing
    │   │   ├── engine.ts         # Deterministic reducer
    │   │   ├── sanitizer.ts      # Per-player state and history redaction
    │   │   ├── i18n-keys.ts      # Canonical key list for history and banners
    │   │   └── network.ts        # Typed Socket.IO contracts
    │   └── tests/
    ├── server/
    │   └── src/
    │       ├── index.ts          # HTTP and Socket.IO init
    │       ├── room.ts           # Room lifecycle, timers, dispatch
    │       ├── roomManager.ts    # Creation, joining, reconnect tokens
    │       └── timers.ts         # Turn, exchange, and grace timers
    └── client/
        └── src/
            ├── App.tsx
            ├── i18n/             # en.json, ja.json
            ├── context/SocketContext.tsx
            ├── layout/handLayout.ts   # Weighted fan geometry (Section 10.2)
            └── components/
                ├── MainMenu.tsx
                ├── Lobby.tsx
                ├── HostPanel.tsx
                ├── GameTable.tsx
                ├── PlayerSeat.tsx
                ├── TrickArea.tsx
                ├── Hand.tsx
                ├── ExchangeScreen.tsx
                ├── PendingActionModal.tsx
                ├── TurnTimer.tsx
                └── ActionBar.tsx
```

---

## 2. Core Domain Types

```ts
export type Suit = 'S' | 'H' | 'D' | 'C';

/** 1 = Ace, 2 = Two. Numeric value only. Strength order is separate. */
export type Rank = 3|4|5|6|7|8|9|10|11|12|13|1|2;

export type Role =
  | { kind: 'DAI_FUGO' }
  | { kind: 'FUGO' }
  | { kind: 'HEIMIN'; rank: number }   // 1-indexed from the top
  | { kind: 'HINMIN' }
  | { kind: 'DAI_HINMIN' };

export interface Card {
  id: string;              // "S-3", "H-11", "JKR-1", "JKR-2"
  suit: Suit | null;       // null for joker
  rank: Rank | null;       // null for joker
  isJoker: boolean;
}

/** How a joker was played. Absent binding means it was played pure. */
export interface JokerBinding {
  cardId: string;          // "JKR-1" | "JKR-2"
  rank: Rank;
  suit: Suit;
}

/** The result of parsing a play and resolving its joker bindings. Every field
 *  beyond `cards` and `bindings` is the resolved view; card count is `cards.length`. */
export interface PlayCombo {
  cards: Card[];
  bindings: JokerBinding[];     // empty when no jokers, or jokers played pure
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

export type PendingAction =
  | { type: 'RESOLVE_7_PASS'; count: number; sourcePlayerId: string; targetPlayerId: string }
  | { type: 'RESOLVE_10_DISCARD'; count: number; playerId: string };

export interface Player {
  id: string;              // stable across reconnect
  name: string;
  role: Role | null;       // from the PREVIOUS round; drives exchange
  seatIndex: number;
  isReady: boolean;
  isConnected: boolean;
}

export interface HistoryEntry {
  key: string;                          // i18n key, see Section 11
  params: Record<string, string | number>;
  /** Card ids in params that must be redacted for players outside `visibleTo`. */
  privateCardParams?: string[];
  visibleTo?: string[];                 // player ids; undefined means everyone
}

export interface GameState {
  roomId: string;
  hostId: string;
  config: HouseRulesConfig;
  status: 'LOBBY' | 'EXCHANGE' | 'IN_PROGRESS' | 'ROUND_END' | 'MATCH_END';
  roundNumber: number;                  // 1-indexed
  roundLimit: number | null;            // null = endless
  stateVersion: number;                 // increments on every applied action

  players: Player[];                    // ordered by seatIndex
  hands: Record<string, Card[]>;
  graveyard: Card[];                    // 10-discard sink, and miyako-ochi hands (§4.5)

  dealerId: string;                     // previous round's last place
  turnOrder: string[];                  // ALL player ids in seat order. Never mutated mid-round.
  activePlayerIndex: number;            // index into turnOrder

  currentTrick: { combo: PlayCombo; playedBy: string }[];
  trickLeaderId: string | null;         // last player who actually played
  passedPlayerIds: string[];
  finishedPlayerIds: string[];          // in order of going out (agari)
  /** Players removed from the round without an agari, pinned to the bottom of the
   *  finish order: miyako-ochi (§4.5) and mid-round leavers (§7.7). Ordered
   *  best-placed first, so the last entry is dead last. Never mutated except by
   *  those two paths. */
  droppedPlayerIds: string[];

  isRevolution: boolean;                // persists for the round
  trickInverted: boolean;               // 11-back; resets on trick clear
  suitLock: Suit[] | null;              // exact suit multiset lock; resets on trick clear

  pendingAction: PendingAction | null;
  exchange: {
    required: Record<string, number>;   // playerId -> cards owed
    partner: Record<string, string>;    // playerId -> recipient
    forced: Record<string, string[]>;   // playerId -> pre-computed card ids (poor side)
    submitted: Record<string, string[]>;
  } | null;

  /** Epoch ms. Server authoritative. Clients render a countdown against it. */
  deadline: number | null;

  pendingJoins: Player[];               // applied at next round boundary
  pendingLeaves: string[];

  history: HistoryEntry[];
}

export interface PublicGameState extends Omit<GameState, 'hands' | 'history'> {
  hands: Record<string, { cardCount: number }>;
  myHand: Card[];
  myPlayerId: string;
  history: HistoryEntry[];              // already redacted for this viewer
}

export type ClientAction =
  | { type: 'START_GAME'; seed: string }
  | { type: 'PLAY_CARDS'; cardIds: string[]; bindings?: JokerBinding[] }
  | { type: 'PASS' }
  | { type: 'SUBMIT_7_PASS'; cardIds: string[] }
  | { type: 'SUBMIT_10_DISCARD'; cardIds: string[] }
  | { type: 'EXCHANGE_CARDS'; cardIds: string[] }
  | { type: 'UPDATE_RULES'; config: Partial<HouseRulesConfig> }
  | { type: 'SET_ROUND_LIMIT'; limit: number | null }
  | { type: 'TICK'; now: number };      // server-injected, drives timeouts
```

`applyAction` must remain pure. All randomness enters through `START_GAME.seed`,
which the server generates with a CSPRNG and feeds to a seeded PRNG in `deck.ts`.
All time enters through `TICK`.

---

## 3. Deck, Seating, Dealing

### 3.1 Deck
54 cards: 52 standard plus `JKR-1` and `JKR-2`.

### 3.2 Seating rotation
Round 1 seating is join order, dealer chosen at random.

After each round, reseat before the next deal:
1. The last-place finisher becomes dealer and takes `seatIndex 0`. After a
   miyako-ochi (§4.5) that is the demoted player, not the last player still holding
   cards.
2. The winner takes the seat to the dealer's **right**, which is `seatIndex N-1`
   (since left is `+1`).
3. Runner-up sits to the winner's right at `N-2`, and so on.

Net effect: reading in turn order from the dealer you get
`last, (N-1)th, (N-2)th, ..., 2nd, 1st`.

### 3.3 Dealing
Deal one card at a time **starting with the dealer** and moving left, until the deck
is exhausted. The dealer is therefore dealt first and the previous winner last, so
the winner receives the fewest cards when 54 does not divide evenly.

Uneven hands are intended. Do not compensate.

### 3.4 Round start
The holder of the **3 of Diamonds** leads the first trick of every round, after the
exchange phase completes. `trickLeaderId` is set to that player and
`activePlayerIndex` points at them.

---

## 4. Roles and the Exchange Phase

### 4.1 Role assignment
Derived from the round's **final finish order**, which is

```text
finishedPlayerIds            (agari order, 1st first)
  ++ the single remaining player, if any
  ++ droppedPlayerIds        (bottom block, best-placed first)
```

With no drops that reduces to `finishedPlayerIds` plus the final remaining player,
who is always last place. `droppedPlayerIds` carries miyako-ochi demotions (§4.5)
and mid-round leavers (§7.7); those players never occupy anything but the bottom
positions, whatever their hand held.

| Finish position | Role |
| :--- | :--- |
| 1st | `DAI_FUGO` |
| 2nd (only if N >= 4) | `FUGO` |
| Middle positions | `HEIMIN` with `rank` counting from the top, 1-indexed |
| Second to last (only if N >= 4) | `HINMIN` |
| Last | `DAI_HINMIN` |

At N = 3: `DAI_FUGO`, `HEIMIN rank 1`, `DAI_HINMIN`.

### 4.2 Exchange pairing
Pair the i-th ranked from the top with the i-th from the bottom, for
`i = 1 .. floor(N/2)`. That pair exchanges

```
count(i) = floor(N / 2) - i + 1
```

cards in each direction. When N is odd the exact middle player exchanges nothing.

Worked results:

| N | Pairs (top rank ↔ bottom rank): count |
| :--- | :--- |
| 3 | 1↔3: 1. Middle sits out. |
| 4 | 1↔4: 2, 2↔3: 1 |
| 5 | 1↔5: 2, 2↔4: 1. Middle sits out. |
| 6 | 1↔6: 3, 2↔5: 2, 3↔4: 1 |
| 7 | 1↔7: 3, 2↔6: 2, 3↔5: 1. Middle sits out. |
| 8 | 1↔8: 4, 2↔7: 3, 3↔6: 2, 4↔5: 1 |

### 4.3 Direction rules
* The **richer** player of each pair chooses freely which cards to give.
* The **poorer** player gives their strongest cards, computed automatically, with
  **the 3 of Spades excluded from forced selection**. Strength uses the standard
  (non-revolution) order, since revolution state does not carry across rounds.
  Populate `exchange.forced` at phase start so the poor side has nothing to submit
  and sees a read-only display of what leaves their hand.
* Exchange is **simultaneous**. All transfers apply atomically when the last rich
  player submits or the deadline expires.
* Round 1 has no exchange. Skip straight to `IN_PROGRESS`.

### 4.4 Exchange timer
60 seconds, `deadline` set on entry to `EXCHANGE`, countdown visible to all.
On expiry, any unsubmitted rich player auto-gives their **weakest** eligible cards.

### 4.5 Miyako-ochi (都落ち)
**If the previous round's `DAI_HINMIN` wins the round, the previous round's
`DAI_FUGO` immediately drops out in last place, regardless of their hand.** The
pauper who climbed all the way to the top throws the old ruler out of the capital.

Always on. This is not a `HouseRulesConfig` entry and has no lobby toggle: it reads
carried roles, not a resolved rank, so none of §6's rank-trigger machinery applies
to it and it cannot collide with a house rule.

**Trigger.** In Phase C (§7.1), at the moment `finishedPlayerIds` goes from empty to
one entry — a first-place agari, however it was reached, including agari via 7-pass
or 10-discard (§7.3) — check the *carried* roles on `Player.role`, which are the
previous round's:

* the finisher's carried role is `DAI_HINMIN`, and
* some other player in `turnOrder` carries `DAI_FUGO`, has not finished, and is not
  already in `droppedPlayerIds`.

Both hold or nothing happens. It therefore never fires in round 1 (`Player.role` is
`null` for everyone), never fires on a 2nd-or-later agari, and no-ops when the
previous `DAI_FUGO` has left the room (§7.7) — a departed player is already at the
bottom. The demoted player is never the active player: the trigger runs inside the
winner's own action.

**Effect**, applied in this order, before Phase C's remaining-player count is taken:

```text
1. Move the demoted player's entire hand to `graveyard`. Their hand becomes [].
   (Card conservation is a sum over hands + trick + graveyard, so it holds.)
2. Append the demoted player id to `droppedPlayerIds`, and keep it last: a later
   drop — a mid-round leave (§7.7) — inserts *before* the miyako-ochi player, who
   stays dead last. The rule is absolute; nothing outranks it downward.
3. They are no longer eligible (§7.5): they cannot be advanced to, skipped over,
   counted for 5-skip, or targeted by a 7-pass, exactly as if finished. They stay
   in `turnOrder` — its length never changes mid-round (§2).
4. If `trickLeaderId` is the demoted player, leave it set; `clearTrick` already
   advances past an ineligible leader (§7.4).
5. Emit `history.miyakoOchi { player, target, count }`, where `count` is the number
   of cards that went to the graveyard. Public: no card ids leave the hand, so the
   entry needs no `*Redacted` counterpart.
```

Phase C then continues: the drop can leave one non-finished, non-dropped player, in
which case the round ends immediately and that player takes the position directly
above the bottom block.

**Downstream.** The demoted player is last place, so they score `0` (§9), become the
next dealer at `seatIndex 0` (§3.2), and take `DAI_HINMIN` for the next exchange
(§4.1) — the two players swap the top and bottom roles outright. The new `DAI_FUGO`
is the player who was `DAI_HINMIN`, so miyako-ochi can fire again the following
round on the reverse pairing.

---

## 5. Card Strength, Combos, and Jokers

### 5.1 Strength index
A single monotonic index used everywhere.

```
3→0  4→1  5→2  6→3  7→4  8→5  9→6  10→7  J(11)→8  Q(12)→9  K(13)→10  A(1)→11  2→12
pure joker → 13
```

### 5.2 Effective inversion

```
effectiveInverted = state.isRevolution XOR state.trickInverted
```

When inverted, comparison reverses: index 0 is strongest, 13 weakest. The pure
joker is therefore the *weakest* card during revolution.

A pure joker beats nothing while inverted, so a joker that has to beat something
must be bound. Bound to a 3 it beats a 4; it can never beat a 3, because equal
strength does not beat (Section 7.1). The 3 of Spades exception below is
consequently inert during revolution: a 3 already outranks every other card there,
and a pure joker sits at the bottom, so nothing needs the exception to get over
it.

### 5.3 N-of-a-kind
**N-of-a-kind is the only combo shape in this game.** A play is 1 through 4+ cards
sharing a single resolved rank. There are no sequences, runs, or straights: cards of
differing ranks never form a legal play. Comparison is by the strength index of the
shared rank, and count must match the top play exactly.

Two pure jokers form a legal pair of jokers. Nothing beats it in normal orientation.
A pure joker cannot combine with a non-joker to form a pair, because its rank is
"joker", not a number. To pair with an 8 the joker must be bound to an 8.

Because every combo has exactly one resolved rank, **at most one rank-triggered house
rule fires per play** (Section 6).

### 5.4 Joker binding
Each joker is either **pure** (strength 13, suit null) or **wildcard** (bound to a
specific rank and suit via `JokerBinding`).

Consequences, all intentional:
* A wildcard joker triggers rank-based house rules. Joker bound to an 8 in a pair of
  8s does fire 8-giri. Joker bound to a 5 adds to the skip count. Joker bound to a
  Jack counts toward 11-back parity.
* A wildcard joker counts toward revolution. `JKR-as-K + K + K + K` is four kings.
* The 3 of Spades counter applies **only** to a pure joker played as a single.
  A joker bound to a 4 is a 4 and beats the 3 of Spades normally; a joker bound to
  a 10 is a 10, and the 3 of Spades does not beat it. On the *victim* side the
  check reads the binding, never `card.isJoker`.
* On the *beater* side the counter is the sole place in the game where card
  identity matters rather than resolved rank: it must be the true `S-3`. A joker
  bound to the 3 of Spades does **not** beat a pure joker — it is a 3, and a 3
  loses to a joker in the standard orientation like any other card. The counter is
  a specific card's privilege, not a rank's.
* Both jokers may appear in one combo, but they must resolve to the **same rank**
  as the rest of the combo. `JKR-as-8S + JKR-as-8D + 8H` is a legal triple of 8s.
* A pure joker satisfies any active suit lock and does not break it.

### 5.5 Binding resolution
The client sends explicit `bindings`. The server validates them and never trusts
them blindly. When `bindings` is absent, the server applies the default rule.

**Default: the strongest legal binding.**

1. Determine combo type and count from the non-joker cards, constrained by the
   trick top when the trick is non-empty.
2. Enumerate all bindings that produce a legal play.
3. Select the one with the greatest effective strength. Pure counts as a binding
   candidate and wins ties.

**The default is a recommendation, not a commitment.** The client pre-selects the
resolved binding in the binding picker and the player may override it before
playing (Section 10). Resolution therefore maximises *raw strength only* and
ignores Section 6 entirely: it will not reach for a 7 to fish for a 7-pass, nor
avoid an 8 to dodge 8-giri. A player who wants the joker to be a 7 so it sheds
cards says so explicitly; guessing at intent would only make the suggestion harder
to predict.

Leading a lone joker therefore resolves to pure in the standard orientation, where
pure is the strongest card there is. Under revolution pure is the *weakest* card
(Section 5.2), so the same rule binds it to a 3, the strongest card while inverted.
Both are correct: the default is always "the strongest thing this can be right
now.

---

## 6. House Rules

All rules read the **resolved** rank after binding, never `card.isJoker`. A joker
bound to an 8 fires 8-giri. Since a combo resolves to exactly one rank (Section 5.3),
a play triggers at most one of these rules, and the trigger count is simply the
combo's card count: a pair of 5s skips 2, a triple of 7s passes up to 3.

| Rule | Trigger | Mechanics |
| :--- | :--- | :--- |
| **Spade 3 Beats Joker** | Trick top is a **single pure joker**. | A single 3 of Spades is legal over it in any inversion state and is treated as the strongest card over that joker. The beater must be the true `S-3`: a joker bound to the 3 of Spades does not qualify (Section 5.4). Does not apply to a pair of jokers, or to a joker played bound: a joker played as a 10 is a 10 and the 3 of Spades does not beat it. Inert under revolution, where a 3 already outranks a pure joker without the exception (Section 5.2). |
| **5-Skip** | Resolved rank is 5. | `S` = combo count. Skip the next `S` **eligible** players (non-finished and not yet passed). If `S >= (eligible players other than self)`, clear the trick instead and keep the lead. |
| **7-Pass** | Resolved rank is 7. | `C` = combo count, `k = min(C, cards remaining in hand)`. Sets `RESOLVE_7_PASS`. Target is the nearest **non-finished** player to the left, regardless of whether they have passed or would be skipped. |
| **8-Giri** | Resolved rank is 8. | Trick clears immediately, lead stays with the player. |
| **9-Giri** | Resolved rank is 9 and count is **two or more**. | Same as 8-Giri. A single 9 does nothing. |
| **10-Discard** | Resolved rank is 10. | `D` = combo count, `k = min(D, cards remaining)`. Sets `RESOLVE_10_DISCARD`. Selected cards go to `graveyard`. |
| **11-Back** | Resolved rank is 11. | `J` = combo count. Odd toggles `trickInverted`. Even is a no-op. Resets on trick clear. |
| **Revolution** | **Four or more cards of the same rank** played simultaneously. | Toggles `isRevolution` for the rest of the round. |
| **Shibari** | Consecutive plays in a trick share an identical suit multiset. | Sets `suitLock` to that exact multiset. Subsequent plays must match it exactly. Overlap is not a partial lock. Mixed sets lock too: hearts+spades followed by hearts+spades locks to {H,S}. Pure jokers satisfy any lock and maintain an existing one. |

---

## 7. Engine Pipeline

```ts
export function applyAction(
  state: GameState,
  action: ClientAction,
  playerId: string
): Result<GameState, ErrorCode>;
```

### 7.1 PLAY_CARDS

```text
PHASE 0 - VALIDATE
  ├── status is IN_PROGRESS, pendingAction is null, playerId is active player
  ├── All cardIds are in the player's hand
  ├── Parse into PlayCombo; resolve or validate joker bindings
  ├── Combo is N-of-a-kind: every card resolves to one rank (no sequences)
  ├── If trick non-empty: count matches the top exactly
  ├── Strength check under effectiveInverted, plus the Spade-3-over-pure-joker exception
  └── Shibari: if suitLock is set, combo suit multiset must match exactly
      (pure jokers wildcard through)

PHASE A - IMMEDIATE STATE EFFECTS (applied in this order)
  ├── Move cards from hand to currentTrick, set trickLeaderId = playerId
  ├── Revolution: if count >= 4 -> toggle isRevolution
  ├── 11-Back: if resolved rank is 11 and count is odd -> toggle trickInverted
  └── Shibari: if suit multiset equals the previous play's -> set suitLock

  Note: Phase 0 validates against the PRE-play inversion state. Revolution and
  11-back apply only to subsequent plays.

PHASE B - INTERACTIVE RULE (halts the pipeline)
  ├── Resolved rank is 7 and k > 0 -> pendingAction = RESOLVE_7_PASS, return
  └── Resolved rank is 10 and k > 0 -> pendingAction = RESOLVE_10_DISCARD, return

PHASE C - AGARI
  ├── If hand empty -> append playerId to finishedPlayerIds
  ├── Miyako-ochi (§4.5): if that was the FIRST agari of the round, playerId carries
  │   DAI_HINMIN, and the carrier of DAI_FUGO is still in the round -> move their
  │   hand to graveyard, append them to droppedPlayerIds (kept last), drop them from
  │   eligibility
  └── If non-finished, non-dropped players <= 1 -> assign the remaining player the
      position directly above droppedPlayerIds, ROUND_END

PHASE D - TRICK ENDERS
  ├── Resolved rank is 8 -> clearTrick(leader = playerId)
  └── Resolved rank is 9 and count >= 2 -> clearTrick(leader = playerId)

PHASE E - 5-SKIP
  └── Resolved rank is 5. S = count. If S >= (eligible players other than self)
      -> clearTrick(leader = playerId). Otherwise advance by (1 + S) eligible seats.

PHASE F - ADVANCE
  └── Advance activePlayerIndex to the next eligible player. Set deadline = now + 60s.
```

### 7.2 Resuming after a pendingAction
`SUBMIT_7_PASS` and `SUBMIT_10_DISCARD` apply the transfer or discard, then resume the
pipeline at **Phase C** and run through D, E, F. They do not simply clear the flag and
advance: the transfer can empty the hand (§7.3), and Phases D and E have not run yet.

Phase B never fires twice — a combo has one resolved rank — so there is nothing to
re-check.

### 7.3 Agari via pass or discard
Both can empty a hand. Playing a single 7 with two cards in hand leaves one card,
`k = min(1,1) = 1`, and passing it empties the hand. The same applies to 10-discard.
Phase C runs after every pendingAction resolution as well as after the initial play.
Emptying your hand this way is a normal agari, miyako-ochi (§4.5) included: a 7-pass
that empties the previous `DAI_HINMIN`'s hand wins the round and demotes the previous
`DAI_FUGO`, even when the `DAI_FUGO` was the target that just received the cards —
those cards go straight to the graveyard with the rest of their hand.

### 7.4 clearTrick(leader)

```text
currentTrick = []
passedPlayerIds = []
trickInverted = false
suitLock = null
isRevolution UNCHANGED
trickLeaderId = leader
If leader has finished or dropped (§4.5, §7.7) -> advance to the nearest eligible player to their left
activePlayerIndex = that player
```

### 7.5 PASS

```text
VALIDATE
  ├── playerId is active player, pendingAction is null
  └── currentTrick is non-empty (you may not pass while leading)

APPLY
  ├── Append playerId to passedPlayerIds (locked out for the remainder of the trick)
  ├── If every eligible player except one has passed -> clearTrick(trickLeaderId)
  └── Otherwise advance to the next eligible player
```

"Eligible" means not finished, not in `droppedPlayerIds` (§4.5, §7.7), and not in
`passedPlayerIds`.

### 7.6 Timeouts (driven by `TICK`)

| Situation | Auto-action |
| :--- | :--- |
| Leader, trick empty | Play the weakest legal single. |
| Follower, trick non-empty | Pass. |
| Owes `RESOLVE_7_PASS` | Submit the weakest `k` cards. |
| Owes `RESOLVE_10_DISCARD` | Discard the weakest `k` cards. |
| Rich player owes exchange | Give the weakest `k` cards. |

The turn timer runs regardless of connection state. It is 60 seconds for turns and
60 seconds for the exchange phase.

### 7.7 Roster changes
Joins and leaves queue in `pendingJoins` / `pendingLeaves` and apply only at a round
boundary. A player who leaves mid-round is treated as finishing **last** for that
round: they are removed from eligibility, the round continues, and they occupy the
bottom of the finish order via `droppedPlayerIds` (§2), their hand going to the
graveyard. They are appended to that list, except that a miyako-ochi demotion (§4.5)
always stays its last entry, so a leaver after a demotion sits directly above the
demoted player. Reseating and exchange for the next round use the
post-change roster.

---

## 8. Networking

```ts
export interface ServerToClientEvents {
  roomState: (state: PublicGameState) => void;
  gameError: (error: { code: ErrorCode; params?: Record<string, unknown> }) => void;
  roundFinished: (results: { playerId: string; role: Role }[]) => void;
  matchFinished: (standings: { playerId: string; points: number }[]) => void;
}

export interface ClientToServerEvents {
  joinRoom: (roomId: string, playerName: string, resumeToken?: string) => void;
  updateRules: (config: Partial<HouseRulesConfig>) => void;
  setRoundLimit: (limit: number | null) => void;
  startGame: () => void;
  playCards: (cardIds: string[], bindings?: JokerBinding[]) => void;
  pass: () => void;
  submit7Pass: (cardIds: string[]) => void;
  submit10Discard: (cardIds: string[]) => void;
  exchangeCards: (cardIds: string[]) => void;
}
```

### 8.0 ErrorCode

The `E` of `Result<GameState, ErrorCode>` (Section 7) and the `code` of `gameError`.
Enumerated in `core/src/i18n-keys.ts` and translated under `error.*`.

This is not only a transport vocabulary. Section 10.6 renders the specific reason
inline on the disabled Play button, so **every distinct reason a play can be illegal
carries its own code**. Do not collapse them into an `ILLEGAL_PLAY` bucket: widening
this union later means changing core at the bottom of the dependency chain.

N-of-a-kind is the only combo shape (Section 5.3), so shape rejection is just
`MIXED_RANKS`, and count is the only thing that can mismatch the trick top.

| Group | Codes |
| :--- | :--- |
| Permissions and phase | `NOT_HOST`, `NOT_YOUR_TURN`, `WRONG_STATUS`, `GAME_ALREADY_STARTED`, `NOT_ENOUGH_PLAYERS`, `TOO_MANY_PLAYERS`, `PLAYER_NOT_FOUND`, `INVALID_ROUND_LIMIT` |
| Pending actions (7.2) | `PENDING_ACTION_BLOCKS`, `NO_PENDING_ACTION`, `WRONG_PENDING_ACTION` |
| Card selection | `EMPTY_SELECTION`, `DUPLICATE_CARD_IDS`, `CARD_NOT_IN_HAND`, `WRONG_CARD_COUNT` |
| Combo shape (5.3) | `MIXED_RANKS`, `JOKER_MUST_BE_BOUND` |
| Joker binding (5.4, 5.5) | `INVALID_BINDING`, `DUPLICATE_BINDING`, `NO_LEGAL_BINDING` |
| Legality vs trick top (7.1) | `COMBO_COUNT_MISMATCH`, `TOO_WEAK`, `SUIT_LOCK_MISMATCH` |
| Pass (7.5) | `CANNOT_PASS_AS_LEADER`, `ALREADY_PASSED` |
| Exchange (4) | `NOT_IN_EXCHANGE`, `NOT_EXCHANGE_PARTICIPANT`, `EXCHANGE_FORCED`, `EXCHANGE_ALREADY_SUBMITTED` |
| Room lifecycle (8) | `ROOM_NOT_FOUND`, `ROOM_FULL`, `NAME_TAKEN`, `INVALID_ACTION` |

### 8.1 Identity and reconnect
Socket id is not player id. On first join the server issues a `resumeToken` which
the client stores in localStorage and replays on reconnect to reclaim its seat.

### 8.2 Host
The first player to join a room is host, recorded as `hostId`. `updateRules`,
`setRoundLimit`, and `startGame` are host-only and rejected otherwise. Host transfers
to the longest-seated connected player if the host disconnects and does not return
within the grace period.

### 8.3 Disconnect grace
30 seconds, governing **seat removal only**. Turn timers continue to run for
disconnected players, so a dropped player auto-passes on schedule and the table
never stalls.

### 8.4 Server loop
1. Receive action, resolve player id from socket.
2. `applyAction(state, action, playerId)`.
3. On error, emit `gameError` to the sender only.
4. On success, replace state, increment `stateVersion`, and broadcast
   `getPublicState(state, playerId)` per recipient.
5. Reset or set `deadline` and arm the corresponding timer.

### 8.5 Redaction
`sanitizer.ts` removes other players' hands and rewrites history entries. Any entry
whose `privateCardParams` name a card is rewritten to a count for viewers outside
`visibleTo`. Player names are never redacted.

A 7-pass therefore renders as:
* Sender and recipient: "Will passed 3♠ to Alex"
* Everyone else: "Will passed 1 card to Alex"

---

## 9. Match Scoring

Points awarded at round end: `N - finishPosition` over the final finish order of
§4.1, so the winner of a 5-player round scores 4 and last place scores 0. A player
demoted by miyako-ochi (§4.5) is last place and scores 0. Standings accumulate
across rounds and render in the lobby between rounds.

Endless by default. If `roundLimit` is set, the match ends at that round and emits
`matchFinished`.

---

## 10. Client UX

### 10.1 Landscape layout (reference 844 x 390)

```text
┌──────────────────────────────────────────────────────────┐
│  [seat] [seat] [seat]        history log       [timer]   │  56px
│                                                          │
│ [seat]          TRICK AREA / BANNERS          [seat]     │  ~218px
│                                                          │
├──────────────────────────────────────────────────────────┤
│              HAND (single row, fanned)          [ACTION] │  116px
└──────────────────────────────────────────────────────────┘
```

Opponent seats distribute along the left, top, and right edges. The action bar is a
vertical column on the right edge rather than a bottom bar, buying vertical room.
Lock orientation to landscape.

### 10.2 Hand geometry
Card 64 x 90. Hand region width `W ≈ 780` after the action column.

```
step = min(cardWidth * 0.62, (W - cardWidth) / (n - 1))
```

At n = 18 this yields about 42px of exposed edge, comfortably above the 26px tap
threshold, so a single row always fits and two-row mode is not needed.

Fan: rotation `(i - (n-1)/2) * (16 / (n-1))` degrees, capped at +/-8. Vertical rise
follows a shallow parabola with the centre card about 10px above the ends.

Hit targets are the exposed strip only, except the rightmost card which claims full
width. Extend hit slop 6px vertically.

### 10.3 Weighted layout and dimming
Legal-move generation runs client-side against the same `@daifugo/core` evaluator the
server uses, so the two never disagree.

* Each card carries a layout weight: `1.0` playable, `0.55` unplayable. Positions are
  cumulative weighted steps normalised to fill `W`, so freed space flows to playable
  cards automatically.
* Unplayable cards render at `scale 0.72`, desaturated to 30 percent, dropped 6px,
  rotation zeroed.
* **Recompute the weighted layout only at turn start.** Within a turn, as selection
  narrows the legal set, dim without resizing. Cards must not slide under the
  player's finger mid-selection.
* Memoise the legal set on `(hand, trickTop, isRevolution, trickInverted, suitLock)`.

### 10.4 Selection
Tap to select: lift 26px, scale 1.06, raise z-index, soft click, spring easing
(stiffness ~400, damping ~30). Tap again to deselect. Support drag-across-to-select,
since selecting pairs and triples is the most common action.

No play occurs on tap. Confirm via the Play button.

### 10.5 Joker binding UI
When a selection contains a joker and more than one legal binding exists, show a
small badge on the joker with its current assignment and let the player tap it to
cycle bindings. The default is the strongest legal binding. The Play button label
always reflects the resolved combo.

### 10.6 Action bar
The Play button names the resolved combo from its count and rank: "Play Pair of 8s",
"Play Four 3s".
When a selection is illegal the button is disabled with the reason inline, for
example "Must follow Hearts" or "Not high enough". Never surface a validation error
the player could have seen coming as a toast.

Also in the bar: Pass, Sort toggle, and the turn timer ring.

### 10.7 Auto-pass
Fires only when the legal move set is empty, never merely when the player has nothing
good. Display a 1.2 second "No legal play, passing" card with the pass animation so
the turn does not feel dropped. Suppress entirely while a pendingAction is the
player's.

### 10.8 Sorting
Toggle between rank-then-suit and suit-then-rank, persisted to localStorage. Rank
sort follows the **current effective order**, so the hand visually reverses on
revolution. That reversal is deliberate feedback.

### 10.9 Animation priorities
In order of impact:
1. Trick clear sweep, cards sliding off to the graveyard or discard edge.
2. Revolution flip: full-screen banner while the hand re-sorts and inverts on screen.
3. 7-pass card travel, so you see cards physically leave for the recipient's seat.

Secondary: 8-giri and 9-giri stamp banner, suit lock icon on the trick area, 11-back
badge, skip indicator arcing over skipped seats.

### 10.10 Timers
Render a ring countdown against `state.deadline` rather than a locally started timer,
so reconnects and latency stay honest. Turn ring on the active seat, exchange ring
centred during `EXCHANGE`.

### 10.11 Host panel
Rule toggles are hidden behind a disclosure in the lobby, visible only to the host,
collapsed by default with all nine rules ON. Round limit lives here too.

---

## 11. Internationalisation

English and Japanese from day one. Every rule name, banner, error, and history line
goes through an i18n key. Retrofitting the history log later is painful, so no bare
strings enter `GameState`.

Key namespaces: `rule.*`, `role.*`, `history.*`, `error.*`, `ui.*`.

**Ownership of the namespaces is split.** `core/src/i18n-keys.ts` enumerates the
four namespaces core can emit - `rule.*`, `role.*`, `history.*`, `error.*` - and
exports them as `CoreI18nKey`. `ui.*` is client-only presentation text; nothing in
core emits it, and it must not be moved into core. The client owns `UiI18nKey` and
composes the union itself:

```ts
type I18nKey = CoreI18nKey | UiI18nKey;
```

`en.json` and `ja.json` are typechecked against that composed union, so adding a key
on either side is a compile error until both bundles carry a translation.

`rule.*` and `role.*` are derived types, not hand-written lists: `rule.${keyof
HouseRulesConfig}` and `role.${Role['kind']}`. A new house rule cannot exist without
a key.

**No bare strings.** `HistoryEntry.key` is typed as `HistoryKey`, not `string`, and
entries are built only through the `history(key, params, options)` builder in
`i18n-keys.ts`, which returns a frozen entry. This makes "no bare strings enter
`GameState`" a compile error rather than a convention.

**The `*Redacted` pairing rule.** Every history key whose entry carries
`privateCardParams` has a counterpart named `<key>Redacted` - `history.sevenPass`
pairs with `history.sevenPassRedacted`. The sanitizer (Section 8.5) derives the
public key mechanically by appending `Redacted`, and swaps the private card params
for a `count` param. The redacted variant therefore takes `{count}` where the
original takes card ids; all other params are identical. A test asserts that every
`*Redacted` key has a non-redacted counterpart, so the derivation can never go stale.

Sample mappings:

| Key | en | ja |
| :--- | :--- | :--- |
| `rule.eightGiri` | Eight Cutter | 8切り |
| `rule.shibari` | Suit Lock | 縛り |
| `rule.kakumei` | Revolution | 革命 |
| `rule.elevenBack` | Jack Reversal | 11バック |
| `role.DAI_HINMIN` | Grand Pauper | 大貧民 |
| `history.sevenPassRedacted` | {player} passed {count} card(s) to {target} | ... |
| `history.miyakoOchi` | {player} won from Grand Pauper — {target} falls to last with {count} card(s) | 都落ち |

Language toggle on the main menu, persisted to localStorage, no server involvement.

---

## 12. Test Matrix

### 12.1 Unit, single rule
1. `strength.test.ts` - standard order, inverted order, `effectiveInverted` XOR truth table.
2. `spade3.test.ts` - beats a single pure joker normally and under revolution; loses to a joker bound to a 4; does not beat a joker played as a 10; illegal against a pair of jokers; a joker bound to the 3 of Spades does **not** beat a pure joker (Section 5.4).
3. `fiveSkip.test.ts` - 1, 2, and 3 fives at 4 players; the stacking case that clears the trick and returns the lead.
4. `sevenPass.test.ts` - state transition; `k = min(C, remaining)`; k = 0 when playing the last card; target skips finished players but not passed ones.
5. `nineGiri.test.ts` - single 9 does not clear; pair and triple do.
6. `tenDiscard.test.ts` - pair of 10s discards 2 to graveyard; non-active players rejected.
7. `elevenBack.test.ts` - 1, 2, 3 Jacks parity; reset on trick clear.
8. `shibari.test.ts` - two hearts plays lock; mixed {H,S} locks; overlapping but unequal sets do not lock; non-matching play rejected; pure joker satisfies and maintains.
9. `kakumei.test.ts` - 4 of a kind toggles; a triple does not; wildcard joker counts toward the four.
10. `combo.test.ts` - mixed ranks rejected (no sequences); count must match the top exactly; pair of pure jokers legal; pure joker cannot pair with a non-joker; both jokers bound to the combo's rank.

### 12.2 Interaction tests (where the bugs will be)
11. 7-pass halts the pipeline, and on resume Phase D and E still run against the post-transfer hand.
12. A triple of 7s sets k = min(3, remaining) and the target resolves before Phase F advances.
13. Revolution and 11-back simultaneously, verifying XOR.
14. Shibari plus revolution together.
15. 5-skip wrapping past finished players.
16. 8-giri played as the final card, lead passing to the nearest non-finished left neighbour.
17. Agari by 7-pass and agari by 10-discard.
18. 7-pass to a player who then immediately goes out.
19. All-pass trick clear returning the lead to `trickLeaderId`.
20. Leader attempting to pass is rejected.

### 12.3 Invariants and fuzz
21. **Card conservation**: `sum(hands) + trick + graveyard === 54` after every action.
22. `turnOrder` is never mutated mid-round; length always equals player count.
23. `stateVersion` strictly increases.
24. Fuzz: generate random legal actions from the legal-move generator across thousands of full rounds at 3 through 8 players, asserting invariants 21 to 23 and that no state deadlocks.

### 12.4 Server tests
25. Reconnect reclaims the correct seat via `resumeToken`.
26. Non-host `updateRules` and `startGame` are rejected.
27. Host transfer on disconnect.
28. Turn timeout fires for a disconnected player before the 30 second grace expires.
29. Mid-round leave records the player as last place and the round continues.
30. Redaction: a third party's `roomState` never contains another player's card ids.

### 12.5 Deal and exchange
31. Deal order starts at the dealer; the previous winner receives the fewest cards.
32. Reseating places the winner at `seatIndex N-1`.
33. Exchange counts match the table in Section 4.2 for N = 3 through 8.
34. Forced selection takes the strongest cards and never the 3 of Spades.
35. Exchange timeout auto-gives the rich player's weakest cards.
36. Round 1 skips exchange.

### 12.6 Miyako-ochi (Section 4.5)
37. Previous `DAI_HINMIN` takes 1st: the previous `DAI_FUGO` lands in `droppedPlayerIds`, their hand is empty, and the graveyard grew by exactly that hand.
38. Non-triggers, each asserting the round continues untouched: round 1 (all roles null); the winner carried any role other than `DAI_HINMIN`; the previous `DAI_HINMIN` finishes 2nd rather than 1st; the previous `DAI_FUGO` already left the room (Section 7.7).
39. Agari via 7-pass triggers it, including the case where the previous `DAI_FUGO` is the 7-pass target — the cards they just received go to the graveyard, and card conservation still holds at 54.
40. At N = 3 the demotion ends the round immediately: final order is winner, the one remaining player, demoted player, and the demoted player scores 0.
41. Post-demotion eligibility: the demoted player is never advanced to, is not counted by 5-skip, is not a 7-pass target, and `clearTrick` skips them as leader. `turnOrder` still has length N.
42. Next round: the demoted player is `DAI_HINMIN`, dealer, and seat 0; the winner is `DAI_FUGO` at seat N-1; exchange counts follow Section 4.2 for the swapped pair. A mid-round leave after a demotion sits above the demoted player, not below.

---

## 13. Runbook

```bash
# Setup
npm install

# Engine must be green before any client work
npm run test -w @daifugo/core

# Full stack: fastify/socket on :4000, vite on :5173
npm run dev
```

Build order: `core` types and strength, then combo and evaluator, then the rules
directory, then engine, then the full core test matrix. Do not start client work
until 12.1 through 12.3 pass.

---

## 14. Infrastructure Addendum

Decided after the original spec was written. Supersedes any in-memory assumption
in Section 8.

* **State lives in Firestore**, one doc per room, not in process memory. Instances
  are interchangeable and Cloud Run scales to zero.
* **Concurrency** is a Firestore transaction with a compare-and-set on
  `stateVersion`. A stale action fails the transaction and retries against fresh
  state.
* **Cross-instance broadcast** uses `@socket.io/gcp-pubsub-adapter`. Transport is
  WebSocket-only, which removes any need for session affinity.
* **Timers are two-layer.** A per-instance `setTimeout` armed off `state.deadline`
  is the low-latency fast path. A ~5s Firestore poll (the deadline sweeper) is the
  correctness backstop, because the fast-path timer dies with the instance that
  armed it — during a scale-in, a redeploy, or when every player disconnects. Both
  paths inject the same `TICK`, and the `stateVersion` CAS plus the no-op-on-early-
  `TICK` rule means at most one transition lands per deadline.
* **Cloud Run flags that must not drift**: `--execution-environment=gen2` and
  `--no-cpu-throttling` (required so an instance running the sweeper with no open
  sockets still gets CPU).
* **Redaction stays server-side** per Section 8.5, despite the private-game threat
  model, because the client needs equivalent display logic either way and one
  chokepoint is easier to keep correct than N components.
