/**
 * The main menu (§10, §11): name, join by code, create a room, and role names.
 *
 * Creating a room is `POST /rooms` followed by a `joinRoom` — the code has to
 * exist before anyone can join it (§8), and the first joiner becomes host (§8.2).
 * A seat this browser already holds is offered as a rejoin, which replays the
 * stored `resumeToken` instead of taking a new seat (§8.1).
 *
 * A page loaded on `/ABC` — or an invite link tapped into the iOS app — arrives
 * with that code already in the field: the provider auto-joins it when it knows
 * a name, and lands here when it does not, so the only thing left to type is the
 * name (`roomUrl.ts`).
 *
 * Every string here resolves through a key; nothing is written inline.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { PLAYER_NAME_MAX_LENGTH } from "@daifugo/core";
import { useCopy, type I18nKey } from "../i18n/index";
import { useSocket } from "../context/SocketContext";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { TerminologyToggle } from "./TerminologyToggle";
import { readStoredPlayerName } from "../playerName";

import { EmojiPicker } from "./EmojiPicker";
import { readStoredPlayerIcon, writeStoredPlayerIcon } from "../playerIcon";

const CODE_MAX_LENGTH = 3;
/** Matches `name-spotlight-out` in `styles.css`. */
const SPOTLIGHT_EXIT_MS = 240;

type SpotlightTrack = CSSProperties & {
  "--spotlight-enter-x"?: string;
  "--spotlight-enter-y"?: string;
  "--spotlight-enter-scale-x"?: number;
  "--spotlight-enter-scale-y"?: number;
  "--spotlight-exit-x"?: string;
  "--spotlight-exit-y"?: string;
  "--spotlight-exit-scale-x"?: number;
  "--spotlight-exit-scale-y"?: number;
};

/** The server's join codes are 3 uppercase letters. */
function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, CODE_MAX_LENGTH);
}

export function MainMenu() {
  const { t, terminology } = useCopy();
  const { createRoom, joinRoom, leaveRoom, status, storedSession, linkedRoomCode } = useSocket();
  // The seat's name if this browser still holds one, otherwise the name it
  // played under last time (`playerName.ts`) — a returning player starts typed in.
  const [name, setName] = useState(() => {
    const seatName = storedSession?.playerName ?? "";
    return seatName !== "" ? seatName : readStoredPlayerName();
  });
  const [icon, setIcon] = useState(readStoredPlayerIcon);
  const [code, setCode] = useState(() => linkedRoomCode ?? "");
  const [notice, setNotice] = useState<I18nKey | null>(null);
  const [creating, setCreating] = useState(false);
  // The focused name field is lifted clear of the keyboard (see below). "closing"
  // is the beat that lets it slide back rather than snap.
  const [spotlight, setSpotlight] = useState<"idle" | "open" | "closing">("idle");
  const [spotlightTrack, setSpotlightTrack] = useState<SpotlightTrack>({});
  const spotlightOrigin = useRef<DOMRect | null>(null);
  const nameFieldRef = useRef<HTMLLabelElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyboardInset = useKeyboardInset();

  // An invite link tapped while the menu is already up (the iOS app, §14) fills
  // the field the same way a load on `/ABC` does. The provider joins outright
  // when it knows a name; this is the other half, when it does not.
  useEffect(() => {
    if (linkedRoomCode !== null) setCode(linkedRoomCode);
  }, [linkedRoomCode]);

  useEffect(() => {
    if (spotlight !== "closing") return;
    const timer = setTimeout(() => setSpotlight("idle"), SPOTLIGHT_EXIT_MS);
    return () => clearTimeout(timer);
  }, [spotlight]);

  useLayoutEffect(() => {
    if (spotlight !== "open") return;
    const origin = spotlightOrigin.current;
    const field = nameFieldRef.current;
    if (origin === null || field === null) return;

    // Read the field's final lifted rectangle without letting its entry
    // keyframes affect the measurement. This happens before paint, so the
    // player only sees the animation beginning over the in-flow field.
    field.style.animation = "none";
    field.style.transform = "translate(-50%, -50%)";
    const lifted = field.getBoundingClientRect();
    field.style.removeProperty("animation");
    field.style.removeProperty("transform");

    if (lifted.width === 0 || lifted.height === 0) return;
    setSpotlightTrack((current) => ({
      ...current,
      "--spotlight-enter-x": `${origin.left + origin.width / 2 - (lifted.left + lifted.width / 2)}px`,
      "--spotlight-enter-y": `${origin.top + origin.height / 2 - (lifted.top + lifted.height / 2)}px`,
      "--spotlight-enter-scale-x": origin.width / lifted.width,
      "--spotlight-enter-scale-y": origin.height / lifted.height,
    }));
  }, [keyboardInset, spotlight]);

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
    <div className="main-menu" data-spotlight={spotlight === "idle" ? undefined : spotlight}>
      {/*
       * The scrim behind the lifted name field. Decorative — the field it dims
       * to is focused, so a screen reader is already there — and a tap on it is
       * the way out, which is what a player reaches for before the keyboard's
       * own dismiss key.
       */}
      {spotlight !== "idle" && (
        <div
          className="input-spotlight"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.preventDefault();
            nameRef.current?.blur();
          }}
        />
      )}
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
          <label
            ref={nameFieldRef}
            className="field main-menu__name"
            style={
              {
                "--keyboard-inset": `${keyboardInset}px`,
                ...spotlightTrack,
              } as CSSProperties
            }
          >
            <span>{t("ui.menu.nameLabel")}</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              maxLength={PLAYER_NAME_MAX_LENGTH}
              enterKeyHint="done"
              autoCorrect="off"
              placeholder={t("ui.menu.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onFocus={() => {
                // Remember the in-flow destination before fixed positioning
                // lifts the field into the keyboard's visible strip.
                spotlightOrigin.current = nameFieldRef.current?.getBoundingClientRect() ?? null;
                setSpotlightTrack({});
                setSpotlight("open");
              }}
              onBlur={() => {
                const origin = spotlightOrigin.current;
                const lifted = nameFieldRef.current?.getBoundingClientRect();
                if (
                  origin !== null &&
                  lifted !== undefined &&
                  lifted.width > 0 &&
                  lifted.height > 0
                ) {
                  // The closing keyframes keep the field fixed, then translate
                  // and scale it onto the exact rectangle it will occupy once
                  // it returns to normal flow. The state handoff is invisible.
                  setSpotlightTrack((current) => ({
                    ...current,
                    "--spotlight-exit-x": `${origin.left + origin.width / 2 - (lifted.left + lifted.width / 2)}px`,
                    "--spotlight-exit-y": `${origin.top + origin.height / 2 - (lifted.top + lifted.height / 2)}px`,
                    "--spotlight-exit-scale-x": origin.width / lifted.width,
                    "--spotlight-exit-scale-y": origin.height / lifted.height,
                  }));
                }
                setSpotlight((current) => (current === "open" ? "closing" : current));
              }}
              onKeyDown={(event) => {
                // Enter is "done" on the phone keyboard: it closes the field
                // rather than submitting anything, since the name is not a form.
                if (event.key === "Enter") event.currentTarget.blur();
              }}
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
