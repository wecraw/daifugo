import { useEffect, useId, useRef, useState } from "react";
import { normalizePlayerIcon, PLAYER_ICONS } from "@daifugo/core";
import { useTranslate } from "../i18n/index";

export function EmojiPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (icon: string) => void;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = normalizePlayerIcon(value);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      className="emoji-picker"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="emoji-picker__trigger"
        ref={trigger}
        aria-label={t("ui.menu.iconLabel")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className="emoji-picker__current" aria-hidden="true">
          {selected}
        </span>
      </button>
      {open && (
        <div
          id={id}
          className="emoji-picker__panel"
          role="group"
          aria-label={t("ui.menu.iconLabel")}
        >
          {PLAYER_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              className="emoji-picker__option"
              aria-label={t("ui.menu.chooseIcon", { icon })}
              aria-pressed={icon === selected}
              onClick={() => {
                onChange(icon);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span aria-hidden="true">{icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
