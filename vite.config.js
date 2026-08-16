import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function desktopBuildInputs(desktopOnly) {
  return desktopOnly
  ? {
      desktopApp: resolve(__dirname, 'desktop-app.html'),
    }
  : {
      main: resolve(__dirname, 'index.html'),
      privacy: resolve(__dirname, 'privacy.html'),
      terms: resolve(__dirname, 'terms.html'),
      webTerms: resolve(__dirname, 'web-terms.html'),
      support: resolve(__dirname, 'support.html'),
      dietitians: resolve(__dirname, 'for-dietitians.html'),
      clinicians: resolve(__dirname, 'for-clinicians.html'),
      join: resolve(__dirname, 'join.html'),
      wellness: resolve(__dirname, 'wellness.html'),
      nikeRunClub: resolve(__dirname, 'nike-statskey-presentation.html'),
      app: resolve(__dirname, 'app.html'),
      clinician: resolve(__dirname, 'clinician.html'),
      desktopApp: resolve(__dirname, 'desktop-app.html'),
    }
}

// Mirror production Vercel rewrites for extension-less paths during `vite dev`
// so the embedded bid viewer iframe and clean URLs behave the same locally.
const DEV_REWRITES = {
  '/web-terms': '/web-terms.html',
  '/join': '/join.html',
  '/join/': '/join.html',
  '/wellness': '/wellness.html',
  '/wellness/': '/wellness.html',
  '/cbm': '/cbm.html',
  '/cbm/': '/cbm/index.html',
  '/cbm/viewer': '/cbm/viewer/index.html',
  '/cbm/viewer/': '/cbm/viewer/index.html',
  '/cbm/procurement': '/cbm/procurement/index.html',
  '/cbm/procurement/': '/cbm/procurement/index.html',
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
  '/mindscape': '/mindscape/index.html',
  '/mindscape/': '/mindscape/index.html',
  '/bid/alaska-dotpf': '/bid/alaska-dotpf.html',
  '/bid/3d/viewer': '/bid/3d/viewer.html',
  '/energy': '/energy.html',
  '/energy/': '/energy.html',
  '/glucose-plan': '/glucose-plan/index.html',
  '/glucose-plan/': '/glucose-plan/index.html',
  '/for-clinicians': '/for-clinicians.html',
  '/for-clinicians/': '/for-clinicians.html',
  '/hardware': '/index.html',
  '/hardware/': '/index.html',
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
        } else if (path === '/clinician' || path.startsWith('/clinician/')) {
          req.url = qs ? `/clinician.html?${qs}` : '/clinician.html'
        } else if (path === '/app' || path.startsWith('/app/')) {
          req.url = qs ? `/app.html?${qs}` : '/app.html'
        }
        next()
      })
    },
  }
}

export default ({ mode }) => {
  // Vite's explicit mode is shell-independent. Keep the environment check for
  // backwards compatibility with existing local release commands.
  const desktopOnly =
    mode === 'desktop' ||
    process.env.STATSKEY_DESKTOP_BUILD === '1'
  return {
    plugins: [tailwindcss(), react(), devRewritePlugin()],
    build: {
      minify: desktopOnly ? false : undefined,
      cssMinify: desktopOnly ? false : undefined,
      reportCompressedSize: !desktopOnly,
      rollupOptions: {
        input: desktopBuildInputs(desktopOnly),
        // The desktop graph includes Monaco's language workers and several large
        // lazy routes. Keep release builds from competing for tens of gigabytes
        // of memory when other desktop development tools are open.
        maxParallelFileOps: desktopOnly ? 2 : undefined,
      },
    },
    server: {
      // When running `vite dev`, the React app is reached at /app.html.
      // In production Vercel rewrites `/app/*` -> `/app.html` (see vercel.json).
    },
  }
}
