// Must run before any module that constructs zod schemas - zod captures the
// jitless flag at schema construction time.
import '@/config/zodConfig'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
// Self-hosted fonts. Variable woff2s ship as part of the bundle so the app
// never reaches out to fonts.googleapis.com / fonts.gstatic.com at runtime.
// Explicit `/index.css` paths because the packages publish only CSS (no
// `.d.ts`), so a bare specifier confuses tsc.
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/geist/index.css'
import './index.css'
import { App } from '@/App'
import { store, persistor } from '@/app/store'
import { ThemeProvider } from '@/config/theme/ThemeProvider'
import { registerMediaStreamWorker } from '@/workers/registerMediaWorker'

// Register the media stream service worker for file viewing
registerMediaStreamWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </PersistGate>
    </Provider>
  </StrictMode>,
)
