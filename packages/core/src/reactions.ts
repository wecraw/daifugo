/**
 * Quick reactions: the little burst of trash talk a seat can throw across the
 * table mid-round.
 *
 * They are **not** game state. Nothing here reaches `applyAction`, `GameState`,
 * or the history log — a reaction is relayed socket-to-socket and forgotten
 * (see `RoomHub`), so it costs no `stateVersion` bump and no Firestore write,
 * and the card-conservation and purity invariants are untouched by design.
 *
 * What core owns is the *vocabulary*: the closed set of ids, so the server can
 * reject anything else without trusting a client, and both ends type the wire
 * against one list. The English text is presentation and lives in the client's
 * `ui.*` bundle (§11), keyed one-to-one off these ids.
 */

/**
 * Every reaction a seat may send. Ids, never phrases: the wire carries the id
 * and the client renders the copy, so a hostile client cannot put arbitrary text
 * on somebody else's table.
 */
export const REACTION_IDS = [
  "getBent",
  "skillIssue",
  "cope",
  "ez",
  "niceTry",
  "cryAboutIt",
  "thatsCrazy",
  "yikes",
  "anyDayNow",
  "luckNotSkill",
  "mistake",
  "cooked",
  "respect",
  "gg",
  "oops",
  "clap",
  "laugh",
  "eyes",
  "skull",
  "shrug",
] as const;

export type ReactionId = (typeof REACTION_IDS)[number];

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === "string" && (REACTION_IDS as readonly string[]).includes(value);
}

/**
 * How many of the pool the quick menu offers at once. The point of the menu is
 * one tap mid-turn, not a catalogue, so it shows a handful drawn at random and
 * the rest of the pool is what keeps the table from getting stale.
 */
export const REACTION_MENU_SIZE = 3;

/**
 * The shortest gap between one seat's reactions. Enforced on the server so a
 * client that ignores it gains nothing; the client honours it too, so the button
 * looks spent instead of silently dropping taps.
 */
export const REACTION_COOLDOWN_MS = 1500;
