/**
 * Everything the hand row and the action column need to agree on (§10.2-§10.8).
 *
 * The two are one interaction — what is selected decides what the Play button
 * says — so the state lives here, above both, and `GameTable` hands each of them
 * the slice it renders.
 *
 * **The weighted layout is recomputed only at turn start (§10.3).** The turn is
 * identified by core's own `legalMovesKey`: the hand, the trick top, the two
 * inversion flags and the suit lock. Nothing in that key can change while it is
 * your turn, so the fan's geometry is fixed for the turn and cards cannot slide
 * under a finger mid-selection. What narrows within the turn is `dimmed`, which
 * is a class, not a width.
 *
 * The legal set itself is memoised on the same key through core's
 * `createLegalMoveCache`, which is what §10.3 asks for.
 *
 * **A dimmed card cannot be picked up (§10.4).** Selection is closed under the
 * legal set: a tap or a drag only adds a card that at least one legal move
 * contains alongside everything already selected — exactly the set `isDimmed`
 * renders dark. Refusing the pick is the honest version of what the dimming
 * already says; the alternative is letting a player assemble a hand the Play
 * button then has to talk them out of. Deselection is never refused, so a
 * selection can always be unwound.
 *
 * **A refused tap still answers.** The reason the card was refused is exactly
 * what the Play button would have said had the selection been allowed to happen,
 * so `selectionNotice` carries it — through the same `blockerText` the button
 * uses — and the hand row raises it for `SELECTION_NOTICE_MS` where the tap was.
 * A refusal with no explanation teaches a new player nothing except that the game
 * is ignoring them; the point of the gate is to keep them out of a bad selection,
 * not to keep them in the dark about why.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createLegalMoveCache,
  invertedIn,
  legalMovesKey,
  trickContextOf,
  type Card,
  type ErrorCode,
  type JokerBinding,
  type PublicGameState,
} from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { kaidanLockGlyph, suitLockGlyphs } from "../glyphs";
import { blockerText } from "../hand/blockerText";
import { comboLabel, type ComboLabel } from "../hand/comboLabel";
import {
  bindingOptions,
  continuationIds,
  passBlocker,
  playableIds,
  resolveSelection,
  turnBlocker,
} from "../hand/legality";
import { sortHand } from "../hand/sort";
import {
  AUTO_PASS_DELAY_MS,
  SELECTION_NOTICE_MS,
  layoutHand,
  weightOf,
  type HandFanLayout,
} from "../layout/handLayout";
import type { I18nKey, TranslateParams } from "../i18n/index";

/** A refused tap, ready to render: the message it resolved to, and its params. */
export interface SelectionNotice {
  key: I18nKey;
  params: TranslateParams;
  id: number;
}

export interface HandController {
  /** The hand in display order (§10.8). */
  cards: Card[];
  layout: HandFanLayout;
  /** Frozen at turn start: what the fan's widths and scales were computed from. */
  isUnplayable: (cardId: string) => boolean;
  /** Narrows within the turn. Dims only — never resizes (§10.3). */
  isDimmed: (cardId: string) => boolean;
  isSelected: (cardId: string) => boolean;
  /** Whether a tap would take this card. False for every dimmed card (§10.4). */
  isSelectable: (cardId: string) => boolean;
  /**
   * Why the last tap was refused, or null. `id` rises with every refusal so a
   * second tap on the same card replays the notice instead of sitting still.
   */
  selectionNotice: SelectionNotice | null;
  /** The binding a selected joker currently carries, or null for pure (§10.5). */
  bindingOf: (cardId: string) => JokerBinding | null;
  /** How many legal bindings the selection has. The badge cycles when > 1. */
  bindingChoices: number;
  cycleBinding: () => void;
  /** Tap: select or deselect. Never plays (§10.4). */
  toggle: (cardId: string) => void;
  /** Drag-across: add without removing (§10.4). */
  beginDrag: (cardId: string) => void;
  extendTo: (cardId: string) => void;
  endDrag: () => void;
  /** The resolved combo's name, or null when the selection resolves to nothing. */
  playLabel: ComboLabel | null;
  /** Why Play is disabled, with the params its message needs (§10.6). */
  playBlocker: ErrorCode | null;
  blockerParams: TranslateParams;
  play: () => void;
  passBlocker: ErrorCode | null;
  pass: () => void;
  /** §10.7: the 1.2s "no legal play, passing" card is up. */
  autoPassing: boolean;
}

