/**
 * The table's symbols: suit pips, rank indices, and the role marks on a seat chip.
 *
 * These are deliberately *not* i18n keys. A suit pip and a rank index are the
 * deck's own notation and read identically in both bundles — `♠` and `10` are
 * not English — so putting them behind `ui.*` would buy two identical strings and
 * a maintenance cost. The same carve-out the rotate arrow already gets: a glyph
 * carrying no language is not a bare string (§11).
 *
 * The role marks are the one case where a glyph stands in for something that *is*
 * language, because `role.DAI_FUGO` will not fit in a 56px seat chip. Every place
 * one renders, the translated role name rides along as the element's title, so
 * the name is still reachable — the glyph is shorthand, not a replacement.
 */
import type { Card, JokerBinding, Rank, RoleKind, Suit } from "@daifugo/core";

export const SUIT_GLYPH: Readonly<Record<Suit, string>> = Object.freeze({
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
});

/** 1 is the Ace and 2 is the Two (§2); strength order is separate and elsewhere. */
export const RANK_LABEL: Readonly<Record<Rank, string>> = Object.freeze({
  1: "A",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
});

export const JOKER_GLYPH = "★";

export const ROLE_GLYPH: Readonly<Record<RoleKind, string>> = Object.freeze({
  DAI_FUGO: "◆◆",
  FUGO: "◆",
  HEIMIN: "◇",
  HINMIN: "▽",
  DAI_HINMIN: "▽▽",
});

export function isRedSuit(suit: Suit | null): boolean {
  return suit === "H" || suit === "D";
}

/** What a card shows on its face: its rank index, its pip, and how to colour it. */
export interface CardFaceParts {
  rank: string;
  suit: string;
  isRed: boolean;
  /** A joker, bound or not — it keeps its own styling either way (§10.5). */
  isJoker: boolean;
  /** A joker showing what it was bound to rather than its own face (§5.4). */
  isBound: boolean;
}

/**
 * A card's face, with a joker's binding resolved onto it when it has one.
 *
 * A bound joker shows the card it stands for, because that is what the trick is
 * actually holding — the resolved rank is what every house rule reads (§6) — and
 * keeps the joker styling so nobody mistakes it for the real card.
 */
export function cardFace(card: Card, binding?: JokerBinding): CardFaceParts {
  if (card.isJoker) {
    if (binding === undefined) {
      return { rank: JOKER_GLYPH, suit: "", isRed: false, isJoker: true, isBound: false };
    }
    return {
      rank: RANK_LABEL[binding.rank],
      suit: SUIT_GLYPH[binding.suit],
      isRed: isRedSuit(binding.suit),
      isJoker: true,
      isBound: true,
    };
  }
  return {
    rank: card.rank === null ? "" : RANK_LABEL[card.rank],
    suit: card.suit === null ? "" : SUIT_GLYPH[card.suit],
    isRed: isRedSuit(card.suit),
    isJoker: false,
    isBound: false,
  };
}

/** The exact suit multiset a shibari lock names (§5), as pips. */
export function suitLockGlyphs(suits: readonly Suit[]): string {
  return suits.map((suit) => SUIT_GLYPH[suit]).join("");
}

/** What a joker's binding badge shows (§10.5): the rank it stands for, and its pip. */
export function bindingGlyph(binding: JokerBinding): string {
  return `${RANK_LABEL[binding.rank]}${SUIT_GLYPH[binding.suit]}`;
}
