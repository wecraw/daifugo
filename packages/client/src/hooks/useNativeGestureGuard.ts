import { useEffect } from "react";

/**
 * Suppresses the browser's own touch gestures so a tap on the table is only ever
 * a game gesture (§0: the table is a fixed viewport that never zooms or scrolls).
 *
 * CSS carries most of this — `touch-action` kills double-tap zoom, `user-select`
 * and `-webkit-touch-callout` kill the long-press selection and callout. What is
 * left needs JS because iOS Safari has no declarative form of it:
 *
 * - `gesture*` is Safari's pinch-zoom, which ignores `user-scalable=no`.
 * - `dblclick` is the desktop/last-resort half of double-tap zoom.
 * - `contextmenu` is the long-press callout and the desktop right-click menu.
 * - `selectstart`/`dragstart` are the drag-to-highlight and drag-the-image
 *   behaviours that survive `user-select: none` on some engines.
 *
 * Text fields keep every one of these: selecting, the callout and the paste menu
 * are how a room code gets typed.
 */
export function useNativeGestureGuard(): void {
  useEffect(() => {
    const block = (event: Event) => {
      event.preventDefault();
    };
    const blockOutsideText = (event: Event) => {
      if (isTextField(event.target)) return;
      event.preventDefault();
    };

    // Safari's pinch gestures are not in the DOM typings; they are also the one
    // pair here that must be non-passive to be cancellable at all.
    const passive = { passive: false } as const;
    document.addEventListener("gesturestart", block, passive);
    document.addEventListener("gesturechange", block, passive);
    document.addEventListener("gestureend", block, passive);
    document.addEventListener("dblclick", block, passive);
    document.addEventListener("contextmenu", blockOutsideText);
    document.addEventListener("selectstart", blockOutsideText);
    document.addEventListener("dragstart", blockOutsideText);

    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
      document.removeEventListener("gestureend", block);
      document.removeEventListener("dblclick", block);
      document.removeEventListener("contextmenu", blockOutsideText);
      document.removeEventListener("selectstart", blockOutsideText);
      document.removeEventListener("dragstart", blockOutsideText);
    };
  }, []);
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, [contenteditable]") !== null;
}
