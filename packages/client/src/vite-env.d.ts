/// <reference types="vite/client" />

/**
 * The two build-time variables the native build sets (`serverUrl.ts`). Both are
 * absent in the web build, where the client talks to its own origin (§14).
 */
interface ImportMetaEnv {
  /** The deployed server's origin, e.g. `https://daifugo.example.run.app`. */
  readonly VITE_SERVER_URL?: string;
  /** Where the web client is reachable, for invite links. Defaults to the above. */
  readonly VITE_PUBLIC_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
