/**
 * The `ui.*` namespace and the composed key union (§11).
 *
 * Core owns `rule.*`, `role.*`, `history.*` and `error.*` and exports them as
 * `CoreI18nKey`; `ui.*` is client-only presentation text and must never move into
 * core — nothing in core emits it. The client composes the union here, and
 * `en.json` / `ja.json` are typechecked against `I18nBundle`, so adding a key on
 * either side is a compile error until both bundles carry a translation.
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
  "ui.app.tagline",

  // Orientation gate (§0: landscape only, portrait shows a rotate prompt)
  "ui.orientation.rotateTitle",
  "ui.orientation.rotateBody",

  // Main menu
  "ui.menu.nameLabel",
  "ui.menu.namePlaceholder",
  "ui.menu.createRoom",
  "ui.menu.creating",
  "ui.menu.joinRoom",
  "ui.menu.joining",
  "ui.menu.roomCodeLabel",
  "ui.menu.roomCodePlaceholder",
  "ui.menu.rejoin",
  "ui.menu.forget",
  "ui.menu.nameRequired",
  "ui.menu.roomCodeRequired",
  "ui.menu.createFailed",

  // Language toggle (§11): client-side only, persisted to localStorage
  "ui.language.label",
  "ui.language.en",
  "ui.language.ja",

  // Connection status
  "ui.connection.connecting",
  "ui.connection.connected",
  "ui.connection.reconnecting",
  "ui.connection.offline",

  // The seated shell: the lobby header, and the leave control the table borrows
  // for a mid-round exit (§7.7).
  "ui.room.code",
  "ui.room.players",
  "ui.room.leave",

  // Lobby (§10.11, §9): the roster, the round line, and the start control.
  "ui.lobby.roster",
  "ui.lobby.host",
  "ui.lobby.you",
  "ui.lobby.ready",
  "ui.lobby.readyUp",
  "ui.lobby.unready",
  "ui.lobby.waitingForReady",
  "ui.lobby.connected",
  "ui.lobby.disconnected",
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

  // Host panel (§10.11). Rendered to everyone so a rule change is visible to
  // the whole table; only the host can operate it.
  "ui.host.title",
  "ui.host.rules",
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

  // Seat chips (§10.1): count, standing in the round, and presence.
  "ui.seat.cards",
  "ui.seat.passed",
  "ui.seat.finished",
  "ui.seat.dropped",
  "ui.seat.disconnected",

  // Trick area. The rule badges reuse `rule.*`; only the lock names its suits.
  "ui.trick.suitLock",
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
  "ui.action.autoPass",
  "ui.action.sortLabel",
  "ui.action.sortByRank",
  "ui.action.sortBySuit",

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

  // The pending-action modals (§7.2). Both name the count; the 7-pass names the
  // target, and either can empty the hand, which is a normal agari (§7.3).
  "ui.pending.title",
  "ui.pending.sevenPass",
  "ui.pending.tenDiscard",
  "ui.pending.submitPass",
  "ui.pending.submitDiscard",
  "ui.pending.lastCards",

  // Shared by both: how many more cards a selection needs, and what the clock
  // will do — which depends on whether the selection is still the default it
  // would send anyway (§4.4, §7.6).
  "ui.select.more",
  "ui.select.timeout",
  "ui.select.timeoutChanged",

  // The animation layer (§10.9). The rule banners themselves are `rule.*` keys
  // and the miyako-ochi banner is `history.miyakoOchi`; what is here is the
  // caption beside them and the badge on the seat that just emptied (§4.5).
  "ui.animation.revolutionOn",
  "ui.animation.revolutionOff",
  "ui.animation.agari",
  "ui.animation.miyakoOchiSeat",

  "ui.error.dismiss",
] as const;

export type UiI18nKey = (typeof UI_I18N_KEYS)[number];

/** §11: `type I18nKey = CoreI18nKey | UiI18nKey`, composed by the client. */
export type I18nKey = CoreI18nKey | UiI18nKey;

/** Every key, as a value. The order is core-first, then `ui.*`. */
export const I18N_KEYS: readonly I18nKey[] = [...CORE_I18N_KEYS, ...UI_I18N_KEYS];

/**
 * A complete translation bundle. `en.json` and `ja.json` are both asserted to
 * this type, so a missing or unknown key fails `tsc` rather than rendering as a
 * raw key at runtime.
 */
export type I18nBundle = Record<I18nKey, string>;

/** The two languages of §0. Persisted to localStorage, never sent to the server. */
export const LANGUAGES = ["en", "ja"] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}
