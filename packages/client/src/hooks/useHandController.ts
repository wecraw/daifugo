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
import { suitLockGlyphs } from "../glyphs";
import { comboLabel, type ComboLabel } from "../hand/comboLabel";
import {
  bindingOptions,
  continuationIds,
  passBlocker,
  playableIds,
  resolveSelection,
  turnBlocker,
} from "../hand/legality";
import {
  nextHandSort,
  readHandSort,
  sortHand,
  writeHandSort,
  type HandSortMode,
} from "../hand/sort";
import { AUTO_PASS_DELAY_MS, layoutHand, weightOf, type HandFanLayout } from "../layout/handLayout";
import type { TranslateParams } from "../i18n/index";

export interface HandController {
  /** The hand in display order (§10.8). */
  cards: Card[];
  layout: HandFanLayout;
  /** Frozen at turn start: what the fan's widths and scales were computed from. */
  isUnplayable: (cardId: string) => boolean;
  /** Narrows within the turn. Dims only — never resizes (§10.3). */
  isDimmed: (cardId: string) => boolean;
  isSelected: (cardId: string) => boolean;
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
  sortMode: HandSortMode;
  toggleSort: () => void;
  /** §10.7: the 1.2s "no legal play, passing" card is up. */
  autoPassing: boolean;
}

export function useHandController(room: PublicGameState): HandController {
  const { status, send } = useSocket();
  const legalMoves = useRef(createLegalMoveCache()).current;

  const ctx = useMemo(() => trickContextOf(room), [room]);
  const inverted = invertedIn(ctx);
  const turnKey = legalMovesKey(room.myHand, ctx);

  const [sortMode, setSortMode] = useState<HandSortMode>(() => readHandSort());
  const [selected, setSelected] = useState<string[]>([]);
  const [optionIndex, setOptionIndex] = useState(0);
  const [lastTurnKey, setLastTurnKey] = useState(turnKey);
  const dragging = useRef(false);

  // A new turn — or a hand that changed under us — is a fresh selection. Adjusting
  // state during render is the supported way to react to a changed input without
  // rendering the stale value first.
  if (turnKey !== lastTurnKey) {
    setLastTurnKey(turnKey);
    setSelected([]);
    setOptionIndex(0);
  }

  const moves = useMemo(() => legalMoves(room.myHand, ctx), [legalMoves, room.myHand, ctx]);

  // Frozen for the turn: the widths and scales of §10.3 come from this set.
  const turnPlayable = useMemo(() => playableIds(moves), [moves]);
  const stillPlayable = useMemo(() => continuationIds(moves, selected), [moves, selected]);

  const cards = useMemo(
    () => sortHand(room.myHand, sortMode, inverted),
    [room.myHand, sortMode, inverted],
  );
  const layout = useMemo(
    () => layoutHand(cards.map((card) => weightOf(turnPlayable.has(card.id)))),
    [cards, turnPlayable],
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

  const blocked = turnBlocker(room);
  const playBlocker = blocked ?? (resolved.ok ? null : resolved.error);
  // Everything a disabled control's reason might need to be specific (§10.6):
  // the count the trick top demands, and the suits a shibari lock names.
  const blockerParams: TranslateParams = {
    count: ctx.top?.cards.length ?? 0,
    suits: suitLockGlyphs(room.suitLock ?? []),
  };

  const toggle = useCallback((cardId: string) => {
    setSelected((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
    );
    setOptionIndex(0);
  }, []);

  const beginDrag = useCallback(
    (cardId: string) => {
      dragging.current = true;
      toggle(cardId);
    },
    [toggle],
  );

  const extendTo = useCallback((cardId: string) => {
    if (!dragging.current) return;
    setSelected((current) => (current.includes(cardId) ? current : [...current, cardId]));
    setOptionIndex(0);
  }, []);

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
    setSelected([]);
    setOptionIndex(0);
  }, [playBlocker, resolved, selectedCards, send]);

  const passReason = passBlocker(room);
  const pass = useCallback(() => {
    if (passReason !== null) return;
    send("pass");
  }, [passReason, send]);

  const toggleSort = useCallback(() => {
    setSortMode((current) => {
      const next = nextHandSort(current);
      writeHandSort(next);
      return next;
    });
  }, []);

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
    const handle = setTimeout(() => {
      setAutoPassing(false);
      if (send("pass")) autoPassed.current = turnKey;
    }, AUTO_PASS_DELAY_MS);
    return () => clearTimeout(handle);
  }, [shouldAutoPass, turnKey, send]);

  return {
    cards,
    layout,
    isUnplayable: (cardId) => !turnPlayable.has(cardId),
    isDimmed: (cardId) => !stillPlayable.has(cardId),
    isSelected: (cardId) => selected.includes(cardId),
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
    sortMode,
    toggleSort,
    autoPassing,
  };
}
