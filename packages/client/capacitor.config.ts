import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * The iOS shell (§0, §14).
 *
 * The app is the same web client in a WKWebView, pointed at the deployed Cloud
 * Run service — there is no offline mode and no native game logic, because the
 * server is authoritative. `webDir` is Vite's output, so `npm run build:ios`
 * builds the client and then `cap sync` copies `dist` into the Xcode project.
 *
 * Distribution is sideloading for the author and a handful of friends, so there
 * is no App Store configuration here and none is coming.
 */
const config: CapacitorConfig = {
  appId: "org.ccrawford.daifugo",
  appName: "Daifugo",
  webDir: "dist",
  ios: {
    // The table is a fixed viewport that never scrolls (§0). This turns off
    // WKWebView's rubber-banding, which would otherwise let a drag on the felt
    // peel the whole app away from the top of the screen — the one bounce the
    // CSS and `useNativeGestureGuard` cannot reach, because it belongs to the
    // scroll view around the web view rather than to the page.
    scrollEnabled: false,
    // The page handles its own safe areas (`styles.css` insets `body` from
    // `env(safe-area-inset-*)`), so the web view must not also inset itself, or
    // the notch strip gets taken out twice.
    contentInset: "never",
    // Anything but white flashes on launch and on rotation; this is the felt.
    backgroundColor: "#0a3b25",
  },
  plugins: {
    Keyboard: {
      // `none`, not `native`: resizing the web view when the keyboard opens for
      // the name or room-code field would re-lay-out the whole fixed table
      // underneath it and then snap it back. The fields sit high enough in the
      // landscape layout to stay visible above the keyboard as they are.
      resize: KeyboardResize.None,
    },
  },
};

export default config;
