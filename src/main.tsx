import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, loadThemeId } from './theme/themes'
import './index.css'

/* Before the first paint, not in an effect: applying the palette after mount
 * shows the default theme for a frame and then swaps it. */
applyTheme(loadThemeId())

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
