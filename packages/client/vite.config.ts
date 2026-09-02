import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The client is served as static assets off the same Cloud Run service as the
 * server (§14), so there is no `VITE_SERVER_URL` and no per-environment config:
 * the socket connects to the page's own origin. These proxies make dev take that
 * same code path — `/socket.io` for the WebSocket and `/rooms` for room creation
 * (§8) both land on the server at :4000.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true,
      },
      "/rooms": {
        target: "http://localhost:4000",
      },
    },
  },
});
