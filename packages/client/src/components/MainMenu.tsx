/**
 * The main menu (§10, §11): name, join by code, create a room, and role names.
 *
 * Creating a room is `POST /rooms` followed by a `joinRoom` — the code has to
 * exist before anyone can join it (§8), and the first joiner becomes host (§8.2).
 * A seat this browser already holds is offered as a rejoin, which replays the
 * stored `resumeToken` instead of taking a new seat (§8.1).
 *
 * A page loaded on `/ABC` arrives with that code already in the field: the
 * provider auto-joins it when it knows a name, and lands here when it does not,
 * so the only thing left to type is the name (`roomUrl.ts`).
 *
 * Every string here resolves through a key; nothing is written inline.
 */
import { useState, type FormEvent } from "react";
import { useCopy, type I18nKey } from "../i18n/index";
import { useSocket } from "../context/SocketContext";
import { TerminologyToggle } from "./TerminologyToggle";
import { readStoredPlayerName } from "../playerName";

import { EmojiPicker } from "./EmojiPicker";
import { readStoredPlayerIcon, writeStoredPlayerIcon } from "../playerIcon";

const NAME_MAX_LENGTH = 16;
const CODE_MAX_LENGTH = 3;

/** The server's join codes are 3 uppercase letters. */
function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, CODE_MAX_LENGTH);
}

export function MainMenu() {
  const { t, terminology } = useCopy();
  const { createRoom, joinRoom, leaveRoom, status, storedSession, initialRoomCode } = useSocket();
  // The seat's name if this browser still holds one, otherwise the name it
  // played under last time (`playerName.ts`) — a returning player starts typed in.
  const [name, setName] = useState(() => {
    const seatName = storedSession?.playerName ?? "";
    return seatName !== "" ? seatName : readStoredPlayerName();
  });
  const [icon, setIcon] = useState(readStoredPlayerIcon);
  const [code, setCode] = useState(() => initialRoomCode ?? "");
  const [notice, setNotice] = useState<I18nKey | null>(null);
  const [creating, setCreating] = useState(false);

  const busy = creating || status === "connecting";
  const trimmedName = name.trim();
  // Join stays disabled until the code is a full 3 letters (`normalizeCode`
  // already rejects anything else), so the primary action can't misfire.
  const codeIsComplete = code.length === CODE_MAX_LENGTH;

  function requireName(): boolean {
    if (trimmedName !== "") return true;
    setNotice("ui.menu.nameRequired");
    return false;
  }

  async function onCreate(): Promise<void> {
    setNotice(null);
    if (!requireName()) return;
    setCreating(true);
    try {
      await createRoom(trimmedName, icon);
    } catch {
      setNotice("ui.menu.createFailed");
    } finally {
      setCreating(false);
    }
  }

  function onJoin(event: FormEvent): void {
    event.preventDefault();
    setNotice(null);
    if (!requireName()) return;
    joinRoom(code, trimmedName, icon);
  }

  return (
    <div className="main-menu">
      <section className="main-menu__identity">
        <h1 className="main-menu__title">
          {/* Keyed so a terminology switch re-runs the swap animation. */}
          <span key={terminology} className="main-menu__title-text">
            {t("ui.app.title")}
          </span>
        </h1>
        <TerminologyToggle />

        <div className="main-menu__profile">
          <EmojiPicker
            value={icon}
            onChange={(value) => {
              setIcon(value);
              writeStoredPlayerIcon(value);
            }}
          />
          <label className="field main-menu__name">
            <span>{t("ui.menu.nameLabel")}</span>
            <input
              type="text"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              placeholder={t("ui.menu.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="main-menu__actions">
        <form className="main-menu__join" onSubmit={onJoin}>
          <label className="field main-menu__code">
            <span>{t("ui.menu.roomCodeLabel")}</span>
            <input
              type="text"
              value={code}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={CODE_MAX_LENGTH}
              placeholder={t("ui.menu.roomCodePlaceholder")}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
            />
          </label>
          <button
            type="submit"
            className="main-menu__button main-menu__button--primary"
            disabled={busy || !codeIsComplete}
          >
            {status === "connecting" ? t("ui.menu.joining") : t("ui.menu.joinRoom")}
          </button>
        </form>

        <div className="main-menu__or">{t("ui.menu.or")}</div>

        <button
          type="button"
          className="main-menu__button"
          disabled={busy}
          onClick={() => void onCreate()}
        >
          {creating ? t("ui.menu.creating") : t("ui.menu.createRoom")}
        </button>

        {storedSession !== null && (
          <div className="main-menu__resume">
            <button
              type="button"
              className="main-menu__link"
              disabled={busy}
              onClick={() => {
                joinRoom(
                  storedSession.roomId,
                  trimmedName === "" ? storedSession.playerName : trimmedName,
                  icon,
                );
              }}
            >
              {t("ui.menu.rejoin", { code: storedSession.roomId })}
            </button>
            <button
              type="button"
              className="main-menu__link main-menu__link--quiet"
              onClick={leaveRoom}
            >
              {t("ui.menu.forget")}
            </button>
          </div>
        )}

        {notice !== null && (
          <p className="main-menu__notice" role="alert">
            {t(notice)}
          </p>
        )}
      </div>
    </div>
  );
}
