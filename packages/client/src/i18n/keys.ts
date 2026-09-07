/**
 * The `ui.*` namespace and the composed key union (§11).
 *
 * Core owns `rule.*`, `role.*`, `history.*` and `error.*` and exports them as
 * `CoreI18nKey`; `ui.*` is client-only presentation text and must never move into
 * core — nothing in core emits it. The client composes the union here, and
 * `en.json` is typechecked against `CopyBundle`, so adding a key is a compile
 * error until the English copy exists.
 */
import { CORE_I18N_KEYS, type CoreI18nKey } from "@daifugo/core";

/**
 * Every presentation string the client can render. Listed as values rather than
 * as a bare type so the bundle test can assert the two JSON files carry exactly
 * these keys and nothing else.
 */
export const UI_I18N_KEYS = [
  // Shell
  "ui.app.title",

  // Orientation gate (§0: landscape only, portrait shows a rotate prompt, and a
  // rotation-locked phone can turn the app sideways instead)
  "ui.orientation.rotateTitle",
  "ui.orientation.rotateBody",
  "ui.orientation.playSideways",

  // Main menu
  "ui.menu.nameLabel",
  "ui.menu.iconLabel",
  "ui.menu.chooseIcon",
  "ui.menu.namePlaceholder",
  "ui.menu.createRoom",
  "ui.menu.creating",
  "ui.menu.joinRoom",
  "ui.menu.joining",
  "ui.menu.or",
  "ui.menu.roomCodeLabel",
  "ui.menu.roomCodePlaceholder",
  "ui.menu.rejoin",
  "ui.menu.forget",
  "ui.menu.nameRequired",
  "ui.menu.createFailed",

  // Role-name terminology (§11): client-side only, persisted to localStorage
  "ui.terminology.grandMillionaire",
  "ui.terminology.daifugo",

  // Connection status
  "ui.connection.connecting",
  "ui.connection.connected",
  "ui.connection.reconnecting",
  "ui.connection.offline",

  // The seated shell: the lobby header, and the leave control the table borrows
  // for a mid-round exit (§7.7).
  "ui.room.codeLabel",
  "ui.room.leave",
  "ui.room.share",
  "ui.room.linkCopied",

  // Lobby (§10.11, §9): the roster, the round line, and the start control.
  "ui.lobby.roster",
  "ui.lobby.host",
  "ui.lobby.you",
  "ui.lobby.ready",
  "ui.lobby.waitingForOthers",
  "ui.lobby.readyUp",
  // §7.7: between rounds a join queues and a leave is pending, and §8.6 counts
  // both for the deal — so both are on the roster rather than only in the count.
  "ui.lobby.joining",
  "ui.lobby.leaving",
  "ui.lobby.waitingForReady",
  "ui.lobby.waitingForReadyOne",
  "ui.lobby.disconnected",
  "ui.lobby.openSeat",
  "ui.lobby.round",
  "ui.lobby.roundOfLimit",
  "ui.lobby.start",
  "ui.lobby.nextRound",
  "ui.lobby.waitingForHost",
  "ui.lobby.needMorePlayers",
  "ui.lobby.tooManyPlayers",
  "ui.lobby.matchOver",

  // Between-round standings (§9). Row order is core's finish order (§4.1); the
  // client renders it and never re-derives it.
  "ui.standings.title",
  "ui.standings.position",
  "ui.standings.player",
  "ui.standings.role",
  "ui.standings.points",
  "ui.standings.roundRoles",
  "ui.standings.matchResult",

  // Host panel (§10.11). Rendered to everyone so a rule change is visible to
  // the whole table; only the host can operate it.
  "ui.host.title",
  "ui.host.rules",
  "ui.host.close",
  "ui.host.readOnly",
  "ui.host.roundLimitLabel",
  "ui.host.roundLimitPlaceholder",
  "ui.host.roundLimitApply",
  "ui.host.roundLimitClear",
  "ui.host.roundLimitInvalid",

  // The table (§10.1). Region labels first — the seat columns, the trick area,
  // and the two regions #18 fills — then the turn line above the clock.
  "ui.table.opponents",
  "ui.table.history",
  "ui.table.trickArea",
  "ui.table.handArea",
  "ui.table.actionArea",
  "ui.table.yourTurn",
  "ui.table.turnOf",
  "ui.table.exchange",
  "ui.table.leadOpen",
  "ui.table.waitingFor",

  // Seat chips (§10.1): count, standing in the round, and presence.
  "ui.seat.cards",
  "ui.seat.passed",
  "ui.seat.finished",
  "ui.seat.dropped",
  "ui.seat.disconnected",

  // Trick area. The rule badges reuse `rule.*`; only the locks name what they require.
  "ui.trick.suitLock",
  "ui.trick.kaidanLock",
  "ui.trick.playedBy",

  // Timers (§10.10). Rendered against `state.deadline`, never a local clock.
  "ui.timer.remaining",

  // The hand row (§10.2-§10.5). The cards themselves are the deck's own glyphs;
  // what needs language is the joker badge, which says what the joker will
  // resolve to and that tapping it changes that.
  "ui.hand.jokerBinding",
  "ui.hand.jokerPure",

  // The action column (§10.6, §10.7, §10.8). The Play button names the resolved
  // combo; every reason it is disabled is an `error.*` code (§8.0), never a
  // catch-all and never a toast.
  "ui.action.play",
  "ui.action.pass",
  // §10.6 wants the reason to be as specific as the client can put it, and a
  // shibari lock is the one blocker with something concrete to name. `error.*`
  // has to stay generic — no params travel with `gameError` (§8.4) — so the
  // specific phrasing lives here, in the namespace the client owns (§11).
  "ui.action.mustFollowSuits",
  "ui.action.mustPlayCount",
  "ui.action.mustPlayRank",
  "ui.action.autoPass",

  // Combo names for the Play button, from the combo's count and *resolved* rank
  // (§5.4). Four is the widest N-of-a-kind the naturals make; bound jokers can
  // push a play past it, which is what `many` is for.
  "ui.combo.single",
  "ui.combo.pair",
  "ui.combo.triple",
  "ui.combo.quad",
  "ui.combo.many",
  "ui.combo.joker",
  "ui.combo.jokers",

  // The exchange phase (§4.3, §4.4). The rich side chooses, the poor side is
  // told what leaves, and the middle seat at odd N is told it sits out.
  "ui.exchange.title",
  "ui.exchange.giveTo",
  "ui.exchange.forced",
  "ui.exchange.sitOut",
  "ui.exchange.send",
  "ui.exchange.sent",
  "ui.exchange.waiting",
  "ui.exchange.timeout",

  // The owed 7-pass and 10-discard (§7.2), chosen in the hand row and submitted
  // from the action column. Both name the count; the 7-pass names the target,
  // and either can empty the hand, which is a normal agari (§7.3).
  "ui.pending.sevenPass",
  "ui.pending.tenDiscard",
  "ui.pending.submitPass",
  "ui.pending.submitDiscard",
  "ui.pending.lastCards",
  "ui.pending.timeoutPass",
  "ui.pending.timeoutDiscard",

  // Shared by both: how many more cards a selection needs. What the clock will
  // do is worded per screen — the exchange pre-selects the weakest cards and so
  // its note depends on whether that default still stands (§4.4), while the
  // pending action starts empty and always names the weakest cards (§7.6).
  "ui.select.more",

  // The animation layer (§10.9). The rule banners themselves are `rule.*` keys
  // and the miyako-ochi banner is `history.miyakoOchi`; what is here is the
  // caption beside them and the badge on the seat that just emptied (§4.5).
  "ui.animation.revolutionOn",
  "ui.animation.revolutionOff",
  "ui.animation.agari",
  "ui.animation.miyakoOchiSeat",

  // The round-end curtain (§9): the result drawn over the table it was won on,
  // before the lobby's standings take the screen.
  "ui.roundEnd.title",
  "ui.roundEnd.matchTitle",
  "ui.roundEnd.roundLabel",
  "ui.roundEnd.winner",
  "ui.roundEnd.matchWinner",
  "ui.roundEnd.gained",
  "ui.roundEnd.total",
  "ui.roundEnd.viewLobby",
  "ui.roundEnd.finalStandings",

  "ui.error.dismiss",
] as const;

export type UiI18nKey = (typeof UI_I18N_KEYS)[number];

/** §11: `type I18nKey = CoreI18nKey | UiI18nKey`, composed by the client. */
export type I18nKey = CoreI18nKey | UiI18nKey;

/** Every key, as a value. The order is core-first, then `ui.*`. */
export const I18N_KEYS: readonly I18nKey[] = [...CORE_I18N_KEYS, ...UI_I18N_KEYS];

/**
 * The complete English copy. A missing or unknown key fails `tsc` rather than
 * rendering as a raw key at runtime.
 */
export type CopyBundle = Record<I18nKey, string>;

/** The two naming conventions of §0. Persisted locally, never sent to the server. */
export const TERMINOLOGIES = ["daifugo", "grandMillionaire"] as const;

export type Terminology = (typeof TERMINOLOGIES)[number];

export function isTerminology(value: unknown): value is Terminology {
  return typeof value === "string" && (TERMINOLOGIES as readonly string[]).includes(value);
}
