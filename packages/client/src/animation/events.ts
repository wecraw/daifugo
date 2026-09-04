/**
 * What just happened at the table, derived from two consecutive states (§10.9).
 *
 * The client never learns *events*: the server broadcasts a whole
 * `PublicGameState` after every applied action (§8.4), so the only record of what
 * changed is the history the action appended. That is what this file reads. It is
 * a pure function of the two snapshots — no DOM, no clock — which is what lets the
 * whole animation vocabulary be tested without a layout engine.
 *
 * History is append-only for the life of a room and already redacted for this
 * viewer (§8.5), so the delta is a suffix and every entry in it is one this seat
 * is allowed to see. A 7-pass therefore animates for outsiders too — they get
 * `history.sevenPassRedacted`, which still names both seats and the count, which
 * is exactly what the travel shows.
 *
 * **Animations play over an already-applied state.** Nothing here feeds back into
 * what is rendered as the truth: `deriveTableAnimations` is called with the new
 * state already on screen, and what it returns is decoration laid on top of it.
 */
import { type Card, type PublicGameState } from "@daifugo/core";

/* Durations. Long enough to read, short enough not to sit between two turns. */
export const TRICK_SWEEP_MS = 520;
export const REVOLUTION_MS = 1500;
export const SEVEN_PASS_MS = 760;
export const GIRI_MS = 900;
export const SKIP_MS = 800;
/** One skipped seat's arc starts this long after the one before it. */
export const SKIP_STAGGER_MS = 90;
export const AGARI_MS = 700;
export const MIYAKO_OCHI_MS = 1100;

/**
 * A delta longer than this is a resync, not a play.
 *
 * One action appends a handful of entries at most. A reconnect hands the client a
 * state whose history has grown by everything it missed (§8.1), and replaying a
 * minute of banners at someone who has just come back is worse than showing them
 * nothing — the table they are looking at is already correct.
 */
export const MAX_DELTA_ENTRIES = 12;

interface AnimationBase {
  /** Stable across re-renders: derived from the state version that produced it. */
  id: string;
  /** How long after the state landed this starts. Sequencing lives here (§10.9). */
  delayMs: number;
  durationMs: number;
}

export type TableAnimation =
  | (AnimationBase & { kind: "trickSweep"; cards: Card[] })
  | (AnimationBase & { kind: "revolution"; on: boolean; player: string })
  | (AnimationBase & { kind: "sevenPass"; player: string; target: string; count: number })
  | (AnimationBase & { kind: "giri"; rule: "eightGiri" | "nineGiriMinPair"; player: string })
  | (AnimationBase & { kind: "skip"; player: string; skipped: string[] })
  | (AnimationBase & { kind: "agari"; player: string; position: number })
  | (AnimationBase & { kind: "miyakoOchi"; player: string; target: string; count: number });

export type TableAnimationKind = TableAnimation["kind"];

function text(params: Record<string, string | number>, name: string): string {
  const value = params[name];
  return typeof value === "string" ? value : "";
}

function count(params: Record<string, string | number>, name: string): number {
  const value = params[name];
  return typeof value === "number" ? value : 0;
}

/** Card ids are logged joined by a single space (§8.5). */
function ids(params: Record<string, string | number>, name: string): string[] {
  const value = text(params, name);
  return value.trim() === "" ? [] : value.trim().split(/\s+/);
}

function cardsById(pool: readonly Card[], wanted: readonly string[]): Card[] {
  const byId = new Map(pool.map((card) => [card.id, card]));
  return wanted.flatMap((id) => {
    const card = byId.get(id);
    return card === undefined ? [] : [card];
  });
}

/**
 * The cards that left the table on a clear.
 *
 * `prev.currentTrick` is everything that was already down; the play that caused
 * the clear — an 8-giri, say — went onto the trick and off it again inside the
 * same action, so it is only in the graveyard by the time the client sees it.
 * `history.played` names it publicly, which is what resolves it back to cards.
 */
function sweptCards(
  prev: PublicGameState,
  next: PublicGameState,
  added: readonly PublicGameState["history"][number][],
): Card[] {
  const onTable = prev.currentTrick.flatMap((play) => play.combo.cards);
  const played = added.find(
    (entry) => entry.key === "history.played" || entry.key === "history.autoPlayed",
  );
  const justPlayed =
    played === undefined ? [] : cardsById(next.graveyard, ids(played.params, "cards"));
  return [...onTable, ...justPlayed];
}

