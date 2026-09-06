import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/silkscreen'
import '@fontsource/vt323'
import './styles.css'
import { App } from './App'
import { connect } from './state/store'

connect()
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
