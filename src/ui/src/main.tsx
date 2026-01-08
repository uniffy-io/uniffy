import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AuthForms from './AuthForms.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthForms />
  </StrictMode>,
)
