/**
 * The main menu (§10, §11): name, create a room, join by code, and the language
 * toggle.
 *
 * Creating a room is `POST /rooms` followed by a `joinRoom` — the code has to
 * exist before anyone can join it (§8), and the first joiner becomes host (§8.2).
 * A seat this browser already holds is offered as a rejoin, which replays the
 * stored `resumeToken` instead of taking a new seat (§8.1).
 *
 * Every string here resolves through a key; nothing is written inline.
 */
import { useState, type FormEvent } from "react";
import { useTranslate, type I18nKey } from "../i18n/index";
import { useSocket } from "../context/SocketContext";
import { LanguageToggle } from "./LanguageToggle";

const NAME_MAX_LENGTH = 16;
const CODE_MAX_LENGTH = 6;

/** The server's join codes are uppercase and alphanumeric (no O/0, I/1, L). */
function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_MAX_LENGTH);
}

export function MainMenu() {
  const t = useTranslate();
  const { createRoom, joinRoom, leaveRoom, status, storedSession } = useSocket();
  const [name, setName] = useState(() => storedSession?.playerName ?? "");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<I18nKey | null>(null);
  const [creating, setCreating] = useState(false);

  const busy = creating || status === "connecting";
  const trimmedName = name.trim();

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
      await createRoom(trimmedName);
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
    if (code === "") {
      setNotice("ui.menu.roomCodeRequired");
      return;
    }
    joinRoom(code, trimmedName);
  }

  return (
    <div className="main-menu">
      <header className="main-menu__header">
        <h1>{t("ui.app.title")}</h1>
        <p>{t("ui.app.tagline")}</p>
        <LanguageToggle />
      </header>

      <form className="main-menu__form" onSubmit={onJoin}>
        <label className="field">
          <span>{t("ui.menu.nameLabel")}</span>
          <input
            type="text"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            placeholder={t("ui.menu.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field">
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

        <div className="main-menu__actions">
          <button type="submit" disabled={busy}>
            {status === "connecting" ? t("ui.menu.joining") : t("ui.menu.joinRoom")}
          </button>
          <button type="button" disabled={busy} onClick={() => void onCreate()}>
            {creating ? t("ui.menu.creating") : t("ui.menu.createRoom")}
          </button>
        </div>
      </form>

      {storedSession !== null && (
        <div className="main-menu__resume">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              joinRoom(
                storedSession.roomId,
                trimmedName === "" ? storedSession.playerName : trimmedName,
              );
            }}
          >
            {t("ui.menu.rejoin", { code: storedSession.roomId })}
          </button>
          <button type="button" onClick={leaveRoom}>
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
  );
}
