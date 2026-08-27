/**
 * Canonical i18n key registry (§11).
 *
 * Every rule name, role name, history line, and error goes through a key in this
 * file. No bare strings enter `GameState`. The client's `en.json` / `ja.json`
 * bundles are typechecked against `I18nKey`, so adding a key here is a compile
 * error until both bundles carry a translation for it.
 *
 * `ui.*` keys are client-only presentation strings and are deliberately not
 * enumerated here; nothing in core emits them.
 */
import { HOUSE_RULE_KEYS } from "./config.js";
import type { HistoryEntry, HouseRuleKey, RoleKind } from "./types.js";

/* -------------------------------------------------------------------------- */
/* rule.*                                                                     */
/* -------------------------------------------------------------------------- */

export type RuleKey = `rule.${HouseRuleKey}`;

export const RULE_KEYS: readonly RuleKey[] = HOUSE_RULE_KEYS.map((key): RuleKey => `rule.${key}`);

export function ruleKey(key: HouseRuleKey): RuleKey {
  return `rule.${key}`;
}

/* -------------------------------------------------------------------------- */
/* role.*                                                                     */
/* -------------------------------------------------------------------------- */

export type RoleKey = `role.${RoleKind}`;

export const ROLE_KINDS = [
  "DAI_FUGO",
  "FUGO",
  "HEIMIN",
  "HINMIN",
  "DAI_HINMIN",
] as const satisfies readonly RoleKind[];

export const ROLE_KEYS: readonly RoleKey[] = ROLE_KINDS.map((kind): RoleKey => `role.${kind}`);

export function roleKey(kind: RoleKind): RoleKey {
  return `role.${kind}`;
}

/* -------------------------------------------------------------------------- */
/* history.*                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every history line the engine can emit.
 *
 * A `*Redacted` key is the public rendering of its non-redacted counterpart: the
 * sanitizer (§8.5) rewrites an entry naming private card ids into the redacted
 * key, which takes a `count` instead of a `cards` param, for viewers outside
 * `visibleTo`. Redacted keys therefore always come in pairs.
 */
export const HISTORY_KEYS = [
  // Match and round lifecycle
  "history.gameStarted",
  "history.roundStarted",
  "history.roundEnded",
  "history.matchEnded",
  "history.roleAssigned",
  "history.dealt",

  // Exchange (§4)
  "history.exchangeStarted",
  "history.exchangeCompleted",
  "history.exchangeGave",
  "history.exchangeGaveRedacted",
  "history.exchangeAutoGave",

  // Trick flow (§7)
  "history.played",
  "history.passed",
  "history.trickCleared",
  "history.allPassed",
  "history.leadPassed",
  "history.agari",

  // House rules (§6)
  "history.spade3BeatsJoker",
  "history.fiveSkip",
  "history.fiveSkipCleared",
  "history.sevenPass",
  "history.sevenPassRedacted",
  "history.eightGiri",
  "history.nineGiri",
  "history.tenDiscard",
  "history.tenDiscardRedacted",
  "history.elevenBack",
  "history.elevenBackEnded",
  "history.kakumei",
  "history.kakumeiEnded",
  "history.shibariLocked",

  // Timeouts (§7.6)
  "history.turnTimeout",
  "history.autoPlayed",
  "history.autoPassed",

  // Roster (§7.7, §8.2)
  "history.playerJoined",
  "history.playerLeft",
  "history.hostTransferred",
] as const;

export type HistoryKey = (typeof HISTORY_KEYS)[number];

/* -------------------------------------------------------------------------- */
/* error.*                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The `E` of `Result<GameState, ErrorCode>` (§7) and of `gameError` (§8).
 *
 * Not merely a transport vocabulary: §10.6 renders the specific reason inline on
 * the disabled Play button ("Must follow Hearts", "Not high enough"), so every
 * distinct reason a play can be illegal carries its own code. Widening this union
 * later means changing core at the bottom of the dependency chain, so it is
 * enumerated fully up front.
 */
