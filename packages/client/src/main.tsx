import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { hydrateStorage, needsHydration } from "./storage";
import "./styles.css";

const found = document.getElementById("root");
if (!found) {
  throw new Error("root element not found");
}
const container: HTMLElement = found;

function render(): void {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// The seat is read synchronously at first render (§8.1), so on iOS the native
// mirror has to be back in `localStorage` before that happens — see `storage.ts`.
// The web has no mirror and renders on the same tick it always did.
if (needsHydration()) {
  void hydrateStorage().finally(render);
} else {
  render();
}
