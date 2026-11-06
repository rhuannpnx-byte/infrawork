import './styles/globals.css'
import './app/OAuthConsentimento'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from './app/Providers'
import { bootTabsFromUrl } from './app/url-sync'
// Deep link / F5: abre a aba do módulo apontado pela URL antes do primeiro render.
bootTabsFromUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>
)
