import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Global styles
const style = document.createElement('style')
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0F1E; color: #EEF2FF; font-family: 'Inter', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #111827; }
  ::-webkit-scrollbar-thumb { background: #1E2D45; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #00C896; }
  button { font-family: inherit; }
  input { font-family: inherit; }
  select { font-family: inherit; }
`
document.head.appendChild(style)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
