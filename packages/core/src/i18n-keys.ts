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
  // Miyako-ochi (§4.5): `{ player, target, count }`. The demoted player's hand is
  // never named, only counted, so this is public and takes no `*Redacted` pair.
  "history.miyakoOchi",
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
  // 10-Discard (§6): the discarded cards land in the public graveyard, exactly as
  // they would land face-up on the table, so this entry names them to everyone and
  // takes no `*Redacted` pair (§8.5).
  "history.tenDiscard",
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

/** The public rendering of a key that names private cards (§8.5, §11). */
export type RedactedHistoryKey = Extract<HistoryKey, `${string}Redacted`>;

/**
 * A history key that has a `<key>Redacted` counterpart.
 *
 * Derived from `HistoryKey` rather than listed, so the pairing rule of §11 holds
 * by construction: adding `history.fooRedacted` to the list above is what makes
 * `history.foo` redactable, and nothing else has to be kept in step.
 */
export type RedactableHistoryKey = {
  [K in HistoryKey]: `${K}Redacted` extends HistoryKey ? K : never;
}[HistoryKey];

const HISTORY_KEY_SET: ReadonlySet<string> = new Set<string>(HISTORY_KEYS);

/** Whether an entry with this key can be rewritten for viewers outside `visibleTo`. */
export function isRedactableHistoryKey(key: HistoryKey): key is RedactableHistoryKey {
  return HISTORY_KEY_SET.has(`${key}Redacted`);
}

/** The counterpart key the sanitizer swaps in, derived by appending `Redacted` (§11). */
export function redactedHistoryKey<K extends RedactableHistoryKey>(key: K): `${K}Redacted` {
  return `${key}Redacted`;
}

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
  // §8.6: the deal waits on every connected non-host seat. Its own code, not a
  // WRONG_STATUS, because the host reads it as "who are we waiting for".
  "PLAYERS_NOT_READY",
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

  // Combo shape (§5.3) - the selection is not a combo at all. N-of-a-kind is the
  // only shape in this game, so a mixed-rank selection is simply rejected; there is
  // no sequence for it to fall back to. Each reason is a distinct inline label on
  // the disabled Play button (§10.6), never collapsed into one ILLEGAL_PLAY.
  "MIXED_RANKS",
  "JOKER_MUST_BE_BOUND",

  // Joker binding (§5.4, §5.5)
  "INVALID_BINDING",
  "DUPLICATE_BINDING",
  "NO_LEGAL_BINDING",

  // Legality against the trick top (§7.1 Phase 0). Count is the only shape check
  // against the top: with one combo shape there is no type to mismatch.
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
