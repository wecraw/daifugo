/**
 * The host panel (§10.11): the nine house rules behind a disclosure, collapsed by
 * default and all on, plus the round limit of §9.
 *
 * **Rendered to everyone, operable by the host.** A rule change has to be visible
 * to the whole table — the rules decide how the next round plays for all of them —
 * so every seat renders the panel and reads it off `PublicGameState.config`, which
 * is the authoritative copy. Non-host controls are disabled rather than merely
 * rejected: `updateRules` and `setRoundLimit` are host-only (§8.2), and a
 * `NOT_HOST` banner for a control the client should never have sent would be a
 * surprise rather than an explanation.
 *
 * The toggles are driven entirely by the state that comes back from the server;
 * nothing is mirrored locally, so a click that is refused simply leaves the box
 * where it was. `updateRules` takes a partial (§8), so a click sends the one key
 * it changed.
 *
 * **Miyako-ochi is not here.** It is always on and is not a `HouseRulesConfig`
 * entry (§4.5), so it has no toggle to render.
 */
import { useState } from "react";
import { HOUSE_RULE_KEYS, type HouseRuleKey, type PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useTranslate, type I18nKey } from "../i18n/index";

/** §10.11: the disclosure starts collapsed. */
const INITIALLY_OPEN = false;

export function HostPanel({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { playerId, send } = useSocket();
  const [open, setOpen] = useState(INITIALLY_OPEN);
  const [limitDraft, setLimitDraft] = useState("");
  const [notice, setNotice] = useState<I18nKey | null>(null);

  const isHost = room.hostId === playerId;
  // The engine accepts both host-only settings in `LOBBY` and `ROUND_END` only
  // (§7): once the match has ended there is no round left for them to shape.
  const editable = isHost && (room.status === "LOBBY" || room.status === "ROUND_END");

  function toggleRule(key: HouseRuleKey): void {
    if (!editable) return;
    send("updateRules", { [key]: !room.config[key] });
  }

  function applyLimit(): void {
    if (!editable) return;
    const limit = Number.parseInt(limitDraft, 10);
    // §9: a limit only ends a round still to come, so anything at or below the
    // round on the table is `INVALID_ROUND_LIMIT`. Saying so inline is better
    // than sending it and rendering the rejection.
    if (!Number.isInteger(limit) || limit <= room.roundNumber) {
      setNotice("ui.host.roundLimitInvalid");
      return;
    }
    setNotice(null);
    setLimitDraft("");
    send("setRoundLimit", limit);
  }

  function clearLimit(): void {
    if (!editable) return;
    setNotice(null);
    setLimitDraft("");
    send("setRoundLimit", null);
  }

  return (
    <section className="host-panel" aria-label={t("ui.host.title")}>
      <button
        type="button"
        className="host-panel__summary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {t("ui.host.rules")}
      </button>

      {open && (
        <div className="host-panel__body" role="group" aria-label={t("ui.host.title")}>
          {!editable && <p className="host-panel__note">{t("ui.host.readOnly")}</p>}

          <ul className="host-panel__rules">
            {HOUSE_RULE_KEYS.map((key) => (
              <li key={key}>
                <label className="host-panel__rule">
                  <input
                    type="checkbox"
                    checked={room.config[key]}
                    disabled={!editable}
                    onChange={() => toggleRule(key)}
                  />
                  <span>{t(`rule.${key}`)}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="host-panel__limit">
            <label className="field">
              <span>{t("ui.host.roundLimitLabel")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={room.roundNumber + 1}
                value={limitDraft}
                disabled={!editable}
                placeholder={
                  room.roundLimit === null
                    ? t("ui.host.roundLimitPlaceholder")
                    : String(room.roundLimit)
                }
                onChange={(event) => setLimitDraft(event.target.value)}
              />
            </label>
            <button type="button" disabled={!editable} onClick={applyLimit}>
              {t("ui.host.roundLimitApply")}
            </button>
            <button
              type="button"
              disabled={!editable || room.roundLimit === null}
              onClick={clearLimit}
            >
              {t("ui.host.roundLimitClear")}
            </button>
          </div>

          {notice !== null && (
            <p className="host-panel__note" role="alert">
              {t(notice, { min: room.roundNumber })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
