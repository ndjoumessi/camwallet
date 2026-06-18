import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, Vite sert l'app React sur « / » par défaut. En production (vercel.json),
// « / » et « /operateurs » servent la landing opérateurs (index-operateurs.html) et
// le dashboard est sous « /admin ». Ce plugin reproduit ce routage en local : il
// réécrit « / » et « /operateurs » vers le fichier public index-operateurs.html.
// (Pas de copie du HTML : source unique, jamais désynchronisée avec la prod.)
function serveLandingInDev(): Plugin {
  return {
    name: 'camwallet-serve-landing',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path === '/' || path === '/operateurs' || path === '/operateurs/') {
          req.url = '/index-operateurs.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [serveLandingInDev(), react()],
  server: { port: 3001 },
  build: {
    rollupOptions: {
      output: {
        // Découpe les grosses dépendances en chunks séparés : meilleur cache (elles
        // changent rarement) et chargement parallèle au lieu d'un seul bundle ~1.7 Mo.
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['recharts'],
          pdf: ['jspdf', 'jspdf-autotable', 'html2canvas'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
