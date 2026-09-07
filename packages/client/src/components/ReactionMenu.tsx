/**
 * The quick-react menu in the corner of the top strip.
 *
 * One tap opens it, a second tap sends: three phrases drawn at random from the
 * pool of twenty (`core/reactions.ts`), redrawn on every open so the table gets
 * a different three each time instead of the same three all night. There is no
 * free-text chat — a fixed pool is the whole point, and it keeps the wire
 * carrying ids rather than strings.
 *
 * The trigger sits at the head of the strip, before the top-edge seats, and goes
 * quiet for the cooldown after a send: the server drops anything faster
 * (`RoomHub.onReaction`), so a spent button is the honest thing to show rather
 * than a tap that silently evaporates.
 *
 * The bubble the player just sent hangs off the trigger, so their own line reads
 * where they are already looking; everyone else's hangs off their seat chip.
 */
import { useEffect, useRef, useState } from "react";
import { REACTION_COOLDOWN_MS, type ReactionId } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useTranslate } from "../i18n/index";
import { drawReactions, reactionKey } from "../reactions";
import type { ActiveReaction } from "../hooks/useReactions";
import { ReactionBubble } from "./ReactionBubble";

export function ReactionMenu({ own }: { own?: ActiveReaction }) {
  const t = useTranslate();
  const { send } = useSocket();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ReactionId[]>(() => drawReactions());
  const [spentUntil, setSpentUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cooling = spentUntil > now;

  // Dismiss on a tap anywhere else, exactly as the icon picker does: the menu
  // floats over the felt, and a tap on the table means "not that".
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  // One timer, armed only while the button is spent: nothing ticks in the
  // background between reactions.
  useEffect(() => {
    if (spentUntil <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), spentUntil - now);
    return () => clearTimeout(timer);
  }, [spentUntil, now]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOptions(drawReactions());
    setOpen(true);
  };

  const pick = (reaction: ReactionId) => {
    setOpen(false);
    trigger.current?.focus();
    if (!send("sendReaction", reaction)) return;
    const sentAt = Date.now();
    setNow(sentAt);
    setSpentUntil(sentAt + REACTION_COOLDOWN_MS);
  };

  return (
    <div
      className="reaction-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        type="button"
        className="reaction-menu__trigger"
        ref={trigger}
        aria-label={t("ui.reaction.open")}
        aria-expanded={open}
        disabled={cooling}
        onClick={toggle}
      >
        <SpeechBubbleMark />
      </button>
      {open && (
        <div className="reaction-menu__panel" role="group" aria-label={t("ui.reaction.open")}>
          {options.map((reaction) => (
            <button
              key={reaction}
              type="button"
              className="reaction-menu__option"
              onClick={() => pick(reaction)}
            >
              {t(reactionKey(reaction))}
            </button>
          ))}
        </div>
      )}
      {/* Not while the panel is open: they would sit in the same place, and the
          line you are about to send matters more than the one you just did. */}
      {own !== undefined && !open && <ReactionBubble reaction={own} placement="trigger" />}
    </div>
  );
}

/**
 * Drawn rather than typeset: an emoji here would render as whatever the device
 * feels like, next to a row of emoji that are the content.
 */
function SpeechBubbleMark() {
  return (
    <svg className="reaction-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 3.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9.6L5 20.5V16.5H4A1.5 1.5 0 0 1 2.5 15V5A1.5 1.5 0 0 1 4 3.5Z" />
      <rect x="6" y="7.4" width="12" height="1.8" rx="0.9" />
      <rect x="6" y="11" width="7.5" height="1.8" rx="0.9" />
    </svg>
  );
}
