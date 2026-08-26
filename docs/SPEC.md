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

export type ComboType = 'SINGLE' | 'PAIR' | 'TRIPLE' | 'QUAD' | 'N_OF_A_KIND' | 'SEQUENCE';

export interface PlayCombo {
  type: ComboType;
  cards: Card[];
  bindings: JokerBinding[];     // empty when no jokers, or jokers played pure
  count: number;                // cards.length
  /** Rank all cards resolve to for N_OF_A_KIND. null for SEQUENCE. */
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
  graveyard: Card[];                    // 10-discard sink

  dealerId: string;                     // previous round's last place
  turnOrder: string[];                  // ALL player ids in seat order. Never mutated mid-round.
  activePlayerIndex: number;            // index into turnOrder

  currentTrick: { combo: PlayCombo; playedBy: string }[];
  trickLeaderId: string | null;         // last player who actually played
  passedPlayerIds: string[];
  finishedPlayerIds: string[];          // in order of going out (agari)

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
1. The last-place finisher becomes dealer and takes `seatIndex 0`.
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
Derived from `finishedPlayerIds` order plus the final remaining player, who is
always last place.

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
joker is therefore the *weakest* card during revolution. Note that inversion never
changes sequence adjacency (Section 5.4), only comparison.

### 5.3 N-of-a-kind
1 through 4+ cards sharing a resolved rank. Comparison is by strength index of that
rank. Count must match the top play exactly.

Two pure jokers form a legal pair of jokers. Nothing beats it in normal orientation.
A pure joker cannot combine with a non-joker to form a pair, because its rank is
"joker", not a number. To pair with an 8 the joker must be bound to an 8.

### 5.4 Sequences
* Minimum length 3, all cards the same suit, consecutive by strength index.
* `K-A-2` is legal (indices 10, 11, 12). Wrapping past 2 back to 3 is **not**
  legal, so `A-2-3` is invalid.
* Comparison is by the **highest** card's strength index.
* Length must match the top play exactly. A 4-card sequence cannot beat a 3-card one.
* Jokers may fill any position including interior gaps, bound to the required rank
  and the sequence's suit.

### 5.5 Joker binding
Each joker is either **pure** (strength 13, suit null) or **wildcard** (bound to a
specific rank and suit via `JokerBinding`).

Consequences, all intentional:
* A wildcard joker triggers rank-based house rules. Joker bound to an 8 in a pair of
  8s does fire 8-giri. Joker bound to a 5 adds to the skip count. Joker bound to a
  Jack counts toward 11-back parity.
* A wildcard joker counts toward revolution. `JKR-as-K + K + K + K` is four kings.
* The 3 of Spades counter applies **only** to a pure joker played as a single.
  A joker bound to a 4 is a 4 and beats the 3 of Spades normally. The check reads
  the binding, never `card.isJoker`.
* Both jokers may appear in one combo with **different** bindings.
  `JKR-as-5H + JKR-as-6H + 7H` is a legal sequence.
* A pure joker satisfies any active suit lock and does not break it.

### 5.6 Binding resolution
The client sends explicit `bindings`. The server validates them and never trusts
them blindly. When `bindings` is absent, the server applies the default rule.

**Default: the strongest legal binding.**

1. Determine combo type and count from the non-joker cards, constrained by the
   trick top when the trick is non-empty.
2. Enumerate all bindings that produce a legal play.
3. Select the one with the greatest effective strength. Pure counts as a binding
   candidate and wins ties.

Leading a lone joker therefore always resolves to pure, which is correct.

---

## 6. House Rules

All rules read the **resolved** rank after binding. On a sequence, the trigger
count is the number of cards in the combo resolving to that rank, so `7-8-9` fires
7-pass with count 1 and 8-giri, and `5-6-7` fires a 1-player skip and a 1-card pass.

| Rule | Trigger | Mechanics |
| :--- | :--- | :--- |
| **Spade 3 Beats Joker** | Trick top is a **single pure joker**. | A single 3 of Spades is legal over it in any inversion state and is treated as the strongest card over that joker. Does not apply to a pair of jokers or to a bound joker. |
| **5-Skip** | Combo contains rank 5. | `S` = number of 5s. Skip the next `S` **eligible** players (non-finished and not yet passed). If `S >= (eligible players other than self)`, clear the trick instead and keep the lead. |
| **7-Pass** | Combo contains rank 7. | `C` = number of 7s, `k = min(C, cards remaining in hand)`. Sets `RESOLVE_7_PASS`. Target is the nearest **non-finished** player to the left, regardless of whether they have passed or would be skipped. |
| **8-Giri** | Combo contains rank 8. | Trick clears immediately, lead stays with the player. |
| **9-Giri** | Combo contains **two or more** cards of rank 9. | Same as 8-Giri. A single 9 does nothing. |
| **10-Discard** | Combo contains rank 10. | `D` = number of 10s, `k = min(D, cards remaining)`. Sets `RESOLVE_10_DISCARD`. Selected cards go to `graveyard`. |
| **11-Back** | Combo contains rank 11. | `J` = number of Jacks. Odd toggles `trickInverted`. Even is a no-op. Resets on trick clear. |
| **Revolution** | **Four or more cards of the same rank** played simultaneously. | Toggles `isRevolution` for the rest of the round. Sequences never trigger revolution regardless of length. |
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
  ├── If trick non-empty: combo type and count match the top exactly
  ├── Strength check under effectiveInverted, plus the Spade-3-over-pure-joker exception
  └── Shibari: if suitLock is set, combo suit multiset must match exactly
      (pure jokers wildcard through)

PHASE A - IMMEDIATE STATE EFFECTS (applied in this order)
  ├── Move cards from hand to currentTrick, set trickLeaderId = playerId
  ├── Revolution: if count >= 4 and all resolve to one rank -> toggle isRevolution
  ├── 11-Back: if jackCount is odd -> toggle trickInverted
  └── Shibari: if suit multiset equals the previous play's -> set suitLock

