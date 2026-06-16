import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'

// Global styles
const style = document.createElement('style')
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0F1E; color: #EEF2FF; font-family: 'Inter', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #111827; }
  ::-webkit-scrollbar-thumb { background: #1E2D45; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #00C896; }
  button { font-family: inherit; }
  input { font-family: inherit; }
  select { font-family: inherit; }

  /* ── Accessibilité : focus clavier visible partout ────────── */
  a:focus-visible, button:focus-visible, input:focus-visible,
  select:focus-visible, [tabindex]:focus-visible, .cw-row:focus-visible {
    outline: 2px solid #00C896 !important;
    outline-offset: 2px;
    border-radius: 8px;
  }
  input:focus, select:focus { border-color: #00C896 !important; }

  /* ── États interactifs (hover / active) ───────────────────── */
  .cw-btn { transition: filter .15s ease, transform .15s ease, background .15s ease, border-color .15s ease; }
  .cw-btn:hover { filter: brightness(1.14); }
  .cw-btn:active { transform: scale(.97); }
  .cw-btn:disabled { filter: none; cursor: not-allowed; opacity: .55; }

  .cw-chip { transition: background .15s ease, border-color .15s ease, color .15s ease; }
  .cw-chip:hover { border-color: #00C896 !important; color: #EEF2FF !important; }

  .cw-iconbtn { transition: background .15s ease, color .15s ease; }
  .cw-iconbtn:hover { background: #1E2D45 !important; color: #EEF2FF !important; }

  .cw-link { transition: color .15s ease; }
  .cw-link:hover { text-decoration: underline; }

  .cw-nav-btn { transition: background .15s ease, color .15s ease; }
  .cw-nav-btn:hover { background: #1C2540 !important; color: #EEF2FF !important; }

  .cw-row { transition: background .12s ease; }
  .cw-row:hover { background: #1C2540 !important; }

  .cw-card { transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
  .cw-card:hover { transform: translateY(-2px); border-color: #00C89655 !important; box-shadow: 0 8px 24px -12px #00C89640; }

  .cw-tablewrap { overflow-x: auto; }

  /* ── Animations ───────────────────────────────────────────── */
  @keyframes cw-fadeup { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cw-trend-up { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
  @keyframes cw-trend-down { 0%,100% { transform: translateY(0); } 50% { transform: translateY(2px); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  @keyframes cw-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .cw-trend-up { animation: cw-trend-up 1.6s ease-in-out infinite; }
  .cw-trend-down { animation: cw-trend-down 1.6s ease-in-out infinite; }
  .cw-toast { animation: cw-fadeup .22s ease-out; }
  .cw-spin { animation: cw-spin 0.7s linear infinite; }
  @media (prefers-reduced-motion: reduce) {
    .cw-trend-up, .cw-trend-down, .cw-toast, .cw-live-dot { animation: none !important; }
    .cw-card, .cw-btn { transition: none !important; }
    .cw-spin { animation: none !important; opacity: 0.5; }
  }

  /* ── Responsive : rail latéral compact puis masqué ────────── */
  @media (max-width: 1024px) {
    .cw-sidebar { width: 66px !important; }
    .cw-compact-hide { display: none !important; }
    .cw-nav-btn { justify-content: center !important; }
    .cw-navlabel { display: none !important; }
    .cw-nav-badge { display: none !important; }
  }
  @media (max-width: 680px) {
    .cw-page { padding: 16px !important; }
    .cw-topbar-label { display: none !important; }
  }
`
document.head.appendChild(style)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
