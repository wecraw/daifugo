/**
 * The `gameError` banner (§8.4): the code is an `ErrorCode`, rendered through its
 * `error.*` key (§11). Validation the player could have seen coming belongs inline
 * on the Play button instead (§10.6), never here.
 */
import { errorKey, type ErrorCode } from "@daifugo/core";
import { useTranslate, type TranslateParams } from "../i18n/index";

export function ErrorBanner({
  code,
  params,
  onDismiss,
}: {
  code: ErrorCode;
  params?: TranslateParams;
  onDismiss: () => void;
}) {
  const t = useTranslate();
  return (
    <div className="error-banner" role="alert">
      <span>{t(errorKey(code), params)}</span>
      <button type="button" onClick={onDismiss}>
        {t("ui.error.dismiss")}
      </button>
    </div>
  );
}