/**
 * Everything worth animating between `prev` and `next`, in the order it happened.
 *
 * Only the miyako-ochi entry is sequenced rather than immediate: §4.5's demotion
 * happens inside the winner's own action, so both land in one delta, and cards
 * leaving a hand nobody played reads as a bug unless the agari it answers has
 * finished playing first.
 */
export function deriveTableAnimations(
  prev: PublicGameState,
  next: PublicGameState,
): TableAnimation[] {
  if (next.roomId !== prev.roomId) return [];
  if (next.stateVersion <= prev.stateVersion) return [];
  if (next.history.length <= prev.history.length) return [];

  const added = next.history.slice(prev.history.length);
  if (added.length > MAX_DELTA_ENTRIES) return [];

  const out: TableAnimation[] = [];
  const id = (kind: TableAnimationKind, index: number): string =>
    `${next.stateVersion}:${kind}:${index}`;
  let agariMs = 0;

  added.forEach((entry, index) => {
    const params = entry.params;
    switch (entry.key) {
      case "history.trickCleared": {
        const cards = sweptCards(prev, next, added);
        if (cards.length > 0) {
          out.push({
            kind: "trickSweep",
            id: id("trickSweep", index),
            delayMs: 0,
            durationMs: TRICK_SWEEP_MS,
            cards,
          });
        }
        return;
      }
      case "history.kakumei":
      case "history.kakumeiEnded":
        out.push({
          kind: "revolution",
          id: id("revolution", index),
          delayMs: 0,
          durationMs: REVOLUTION_MS,
          on: entry.key === "history.kakumei",
          player: text(params, "player"),
        });
        return;
      case "history.sevenPass":
      case "history.sevenPassRedacted":
        out.push({
          kind: "sevenPass",
          id: id("sevenPass", index),
          delayMs: 0,
          durationMs: SEVEN_PASS_MS,
          player: text(params, "player"),
          target: text(params, "target"),
          count: count(params, "count"),
        });
        return;
      case "history.eightGiri":
      case "history.nineGiri":
        out.push({
          kind: "giri",
          id: id("giri", index),
          delayMs: 0,
          durationMs: GIRI_MS,
          rule: entry.key === "history.eightGiri" ? "eightGiri" : "nineGiriMinPair",
          player: text(params, "player"),
        });
        return;
      case "history.fiveSkip": {
        const skipped = ids(params, "skipped");
        out.push({
          kind: "skip",
          id: id("skip", index),
          delayMs: 0,
          // Each skipped seat's arc starts after the one before it, so the skip
          // reads as travelling around the table rather than as a flash; the
          // queue has to hold the animation until the last of them lands.
          durationMs: SKIP_MS + SKIP_STAGGER_MS * Math.max(0, skipped.length - 1),
          player: text(params, "player"),
          skipped,
        });
        return;
      }
      case "history.agari":
        agariMs = AGARI_MS;
        out.push({
          kind: "agari",
          id: id("agari", index),
          delayMs: 0,
          durationMs: AGARI_MS,
          player: text(params, "player"),
          position: count(params, "position"),
        });
        return;
      case "history.miyakoOchi":
        out.push({
          kind: "miyakoOchi",
          id: id("miyakoOchi", index),
          // After the agari, never over it: the win is the cause and has to be
          // legible before its consequence (§4.5).
          delayMs: agariMs,
          durationMs: MIYAKO_OCHI_MS,
          player: text(params, "player"),
          target: text(params, "target"),
          count: count(params, "count"),
        });
        return;
      default:
        return;
    }
  });

  return out;
}

/** When an animation is finished and can leave the DOM. */
export function animationEndsAt(animation: TableAnimation): number {
  return animation.delayMs + animation.durationMs;
}

/** The seat a miyako-ochi is currently emptying, if one is playing (§4.5). */
export function miyakoOchiTarget(animations: readonly TableAnimation[]): string | null {
  for (const animation of animations) {
    if (animation.kind === "miyakoOchi") return animation.target;
  }
  return null;
}
