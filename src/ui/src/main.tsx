// Must run before any module that constructs zod schemas - zod captures the
// jitless flag at schema construction time.
import "@/config/zodConfig";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
// Self-hosted fonts (public/fonts) so the app never reaches out to
// fonts.googleapis.com / fonts.gstatic.com at runtime.
import "./fonts.css";
import "./index.css";
import { App } from "@/App";
import { store, persistor } from "@/app/store";
import { ThemeProvider } from "@/config/theme/ThemeProvider";
import { installAssetAuthErrorHandler } from "@/shared/utils/assetAuthRetry";

// Authenticated assets now ride the asset cookie, not a service-worker Bearer proxy. Unregister the
// stale media-stream worker a previous build installed so it stops intercepting - but leave the
// notification worker (registered on demand by push opt-in) alone.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const reg of regs) {
        const scriptURL =
          reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || "";
        if (scriptURL.includes("media-stream-worker")) {
          reg.unregister();
        }
      }
    })
    .catch(() => undefined);
}
installAssetAuthErrorHandler();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </PersistGate>
    </Provider>
  </StrictMode>,
);
