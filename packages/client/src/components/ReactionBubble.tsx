/**
 * One reaction, said out loud over the table.
 *
 * It is announced politely — `role="status"`, so a screen reader hears the line
 * without losing its place — and keyed on the arrival nonce by its parent, so
 * the same phrase sent twice replays the pop rather than sitting there.
 */
import type { ActiveReaction } from "../hooks/useReactions";
import { useTranslate } from "../i18n/index";
import { reactionKey } from "../reactions";

export function ReactionBubble({
  reaction,
  placement,
}: {
  reaction: ActiveReaction;
  /** Where it hangs: off a seat chip, or off the quick-react trigger. */
  placement: "seat" | "trigger";
}) {
  const t = useTranslate();
  return (
    <span
      key={reaction.nonce}
      className={`reaction-bubble reaction-bubble--${placement}`}
      role="status"
    >
      {t(reactionKey(reaction.reaction))}
    </span>
  );
}
