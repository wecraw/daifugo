/**
 * The native shell (Capacitor/iOS), and the two places the web assumptions break
 * inside it.
 *
 * On the web the client is served off the same Cloud Run origin as the server
 * (§14), which is what lets `io()` and `fetch("/rooms")` take the origin for
 * granted. Inside the iOS app there is no such origin: WKWebView serves the
 * bundle from `capacitor://localhost`, so "the page's own origin" is the app
 * itself and every server call has to name the deployed service outright. That
 * URL is baked in at build time — see `serverUrl.ts`.
 *
 * Everything here is a no-op on the web, so the browser build keeps exactly the
 * behaviour it had: `isNativePlatform()` is false, and the listener below never
 * registers.
 */
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/** True only inside the Capacitor shell; false in every browser, tests included. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Calls `onResume` when iOS brings the app back to the foreground.
 *
 * iOS suspends the WebView on background, which kills the socket without the
 * page ever seeing a `disconnect` it can act on — timers do not run while
 * suspended, so Socket.IO's own reconnect backoff is frozen along with
 * everything else and can sit idle for a while after the app is back. Poking it
 * on resume is what turns "the table is stuck" into a reconnect (§8.3).
 *
 * Returns its own unsubscribe; on the web it registers nothing and the
 * unsubscribe is a no-op.
 */
export function onAppResume(onResume: () => void): () => void {
  if (!isNative()) return () => {};
  let removed = false;
  const handle = App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) onResume();
  });
  void handle.catch(() => {
    // A shell without the App plugin costs a manual reconnect, not a crash.
  });
  return () => {
    if (removed) return;
    removed = true;
    void handle.then((listener) => listener.remove()).catch(() => {});
  };
}
