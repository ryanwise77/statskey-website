import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Mirror production Vercel rewrites for extension-less paths during `vite dev`
// so the embedded bid viewer iframe and clean URLs behave the same locally.
const DEV_REWRITES = {
  '/web-terms': '/web-terms.html',
  '/cbm': '/cbm.html',
  '/cbm/': '/cbm/index.html',
  '/ckm': '/ckm.html',
  '/ckm/': '/ckm/index.html',
  '/ckm/viewer': '/ckm/viewer/index.html',
  '/ckm/viewer/': '/ckm/viewer/index.html',
  '/cpm': '/cpm.html',
  '/cpm/': '/ckm/index.html',
  '/cpm/viewer': '/ckm/viewer/index.html',
  '/cpm/viewer/': '/ckm/viewer/index.html',
  '/hospital-ckm': '/hospital-ckm.html',
  '/hospital-ckm/': '/hospital-ckm/index.html',
  '/hospital-ckm/procurement': '/hospital-ckm/procurement/index.html',
  '/hospital-ckm/procurement/': '/hospital-ckm/procurement/index.html',
  '/hospital-ckm/viewer': '/hospital-ckm/viewer/index.html',
  '/hospital-ckm/viewer/': '/hospital-ckm/viewer/index.html',
  '/urine-aki': '/urine-aki.html',
  '/urine-aki/': '/urine-aki/index.html',
  '/urine-aki/viewer': '/urine-aki/viewer/index.html',
  '/urine-aki/viewer/': '/urine-aki/viewer/index.html',
  '/urine-aki/app': '/urine-aki/app/index.html',
  '/urine-aki/app/': '/urine-aki/app/index.html',
  '/prototype': '/prototype.html',
  '/prototype/': '/prototype/index.html',
  '/nike-statskey-presentation': '/nike-run-club/index.html',
  '/nike-statskey-presentation.html': '/nike-run-club/index.html',
  '/nike-run-club': '/nike-run-club/index.html',
  '/nike-run-club/': '/nike-run-club/index.html',
  '/bid/alaska-dotpf': '/bid/alaska-dotpf.html',
  '/bid/3d/viewer': '/bid/3d/viewer.html',
}

function devRewritePlugin() {
  return {
    name: 'statskey-dev-rewrites',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next()
        const [path, qs] = req.url.split('?')
        const target = DEV_REWRITES[path]
        if (target) {
          req.url = qs ? `${target}?${qs}` : target
        } else if (path === '/app' || path.startsWith('/app/')) {
          req.url = qs ? `/app.html?${qs}` : '/app.html'
        }
        next()
      })
    },
  }
}

export default {
  plugins: [tailwindcss(), react(), devRewritePlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        webTerms: resolve(__dirname, 'web-terms.html'),
        support: resolve(__dirname, 'support.html'),
        nikeRunClub: resolve(__dirname, 'nike-statskey-presentation.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
  server: {
    // When running `vite dev`, the React app is reached at /app.html.
    // In production Vercel rewrites `/app/*` -> `/app.html` (see vercel.json).
  },
}
