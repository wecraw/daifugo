/**
 * One card, face up.
 *
 * The trick area is what needs it now; the hand row of §10.2 renders the same
 * face at its own size, which is why the size is a prop rather than baked in.
 *
 * A joker carries its binding when it has one, so the trick shows what the card
 * actually resolved to (§5.4) rather than a wildcard the reader has to decode.
 */
import type { Card, JokerBinding } from "@daifugo/core";
import { cardFace } from "../glyphs";

export type CardFaceSize = "trick" | "hand";

export interface CardFaceProps {
  card: Card;
  /** The binding this card was played under, if it is a bound joker. */
  binding?: JokerBinding;
  size?: CardFaceSize;
}

export function CardFace({ card, binding, size = "trick" }: CardFaceProps) {
  const face = cardFace(card, binding);
  const classes = [
    "card-face",
    `card-face--${size}`,
    face.isRed ? "card-face--red" : "card-face--black",
    face.isJoker ? "card-face--joker" : "",
    face.isBound ? "card-face--bound" : "",
  ].filter((name) => name !== "");

  return (
    <span className={classes.join(" ")} data-card-id={card.id}>
      <span className="card-face__rank">{face.rank}</span>
      <span className="card-face__suit">{face.suit}</span>
    </span>
  );
}
