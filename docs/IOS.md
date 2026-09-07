# The iOS app

The same web client, wrapped in a WKWebView by [Capacitor](https://capacitorjs.com)
and pointed at the deployed server. There is no offline mode and no native game
logic: the server is authoritative (§14), so the app is a shell around the same
bundle `npm run build` produces for the web.

Distribution is sideloading — the author and a handful of friends, installed
from Xcode or a free provisioning profile. There is no App Store submission, and
nothing here is set up for one.

## Prerequisites

- A Mac with **Xcode** installed, plus its command-line tools
  (`xcode-select --install`).
- **CocoaPods** (`brew install cocoapods`). `cap sync` runs `pod install`.
- An Apple ID. A free one is enough to sideload; apps signed with it expire
  after **7 days** and need a re-install from Xcode. A paid Developer account
  ($99/yr) raises that to a year, which is the difference between "re-install
  every week" and "forget about it".

## 1. Point the app at the server

The web client talks to its own origin and needs no configuration (§14). The app
cannot: its pages come from `capacitor://localhost`, so it has to be told where
the server is.

```bash
cp packages/client/.env.native.example packages/client/.env.native
```

Set `VITE_SERVER_URL` to the deployed service's origin — the same URL you'd open
in a browser to play (`gcloud run services describe daifugo --region "$REGION"
--format='value(status.url)'`). It must be `https://`: iOS App Transport Security
blocks cleartext, so an `http://` origin fails on the device with no useful
error. `.env.native` is gitignored; `npm run ios:build` refuses to run without it
rather than shipping an app that cannot reach anything.

Both values are baked into the bundle at build time. Change the server URL and
you have to rebuild and re-sync.

## 2. Create the Xcode project

Once, ever:

```bash
npm run ios:add
```

That builds the client and generates `packages/client/ios/`. **Commit it** — the
`Info.plist` edits in step 3 live there, and regenerating the project would lose
them.

## 3. Info.plist

Open `packages/client/ios/App/App/Info.plist` and set these. They are the ones
that are easy to miss and annoying to diagnose from a black screen on a phone:

```xml
<!-- Landscape only (§0). With this set, the OrientationGate rotate prompt is
     web-only: the app can never be in portrait to show it. -->
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationLandscapeLeft</string>
  <string>UIInterfaceOrientationLandscapeRight</string>
</array>

<!-- The table is the whole screen; the clock and battery are not part of it. -->
<key>UIStatusBarHidden</key>
<true/>
<key>UIViewControllerBasedStatusBarAppearance</key>
<false/>

<!-- No home-indicator bar sitting over the hand fan until it's tapped. -->
<key>UIRequiresFullScreen</key>
<true/>
```

Also set the display name to `Daifugo` (`CFBundleDisplayName`) if `cap add`
did not.

## 4. Build and run

```bash
npm run ios:build   # build the client, then `cap sync ios`
npm run ios:open    # open the workspace in Xcode
```

In Xcode: select the `App` target → _Signing & Capabilities_ → check _Automatically
manage signing_ and pick your Apple ID team. The bundle identifier
(`org.ccrawford.daifugo`, set in `capacitor.config.ts`) has to be unique to your
account; change it if Xcode complains it is taken. Then pick a connected device
and hit run.

On the phone, the first launch of a free-provisioned app needs
_Settings → General → VPN & Device Management → trust the developer_.

Re-run `npm run ios:build` after any client change, then hit run in Xcode again.

## Live reload against a local server

For iterating on the client without a deploy, point the app at the Vite dev
server instead of the bundle. Add to `capacitor.config.ts`, temporarily:

```ts
server: { url: "http://192.168.1.x:5173", cleartext: true },
```

with your Mac's LAN address, set `VITE_SERVER_URL` to `http://192.168.1.x:4000`,
run `npm run dev`, and `npm run ios:build`. `cleartext: true` is what gets past
App Transport Security for the LAN address. Take both back out before building
anything you intend to install for more than an afternoon.

Use the Mac's LAN address or its `.local` name, not `localhost`: on a physical
phone `localhost` is the phone. The env check accepts loopback, the private
ranges and `.local`, and rejects only cleartext to the public internet, which ATS
would block whatever the app config says.

## What the native build changes in the client

Everything below is a no-op on the web, which keeps exactly the behaviour it had.

- **`src/serverUrl.ts`** — the only build-time configuration. On the web it
  resolves to the origin-relative calls the client has always made; in the app it
  resolves to `VITE_SERVER_URL`. It also builds the lobby's invite link, since
  `capacitor://localhost/ABC` is not a link anyone else can open.
- **`src/storage.ts`** — `localStorage` stays the source of truth, but on iOS the
  four persisted keys are mirrored into `NSUserDefaults` via
  `@capacitor/preferences` and read back at boot. WKWebView site data can be
  evicted by iOS under storage pressure, and losing the resume token mid-match
  means the seat cannot be reclaimed at all (§8.1).
- **`src/native.ts`** — reconnects the socket when the app returns to the
  foreground, and delivers tapped invite links (see "Universal links" below).
  iOS suspends the WebView on background, which freezes Socket.IO's reconnect
  backoff along with everything else.
- **`src/styles.css`** — `body` is inset by `env(safe-area-inset-*)`, so the notch
  cutout does not sit over the left rail in landscape.
- **`packages/server/src/app.ts`** — echoes `Access-Control-Allow-Origin` for the
  two Capacitor origins, which `POST /rooms` needs. The socket needs no
  equivalent: this server is WebSocket-only, and a WebSocket upgrade is not a
  CORS request.

## Universal links

A tapped `https://daifugo.wecraw.com/ABC` opens the app straight into room ABC
when it is installed, and the web client when it is not. Three pieces, all of
which have to agree or the link silently stays a web link:

- **The server** answers `/.well-known/apple-app-site-association` with JSON
  naming `2FVQPZ94T9.org.ccrawford.daifugo` and the path pattern `/???` — three
  characters, so the room code and nothing else (`packages/server/src/app.ts`).
  The bare origin is deliberately not claimed: "come play" should open the site.
- **The app** claims that domain back, in
  `ios/App/App/App.entitlements` (`applinks:daifugo.wecraw.com`), wired in as
  `CODE_SIGN_ENTITLEMENTS` on both build configurations. Xcode adds the
  Associated Domains capability to the App ID when it signs with it.
- **The client** joins on the URL rather than navigating to it: iOS hands a
  universal link to the running app without touching the web view, so `native.ts`
  reads the code out of `appUrlOpen` and the provider joins it exactly as it
  would a load on `/ABC` (`SocketContext.tsx`).

Set `VITE_PUBLIC_WEB_URL=https://daifugo.wecraw.com` in `.env.native`. The
lobby's invite link defaults to `VITE_SERVER_URL`, and a `run.app` link is not
one the entitlement claims — the app would share a link that does not open the
app.

Two things worth knowing when it does not work:

- **iOS fetches the association file at install time**, through Apple's CDN. A
  change to it needs the app re-installed, and the domain has to serve it over
  HTTPS with no redirect. `curl -sI https://daifugo.wecraw.com/.well-known/apple-app-site-association`
  should be a 200 of `application/json`.
- **A link typed into Safari's address bar never opens an app** — only a tapped
  link does, and long-pressing one offers "Open in Daifugo" when the association
  is live. Swiping down on the banner after opening a link in Safari once tells
  iOS to keep using Safari for that domain; reinstalling the app resets it.

## What is deliberately not here

- **Push notifications, App Store metadata, launch screens beyond the default,
  an Android target.** None of it is wanted; ask before adding any of it.
