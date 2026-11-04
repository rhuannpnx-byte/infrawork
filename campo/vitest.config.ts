import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Testes do app de campo: lógica pura e filas offline (Dexie sobre fake-indexeddb), sem o plugin do PWA.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('teste') },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
