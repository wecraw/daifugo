# Running Daifugo locally — first-time guide

You've verified core, server, and client independently. This is what it looks
like to actually run the whole stack and play a hand.

## 1. One-time prerequisite: Java 21+

`npm run dev` wraps the stack in the Firestore emulator via `firebase-tools`,
and modern `firebase-tools` requires **Java 21 or newer** to run that
emulator. If your Mac's default `java` is older (Java 8 is common if you've
never needed a newer JDK), `npm run dev` will fail immediately with:

```
Error: firebase-tools no longer supports Java version before 21. Please install a JDK at version 21 or above to get a compatible runtime.
```

Check what you have:

```bash
java -version
```

If it's Java 8, install a modern JDK. Homebrew's `openjdk` works and doesn't
require admin/`brew link` to use once-off:

```bash
brew install openjdk
```

Then either prepend it to `PATH` for the session:

```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
```

or run `sudo ln -sfn /opt/homebrew/opt/openjdk/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk.jdk` once so `/usr/libexec/java_home` finds it permanently (that one needs your password, so it's your call, not something to script blindly).

This is a one-time environment fix, not a project bug — nothing else about the
stack needs Java, only the local Firestore emulator.

## 2. Install and run

```bash
npm install
npm run dev
```

This single command:
- builds `@daifugo/core`,
- starts the **Firestore emulator** on `:8080` (first run downloads the
  emulator jar — a few seconds one-time cost),
- starts the **Fastify + Socket.IO server** on `:4000`,
- starts the **Vite client** on `:5173`.

Wait for this line before opening the browser — it means the server has
finished re-arming any pending room deadlines and is actually listening:

```
daifugo server listening at http://127.0.0.1:4000
```

Open **http://localhost:5173**. Vite proxies `/socket.io` and `/rooms`
through to `:4000` automatically, so you never touch `:4000` or `:8080`
directly.

To stop everything, `Ctrl-C` the `npm run dev` process — it kills the
emulator, server, and client together (`concurrently -k`).

## 3. Playing — what to expect

**The app is landscape-only.** On a normal desktop browser window this is a
non-issue, but if you shrink the window into a portrait aspect ratio (or open
it on a phone held upright) you'll get a "Rotate your device" screen instead
of the game. Widen the window if you see that.

**Landing page**: enter a name, then either
- **Create room** — mints a room code (e.g. `TKP6YQ`) and seats you as host, or
- **Join room** — enter a name plus an existing room code.

**Lobby**: shows the roster, a "House rules" panel (Spade-3-beats-joker,
Five Skip, Seven Pass, Eight Cutter, Nine Cutter, Ten Discard, Jack Reversal,
Revolution, Suit Lock, and a round-limit toggle — all off/default until the
host changes them), and a **Ready up** button for everyone except the host.
The host's **Start match** button is disabled until there are at least 3
players and nobody is still unready — the game needs 3–8 players (§4).

**Testing multiplayer solo, in one browser**: don't just open multiple tabs
of the same browser to simulate several players. The client persists your
seat (`resumeToken`) under a single shared `localStorage` key
(`daifugo.session`) so a page reload can silently rejoin you — that's
intentional (§8.1, so a crash or refresh mid-match doesn't lose your seat).
But because `localStorage` is shared across all tabs of the same origin, a
second tab that joins the same room will just rejoin your *own* seat instead
of taking a new one, and clearing storage in one tab clears it for all of
them, corrupting resume tokens for others. Instead, use **separate browser
profiles or private/incognito windows** (or genuinely separate machines) —
one per simulated player — so each has independent storage. That's also just
what real players do, since everyone connects from their own device/browser
in the actual use case.

## 4. Known gotchas seen while verifying this

- If you kill and restart `npm run dev` while a browser tab from the old run
  is still open, Vite's HMR socket briefly reconnects/reloads the page —
  don't be alarmed if a form you were mid-typing resets once right after a
  restart.
- The Firestore emulator's first boot downloads a ~70MB jar; subsequent
  starts are instant.
