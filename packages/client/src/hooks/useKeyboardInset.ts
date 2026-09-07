/**
 * How much of the frame the on-screen keyboard is covering, in CSS pixels.
 *
 * The iOS shell runs with `KeyboardResize.None` (`capacitor.config.ts`): the web
 * view keeps the whole screen and the keyboard is drawn *over* it, so nothing in
 * the page moves and nothing in the page knows the bottom half is gone. In
 * landscape that bottom half is most of the screen, which is what buries the name
 * field the moment it is tapped. This is the number that lets the menu lift the
 * focused field into the strip that is still visible.
 *
 * Two sources, because the plugin only exists inside the shell: Capacitor's
 * keyboard events natively, and `visualViewport` in a browser (0 on a desktop
 * one, which is the whole of the desktop story). Neither exists under jsdom, so
 * the hook reports 0 in tests and the menu lays out exactly as it did before.
 */
import { useEffect, useState } from "react";
import { Keyboard } from "@capacitor/keyboard";
import { isNative } from "../native";

/** Live height of the on-screen keyboard; 0 whenever it is closed or unknown. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (isNative()) {
      const shown = Keyboard.addListener("keyboardWillShow", (info) => {
        setInset(info.keyboardHeight);
      });
      const hidden = Keyboard.addListener("keyboardWillHide", () => setInset(0));
      // A shell without the plugin costs the lift, not a crash.
      void shown.catch(() => {});
      void hidden.catch(() => {});
      return () => {
        void shown.then((listener) => listener.remove()).catch(() => {});
        void hidden.then((listener) => listener.remove()).catch(() => {});
      };
    }

    const viewport = globalThis.visualViewport;
    if (viewport === undefined || viewport === null) return;
    const update = () => {
      // What the layout viewport has that the visual one does not, below the
      // fold: the software keyboard, on the browsers that shrink for it.
      const covered = globalThis.innerHeight - viewport.height - viewport.offsetTop;
      setInset(covered > 1 ? covered : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
