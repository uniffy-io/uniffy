import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
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
