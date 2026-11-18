import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { APEX_ALIASES } from './vendor/apex/aliases'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
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
          // o resto das bibliotecas e os auxiliares do CommonJS ficam num pedaço comum, carregado na abertura
          if (id.includes('node_modules') || id.startsWith(String.fromCharCode(0))) return 'vendor'
          return undefined
        }
      }
    }
  }
}))
