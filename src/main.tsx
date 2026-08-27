import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FeederStoreProvider } from "./state/feeder-context";
import "./styles.css";

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Floyd Feeder root element is missing");
}
createRoot(root).render(
  <StrictMode>
    <FeederStoreProvider>
      <App />
    </FeederStoreProvider>
  </StrictMode>,
);
