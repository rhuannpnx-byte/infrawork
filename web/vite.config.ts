import { resolve } from 'node:path'
import { cpSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APEX_ALIASES } from './vendor/apex/aliases'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

const TIPOS: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml'
}

/**
 * Operários, texturas e dados do Cesium (cena do Acompanhamento 4D), servidos pelo próprio site em `/cesium`:
 * no desenvolvimento saem direto de `node_modules`; no build são copiados para a pasta publicada.
 */
function cesiumEstatico(): Plugin {
  const origem = resolve(__dirname, 'node_modules/@cesium/engine/Build')
  let saida: string | null = null
  return {
    name: 'cesium-estatico',
    configResolved(c) {
      saida = c.command === 'build' ? resolve(c.root, c.build.outDir) : null
    },
    configureServer(server) {
      server.middlewares.use('/cesium', (req, res, next) => {
        const arquivo = resolve(origem, `.${decodeURIComponent((req.url ?? '/').split('?')[0])}`)
        if (!arquivo.startsWith(origem) || !existsSync(arquivo) || !statSync(arquivo).isFile())
          return next()
        const ext = arquivo.slice(arquivo.lastIndexOf('.'))
        res.setHeader('Content-Type', TIPOS[ext] ?? 'application/octet-stream')
        createReadStream(arquivo).pipe(res)
      })
    },
    closeBundle() {
      if (saida && existsSync(saida)) cpSync(origem, resolve(saida, 'cesium'), { recursive: true })
    }
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), cesiumEstatico()],
  // cache de deps separado por modo: dois dev servers (local e remoto) não invalidam um ao outro
  cacheDir: mode === 'remote' ? 'node_modules/.vite-remote' : 'node_modules/.vite',
  resolve: {
    alias: {
      ...APEX_ALIASES,
      '@': resolve(__dirname, 'src')
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  // o motor do cronograma roda num Web Worker em módulo ES (pacotes do ApeX)
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // só a própria biblioteca (e as dela) em cada pedaço: dependência comum com o resto do app não arrasta o
        // pedaço inteiro para a abertura
        manualChunks(id: string): string | undefined {
          if (/node_modules\/exceljs\//.test(id)) return 'exceljs'
          if (/node_modules\/(leaflet|supercluster|kdbush)\//.test(id)) return 'leaflet'
          if (/node_modules\/(recharts|victory-vendor|d3-[a-z-]+)\//.test(id)) return 'recharts'
          // o Cesium e o que só ele usa ficam num pedaço carregado só na página do Acompanhamento 4D
          if (
            /node_modules\/(@cesium|@spz-loader|@tweenjs|@zip\.js|@protobufjs|autolinker|bitmap-sdf|dompurify|draco3d|grapheme-splitter|jsep|ktx-parse|lerc|mersenne-twister|meshoptimizer|protobufjs|rbush|quickselect|topojson-client|urijs|earcut)\//.test(
              id
            )
          )
            return 'cesium'
          // o resto das bibliotecas e os auxiliares do CommonJS ficam num pedaço comum, carregado na abertura
          if (id.includes('node_modules') || id.startsWith(String.fromCharCode(0))) return 'vendor'
          return undefined
        }
      }
    }
  }
}))
