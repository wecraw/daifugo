/**
 * Refuses an iOS build that does not know where the server is.
 *
 * The web client talks to its own origin and needs no configuration (§14). The
 * iOS build cannot: its pages come from `capacitor://localhost`, so
 * `VITE_SERVER_URL` is what points it at the deployed service. Left unset, the
 * build succeeds and the app looks fine right up until the main menu, where every
 * call goes to the app bundle instead and nothing ever connects — a failure worth
 * catching here rather than on a phone.
 *
 * Values come from `packages/client/.env.native`, which is gitignored because it
 * names a deployment. `.env.native.example` is the template.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/client");
const envPath = join(clientDir, ".env.native");

function fail(message) {
  console.error(`\ncheck-native-env: ${message}\n`);
  process.exit(1);
}

if (!existsSync(envPath)) {
  fail(
    `no packages/client/.env.native.\n` +
      `  Copy packages/client/.env.native.example to .env.native and set VITE_SERVER_URL\n` +
      `  to the deployed server's origin (see docs/IOS.md).`,
  );
}

// Deliberately not a dotenv parser: this checks that a value is present and
// plausible, and Vite is what actually loads the file.
const contents = readFileSync(envPath, "utf8");
const match = /^\s*VITE_SERVER_URL\s*=\s*(.*)$/m.exec(contents);
const value = (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");

if (value === "") {
  fail(`VITE_SERVER_URL is empty in packages/client/.env.native.`);
}
if (!/^https?:\/\//.test(value)) {
  fail(`VITE_SERVER_URL must be an absolute http(s) origin; got "${value}".`);
}
if (value.startsWith("http://") && !isLocalNetwork(value)) {
  // App Transport Security blocks cleartext to the public internet outright, so
  // an `http://` origin that is not on the local network cannot work on a device
  // however the app is configured — that is a typo worth catching here.
  fail(`VITE_SERVER_URL must be https:// unless it is on the local network; got "${value}".`);
}

/**
 * Whether an origin names something on the local network, which is where the
 * live-reload workflow in docs/IOS.md points the app.
 *
 * Loopback is not sufficient on its own: on a physical phone `localhost` is the
 * phone, not the Mac serving the build, so the addresses that workflow actually
 * uses are the Mac's LAN address or its `.local` name. Cleartext to those is
 * reachable — the doc has you set Capacitor's `cleartext: true`, and ATS treats
 * local networking separately from the public internet — so they belong on this
 * side of the check rather than being rejected before the build starts.
 */
function isLocalNetwork(origin) {
  const host = origin
    .slice("http://".length)
    .split(/[:/?#]/)[0]
    .toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]") return true;
  if (host.endsWith(".local")) return true; // mDNS, e.g. someones-mac.local
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets === null) return false;
  const [a, b] = octets.slice(1, 3).map(Number);
  return (
    a === 127 || // loopback
    a === 10 || // RFC1918
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 169 && b === 254) // link-local
  );
}

console.log(`check-native-env: building against ${value}`);
