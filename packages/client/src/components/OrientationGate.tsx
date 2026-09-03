/**
 * Portrait blocker (§0): the game is landscape only, so portrait gets a rotate
 * prompt instead of a squeezed table.
 */
import type { ReactNode } from "react";
import { useIsPortrait, useLandscapeLock } from "../hooks/useOrientation";
import { useTranslate } from "../i18n/index";

export function OrientationGate({ children }: { children: ReactNode }) {
  const t = useTranslate();
  const portrait = useIsPortrait();
  useLandscapeLock();

  if (!portrait) return <>{children}</>;

  return (
    <div className="rotate-prompt" role="alert">
      <div className="rotate-prompt__icon" aria-hidden="true">
        ⟳
      </div>
      <h1>{t("ui.orientation.rotateTitle")}</h1>
      <p>{t("ui.orientation.rotateBody")}</p>
    </div>
  );
}
