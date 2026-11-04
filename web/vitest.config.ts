/** Testes de unidade do InfraWork Web (arquivos .test.ts em src). A suíte do motor do ApeX tem config própria (vendor/apex). */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { APEX_ALIASES } from './vendor/apex/aliases'

export default defineConfig({
  resolve: {
    alias: { ...APEX_ALIASES, '@renderer': resolve(__dirname, 'src'), '@': resolve(__dirname, 'src') }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000
  }
})
