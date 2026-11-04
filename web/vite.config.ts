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
      '@renderer': resolve(__dirname, 'src'),
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
        manualChunks: {
          exceljs: ['exceljs'],
          leaflet: ['leaflet', 'supercluster'],
          recharts: ['recharts']
        }
      }
    }
  }
}))
