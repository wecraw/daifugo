/**
 * Portrait blocker (§0): the game is landscape only, so portrait gets a rotate
 * prompt instead of a squeezed table — plus, for a phone whose rotation is locked
 * and which therefore never reports landscape, the offer to rotate the app itself.
 *
 * The frame is always rendered, in both orientations, because it is what the
 * layout measures against: it is a size container, so the `cq` units and container
 * queries in `styles.css` read the frame's own axes rather than the device's, and
 * a frame turned on its side needs no second set of rules.
 */
import type { ReactNode } from "react";
import { useIsPortrait, useLandscapeLock, useSidewaysMode } from "../hooks/useOrientation";
import { useTranslate } from "../i18n/index";

export function OrientationGate({ children }: { children: ReactNode }) {
  const t = useTranslate();
  const portrait = useIsPortrait();
  const [optedIn, enableSideways] = useSidewaysMode();
  useLandscapeLock();

  const sideways = portrait && optedIn;

  return (
    <div className={sideways ? "viewport viewport--sideways" : "viewport"}>
      {portrait && !sideways ? (
        <div className="rotate-prompt" role="alert">
          <div className="rotate-prompt__icon" aria-hidden="true">
            ⟳
          </div>
          <h1>{t("ui.orientation.rotateTitle")}</h1>
          <p>{t("ui.orientation.rotateBody")}</p>
          <button type="button" className="rotate-prompt__sideways" onClick={enableSideways}>
            {t("ui.orientation.playSideways")}
          </button>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
