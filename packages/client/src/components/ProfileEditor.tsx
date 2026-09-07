import { normalizePlayerIcon, normalizePlayerName, PLAYER_NAME_MAX_LENGTH } from "@daifugo/core";
import { useEffect, useRef, useState } from "react";
import { useSocket } from "../context/SocketContext";
import { useTranslate } from "../i18n/index";
import { EmojiPicker } from "./EmojiPicker";

export function ProfileEditor({
  name,
  icon,
  takenNames,
  disabled = false,
}: {
  name: string;
  icon?: string;
  takenNames: readonly string[];
  disabled?: boolean;
}) {
  const t = useTranslate();
  const { send, status } = useSocket();
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftIcon, setDraftIcon] = useState(() => normalizePlayerIcon(icon));
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const normalizedName = normalizePlayerName(draftName);
  const nameChanged = normalizedName !== name;
  const duplicate =
    normalizedName !== null &&
    nameChanged &&
    takenNames.some((other) => other.toLowerCase() === normalizedName.toLowerCase());
  const unchanged = !nameChanged && draftIcon === normalizePlayerIcon(icon);
  const cannotSave =
    disabled || status !== "connected" || normalizedName === null || duplicate || unchanged;

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <span className="profile-editor">
      <button
        ref={trigger}
        type="button"
        className="profile-editor__trigger"
        aria-label={t("ui.profile.edit")}
        aria-expanded={open}
        onClick={() => {
          setDraftName(name);
          setDraftIcon(normalizePlayerIcon(icon));
          setOpen(true);
        }}
        disabled={disabled || status !== "connected"}
      />
      {open && (
        <span
          className="profile-editor__panel"
          role="group"
          aria-label={t("ui.profile.title")}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <span className="profile-editor__fields">
            <EmojiPicker value={draftIcon} onChange={setDraftIcon} />
            <label className="field profile-editor__name">
              <span>{t("ui.menu.nameLabel")}</span>
              <input
                ref={input}
                type="text"
                value={draftName}
                maxLength={PLAYER_NAME_MAX_LENGTH}
                autoCorrect="off"
                enterKeyHint="done"
                aria-invalid={normalizedName === null || duplicate}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
          </span>
          {duplicate && <span className="profile-editor__error">{t("ui.profile.nameTaken")}</span>}
          <span className="profile-editor__actions">
            <button type="button" onClick={close}>
              {t("ui.profile.cancel")}
            </button>
            <button
              type="button"
              disabled={cannotSave}
              onClick={() => {
                if (normalizedName === null || duplicate) return;
                if (send("updateProfile", normalizedName, draftIcon)) close();
              }}
            >
              {t("ui.profile.save")}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