  Note: Phase 0 validates against the PRE-play inversion state. Revolution and
  11-back apply only to subsequent plays.

PHASE B - INTERACTIVE RULES (ascending rank, each halts the pipeline)
  ├── Rank 7 present and k > 0 -> pendingAction = RESOLVE_7_PASS, return
  └── Rank 10 present and k > 0 -> pendingAction = RESOLVE_10_DISCARD, return

PHASE C - AGARI
  └── If hand empty -> append playerId to finishedPlayerIds
      If non-finished players <= 1 -> assign remaining player last place, ROUND_END

PHASE D - TRICK ENDERS (ascending rank)
  ├── Rank 8 present -> clearTrick(leader = playerId)
  └── Two or more 9s -> clearTrick(leader = playerId)
      If either fired, skip Phase E entirely. Skips are consumed by the clear.

PHASE E - 5-SKIP
  └── S = number of 5s. If S >= (eligible players other than self)
      -> clearTrick(leader = playerId). Otherwise advance by (1 + S) eligible seats.

PHASE F - ADVANCE
  └── Advance activePlayerIndex to the next eligible player. Set deadline = now + 60s.
```

### 7.2 Resuming after a pendingAction
`SUBMIT_7_PASS` and `SUBMIT_10_DISCARD` do **not** simply clear the flag and advance.
They apply the transfer or discard, then **re-enter the pipeline at Phase B** to pick
up any higher-ranked interactive rule, then continue through C, D, E, F.

This matters: `7-8-9` halts at Phase B, and 8-giri must still fire on resume.
`7-10` in a sequence halts twice.

### 7.3 Agari via pass or discard
Both can empty a hand. Playing a single 7 with two cards in hand leaves one card,
`k = min(1,1) = 1`, and passing it empties the hand. The same applies to 10-discard.
Phase C runs after every pendingAction resolution as well as after the initial play.
Emptying your hand this way is a normal agari.

### 7.4 clearTrick(leader)

```text
currentTrick = []
passedPlayerIds = []
trickInverted = false
suitLock = null
isRevolution UNCHANGED
trickLeaderId = leader
If leader has finished -> advance to the nearest non-finished player to their left
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

"Eligible" means not finished and not in `passedPlayerIds`.

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
bottom of the finish order. Reseating and exchange for the next round use the
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

Points awarded at round end: `N - finishPosition`, so the winner of a 5-player round
scores 4 and last place scores 0. Standings accumulate across rounds and render in
the lobby between rounds.

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
The Play button names the resolved combo: "Play Pair of 8s", "Play 5-6-7 of Hearts".
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

Sample mappings:

| Key | en | ja |
| :--- | :--- | :--- |
| `rule.eightGiri` | Eight Cutter | 8切り |
| `rule.shibari` | Suit Lock | 縛り |
| `rule.kakumei` | Revolution | 革命 |
| `rule.elevenBack` | Jack Reversal | 11バック |
| `role.DAI_HINMIN` | Grand Pauper | 大貧民 |
| `history.sevenPassRedacted` | {player} passed {count} card(s) to {target} | ... |

Language toggle on the main menu, persisted to localStorage, no server involvement.

---

## 12. Test Matrix

### 12.1 Unit, single rule
1. `strength.test.ts` - standard order, inverted order, `effectiveInverted` XOR truth table.
2. `spade3.test.ts` - beats a single pure joker normally and under revolution; loses to a joker bound to a 4; illegal against a pair of jokers.
3. `fiveSkip.test.ts` - 1, 2, and 3 fives at 4 players; the stacking case that clears the trick and returns the lead.
4. `sevenPass.test.ts` - state transition; `k = min(C, remaining)`; k = 0 when playing the last card; target skips finished players but not passed ones.
5. `nineGiri.test.ts` - single 9 does not clear; pair and triple do.
6. `tenDiscard.test.ts` - pair of 10s discards 2 to graveyard; non-active players rejected.
7. `elevenBack.test.ts` - 1, 2, 3 Jacks parity; reset on trick clear.
8. `shibari.test.ts` - two hearts plays lock; mixed {H,S} locks; overlapping but unequal sets do not lock; non-matching play rejected; pure joker satisfies and maintains.
9. `kakumei.test.ts` - 4 of a kind toggles; 5-card sequence does not; wildcard joker counts toward the four.
10. `sequence.test.ts` - min length 3; K-A-2 legal; A-2-3 illegal; exact length match; highest-card comparison; interior joker fill.

### 12.2 Interaction tests (where the bugs will be)
11. `7-8-9` fires 7-pass, halts, and 8-giri still fires on resume.
12. `5-6-7` fires both skip and pass, with pass targeting correctly despite the skip.
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

## 14. Known Risks (not blockers)

1. **8 players is thin.** 54 cards over 8 is 6 to 7 each, and the exchange pattern
   makes the Dai-Hinmin surrender 4 of them, over half their hand. Expect to cap at
   6 after playtesting, or to clamp exchange counts at 8 players.
2. **Hand legibility above ~15 cards.** At 3 players hands run to 18. The weighted
   shrink helps but the fan gets dense. Revisit if it grates.
3. **The 3 of Spades exclusion from forced exchange** was stated for the 3-player
   case and generalised here to all forced selections. Confirm after a session.

---

## 15. Infrastructure Addendum

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
