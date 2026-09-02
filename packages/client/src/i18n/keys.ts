/**
 * The `ui.*` namespace and the composed key union (§11).
 *
 * Core owns `rule.*`, `role.*`, `history.*` and `error.*` and exports them as
 * `CoreI18nKey`; `ui.*` is client-only presentation text and must never move into
 * core — nothing in core emits it. The client composes the union here, and
 * `en.json` / `ja.json` are typechecked against `I18nBundle`, so adding a key on
 * either side is a compile error until both bundles carry a translation.
 */
import { CORE_I18N_KEYS, type CoreI18nKey } from "@daifugo/core";

/**
 * Every presentation string the client can render. Listed as values rather than
 * as a bare type so the bundle test can assert the two JSON files carry exactly
 * these keys and nothing else.
 */
export const UI_I18N_KEYS = [
  // Shell
  "ui.app.title",
  "ui.app.tagline",

  // Orientation gate (§0: landscape only, portrait shows a rotate prompt)
  "ui.orientation.rotateTitle",
  "ui.orientation.rotateBody",

  // Main menu
  "ui.menu.nameLabel",
  "ui.menu.namePlaceholder",
  "ui.menu.createRoom",
  "ui.menu.creating",
  "ui.menu.joinRoom",
  "ui.menu.joining",
  "ui.menu.roomCodeLabel",
  "ui.menu.roomCodePlaceholder",
  "ui.menu.rejoin",
  "ui.menu.forget",
  "ui.menu.nameRequired",
  "ui.menu.roomCodeRequired",
  "ui.menu.createFailed",

  // Language toggle (§11): client-side only, persisted to localStorage
  "ui.language.label",
  "ui.language.en",
  "ui.language.ja",

  // Connection status
  "ui.connection.connecting",
  "ui.connection.connected",
  "ui.connection.reconnecting",
  "ui.connection.offline",

  // The seated shell. The lobby and table themselves arrive with their own
  // issues; this is what the socket layer can already render on its own.
  "ui.room.code",
  "ui.room.players",
  "ui.room.waiting",
  "ui.room.leave",

  "ui.error.dismiss",
] as const;

export type UiI18nKey = (typeof UI_I18N_KEYS)[number];

/** §11: `type I18nKey = CoreI18nKey | UiI18nKey`, composed by the client. */
export type I18nKey = CoreI18nKey | UiI18nKey;

/** Every key, as a value. The order is core-first, then `ui.*`. */
export const I18N_KEYS: readonly I18nKey[] = [...CORE_I18N_KEYS, ...UI_I18N_KEYS];

/**
 * A complete translation bundle. `en.json` and `ja.json` are both asserted to
 * this type, so a missing or unknown key fails `tsc` rather than rendering as a
 * raw key at runtime.
 */
export type I18nBundle = Record<I18nKey, string>;

/** The two languages of §0. Persisted to localStorage, never sent to the server. */
export const LANGUAGES = ["en", "ja"] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}