export function useHandController(room: PublicGameState): HandController {
  const { status, send } = useSocket();
  const legalMoves = useRef(createLegalMoveCache()).current;

  const ctx = useMemo(() => trickContextOf(room), [room]);
  const inverted = invertedIn(ctx);
  const turnKey = legalMovesKey(room.myHand, ctx);

  const [selected, setSelected] = useState<string[]>([]);
  const [optionIndex, setOptionIndex] = useState(0);
  const [lastTurnKey, setLastTurnKey] = useState(turnKey);
  const dragging = useRef(false);
  // The selection as of the last event rather than the last render: a fast drag
  // fires several `pointerenter`s inside one batch, and each of them has to test
  // its card against what the ones before it already added.
  const selectedNow = useRef<string[]>(selected);
  const [notice, setNotice] = useState<SelectionNotice | null>(null);
  const noticeCount = useRef(0);

  const setSelection = useCallback((next: string[]): void => {
    selectedNow.current = next;
    setSelected(next);
    // A selection that went through has answered the refusal that preceded it.
    setNotice(null);
  }, []);

  // A new turn — or a hand that changed under us — is a fresh selection. Adjusting
  // state during render is the supported way to react to a changed input without
  // rendering the stale value first.
  if (turnKey !== lastTurnKey) {
    setLastTurnKey(turnKey);
    selectedNow.current = [];
    setSelected([]);
    setOptionIndex(0);
    setNotice(null);
  }

  const moves = useMemo(() => legalMoves(room.myHand, ctx), [legalMoves, room.myHand, ctx]);

  const blocked = turnBlocker(room);
  // §10.3: the legal set only says anything while the seat may act on it. Off
  // turn the hand is a display, so it renders flat — shrinking cards against a
  // trick top someone else is still going to change is noise, and the fan
  // reflowing at turn start is the cue that the turn arrived.
  const yourTurn = blocked === null;

  // Frozen for the turn: the widths and scales of §10.3 come from this set.
  const turnPlayable = useMemo(() => playableIds(moves), [moves]);
  const stillPlayable = useMemo(() => continuationIds(moves, selected), [moves, selected]);

  const cards = useMemo(() => sortHand(room.myHand, inverted), [room.myHand, inverted]);
  const layout = useMemo(
    () => layoutHand(cards.map((card) => weightOf(!yourTurn || turnPlayable.has(card.id)))),
    [cards, turnPlayable, yourTurn],
  );

  const selectedCards = useMemo(
    () => cards.filter((card) => selected.includes(card.id)),
    [cards, selected],
  );
  const options = useMemo(() => bindingOptions(selectedCards, ctx), [selectedCards, ctx]);
  const option = options[optionIndex % Math.max(1, options.length)] ?? null;

  const resolved = useMemo(
    () => resolveSelection(selectedCards, option, ctx),
    [selectedCards, option, ctx],
  );

  const playBlocker = blocked ?? (resolved.ok ? null : resolved.error);
  // Everything a disabled control's reason might need to be specific (§10.6):
  // the count the trick top demands, the suits a shibari lock names, and the
  // rank a kaidan lock requires next.
  const blockerParams: TranslateParams = {
    count: ctx.top?.cards.length ?? 0,
    suits: suitLockGlyphs(room.suitLock ?? []),
    rank: room.kaidanLock === null ? "" : kaidanLockGlyph(room.kaidanLock),
  };

  /**
   * Why adding `cardId` to `current` would be refused, or null to allow it.
   *
   * The gate is the same set that dims the row — the cards some legal move holds
   * alongside everything already picked. The second test is what makes a reason
   * always available: if the resulting selection is *itself* legal it is allowed
   * through regardless, so a refusal always has an evaluator error behind it to
   * name, and the gate can never be stricter than the server. Removing is never
   * gated.
   */
  const refusalOf = useCallback(
    (current: readonly string[], cardId: string): ErrorCode | null => {
      if (continuationIds(moves, current).has(cardId)) return null;
      const would = cards.filter((card) => card.id === cardId || current.includes(card.id));
      const resolved = resolveSelection(would, null, ctx);
      return resolved.ok ? null : resolved.error;
    },
    [moves, cards, ctx],
  );

  const toggle = useCallback(
    (cardId: string) => {
      const current = selectedNow.current;
      if (current.includes(cardId)) {
        setSelection(current.filter((id) => id !== cardId));
        setOptionIndex(0);
        return;
      }
      const refusal = refusalOf(current, cardId);
      if (refusal !== null) {
        noticeCount.current += 1;
        const [key, params] = blockerText(refusal, blockerParams);
        setNotice({ key, params, id: noticeCount.current });
        return;
      }
      setSelection([...current, cardId]);
      setOptionIndex(0);
    },
    [refusalOf, blockerParams, setSelection],
  );

  const beginDrag = useCallback(
    (cardId: string) => {
      dragging.current = true;
      toggle(cardId);
    },
    [toggle],
  );

  // A drag that crosses a dimmed card skips it and carries on, so the finger does
  // not have to thread the gaps in a run — silently, because a sweep of the row
  // crosses several and a notice per card would be a strobe, not an explanation.
  // The card the drag *started* on went through `toggle` and did explain itself.
  const extendTo = useCallback(
    (cardId: string) => {
      if (!dragging.current) return;
      const current = selectedNow.current;
      if (current.includes(cardId) || refusalOf(current, cardId) !== null) return;
      setSelection([...current, cardId]);
      setOptionIndex(0);
    },
    [refusalOf, setSelection],
  );

  const endDrag = useCallback(() => {
    dragging.current = false;
  }, []);

  // A drag that ends off a card — or outside the window — must not leave the row
  // latched into drag mode for the next tap.
  useEffect(() => {
    const stop = (): void => {
      dragging.current = false;
    };
    globalThis.addEventListener?.("pointerup", stop);
    globalThis.addEventListener?.("pointercancel", stop);
    return () => {
      globalThis.removeEventListener?.("pointerup", stop);
      globalThis.removeEventListener?.("pointercancel", stop);
    };
  }, []);

  // The notice takes itself down. Keyed on the object rather than its id so a
  // repeat refusal restarts the clock along with the animation.
  useEffect(() => {
    if (notice === null) return;
    const handle = setTimeout(() => setNotice(null), SELECTION_NOTICE_MS);
    return () => clearTimeout(handle);
  }, [notice]);

  const cycleBinding = useCallback(() => {
    if (options.length <= 1) return;
    setOptionIndex((current) => (current + 1) % options.length);
  }, [options.length]);

  const play = useCallback(() => {
    if (playBlocker !== null || !resolved.ok) return;
    const cardIds = resolved.value.cards.map((card) => card.id);
    // Bindings are sent explicitly whenever the selection holds a joker, so the
    // server binds what the badge showed rather than re-deriving the default
    // (§5.5) — including the empty array, which is an explicit pure play. Without
    // a joker the argument is *omitted* rather than passed as undefined: the
    // Socket.IO packet is JSON, where a trailing undefined arrives as null, and
    // null is not the "resolve them yourself" that `parseCombo` reads.
    if (selectedCards.some((card) => card.isJoker)) {
      send("playCards", cardIds, resolved.value.bindings);
    } else {
      send("playCards", cardIds);
    }
    setSelection([]);
    setOptionIndex(0);
  }, [playBlocker, resolved, selectedCards, send, setSelection]);

  const passReason = passBlocker(room);
  const pass = useCallback(() => {
    if (passReason !== null) return;
    send("pass");
  }, [passReason, send]);

  /* ---------------------------------------------------------------------- */
  /* Auto-pass (§10.7)                                                      */
  /* ---------------------------------------------------------------------- */

  // Only on a genuinely empty legal set, never merely on a bad hand — and only
  // when passing is legal, so a leader with cards is never passed for. A pending
  // action of the player's blocks it through `turnBlocker`, which `passBlocker`
  // reports first. Connection readiness belongs here too: after a reconnect, the
  // refreshed room state must arrive before this stale view can schedule anything.
  const shouldAutoPass =
    status === "connected" && passReason === null && moves.length === 0 && room.myHand.length > 0;
  const [autoPassing, setAutoPassing] = useState(false);
  const autoPassed = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldAutoPass || autoPassed.current === turnKey) {
      setAutoPassing(false);
      return;
    }
    setAutoPassing(true);
    // The guard is marked *inside* the timeout, never here. Its job is to stop a
    // second pass for the same turn, and it can do that from either place — but
    // StrictMode double-invokes mount effects, so a guard set before scheduling
    // would make the re-run bail on its own mark and leave the turn unpassed.
    // Mounting straight into an empty legal set is what a reconnect does (§8.1).
    const handle = setTimeout(() => {
      setAutoPassing(false);
      if (send("pass")) autoPassed.current = turnKey;
    }, AUTO_PASS_DELAY_MS);
    return () => clearTimeout(handle);
  }, [shouldAutoPass, turnKey, send]);

  return {
    cards,
    layout,
    isUnplayable: (cardId) => yourTurn && !turnPlayable.has(cardId),
    isDimmed: (cardId) => yourTurn && !stillPlayable.has(cardId),
    isSelected: (cardId) => selected.includes(cardId),
    isSelectable: (cardId) => selected.includes(cardId) || stillPlayable.has(cardId),
    selectionNotice: notice,
    bindingOf: (cardId) => option?.bindings.find((binding) => binding.cardId === cardId) ?? null,
    bindingChoices: options.length,
    cycleBinding,
    toggle,
    beginDrag,
    extendTo,
    endDrag,
    playLabel: resolved.ok ? comboLabel(resolved.value) : null,
    playBlocker,
    blockerParams,
    play,
    passBlocker: passReason,
    pass,
    autoPassing,
  };
}