export const ERROR_CODES = [
  // Permissions and phase
  "NOT_HOST",
  "NOT_YOUR_TURN",
  "WRONG_STATUS",
  "GAME_ALREADY_STARTED",
  "NOT_ENOUGH_PLAYERS",
  "TOO_MANY_PLAYERS",
  "PLAYER_NOT_FOUND",
  "INVALID_ROUND_LIMIT",

  // Pending actions (§7.2)
  "PENDING_ACTION_BLOCKS",
  "NO_PENDING_ACTION",
  "WRONG_PENDING_ACTION",

  // Card selection
  "EMPTY_SELECTION",
  "DUPLICATE_CARD_IDS",
  "CARD_NOT_IN_HAND",
  "WRONG_CARD_COUNT",

  // Combo shape (§5.3, §5.4) - the selection is not a combo at all.
  // Each of these is a distinct inline reason on the disabled Play button (§10.6),
  // so they are never collapsed into a single ILLEGAL_PLAY.
  "MIXED_RANKS",
  "JOKER_MUST_BE_BOUND",
  "SEQUENCE_TOO_SHORT",
  "SEQUENCE_SUIT_MISMATCH",
  "SEQUENCE_NOT_CONSECUTIVE",

  // Joker binding (§5.5, §5.6)
  "INVALID_BINDING",
  "DUPLICATE_BINDING",
  "NO_LEGAL_BINDING",

  // Legality against the trick top (§7.1 Phase 0)
  "COMBO_TYPE_MISMATCH",
  "COMBO_COUNT_MISMATCH",
  "TOO_WEAK",
  "SUIT_LOCK_MISMATCH",

  // Pass (§7.5)
  "CANNOT_PASS_AS_LEADER",
  "ALREADY_PASSED",

  // Exchange (§4)
  "NOT_IN_EXCHANGE",
  "NOT_EXCHANGE_PARTICIPANT",
  "EXCHANGE_FORCED",
  "EXCHANGE_ALREADY_SUBMITTED",

  // Room lifecycle (§8)
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "NAME_TAKEN",
  "INVALID_ACTION",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorKey = `error.${ErrorCode}`;

export const ERROR_KEYS: readonly ErrorKey[] = ERROR_CODES.map((code): ErrorKey => `error.${code}`);

export function errorKey(code: ErrorCode): ErrorKey {
  return `error.${code}`;
}

/* -------------------------------------------------------------------------- */
/* The union                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every key core can emit. The client defines its own `UiI18nKey` for the `ui.*`
 * namespace and composes `type I18nKey = CoreI18nKey | UiI18nKey`, which is what
 * `en.json` / `ja.json` are typechecked against (§11).
 */
export type CoreI18nKey = RuleKey | RoleKey | HistoryKey | ErrorKey;

/** Every key core can emit, as a value. The client concatenates its `ui.*` list. */
export const CORE_I18N_KEYS: readonly CoreI18nKey[] = [
  ...RULE_KEYS,
  ...ROLE_KEYS,
  ...HISTORY_KEYS,
  ...ERROR_KEYS,
];

/**
 * The core half of a translation bundle. The client intersects this with its own
 * `ui.*` record to type `en.json` / `ja.json`.
 */
export type CoreI18nBundle = Record<CoreI18nKey, string>;

/* -------------------------------------------------------------------------- */
/* History entry builder                                                      */
/* -------------------------------------------------------------------------- */

export interface HistoryOptions {
  /** Names of params holding card ids that outsiders must not see (§8.5). */
  privateCardParams?: string[];
  /** Player ids that see the unredacted entry. Undefined means everyone. */
  visibleTo?: string[];
}

/**
 * Build a `HistoryEntry`. The only supported way to append to `GameState.history`
 * — the key is constrained to `HistoryKey`, so a bare string will not compile.
 *
 * The result is frozen: `applyAction` is pure, and history entries are shared
 * across every state that descends from the one they were appended to.
 */
export function history(
  key: HistoryKey,
  params: Record<string, string | number> = {},
  options: HistoryOptions = {},
): Readonly<HistoryEntry> {
  const entry: HistoryEntry = { key, params: Object.freeze({ ...params }) };
  if (options.privateCardParams !== undefined) {
    entry.privateCardParams = Object.freeze([...options.privateCardParams]) as string[];
  }
  if (options.visibleTo !== undefined) {
    entry.visibleTo = Object.freeze([...options.visibleTo]) as string[];
  }
  return Object.freeze(entry);
}
