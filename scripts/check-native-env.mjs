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
if (value.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(value)) {
  // iOS App Transport Security blocks cleartext to anything but the loopback
  // exception a dev build gets; a non-local http:// origin fails on the device.
  fail(`VITE_SERVER_URL must be https:// unless it is localhost; got "${value}".`);
}

console.log(`check-native-env: building against ${value}`);
