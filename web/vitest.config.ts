/** Testes de unidade do InfraWork Web (src) e do MCP (mcp). A suíte do motor do ApeX tem config própria (vendor/apex). */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { APEX_ALIASES } from './vendor/apex/aliases'

export default defineConfig({
  resolve: {
    alias: {
      ...APEX_ALIASES,
      '@': resolve(__dirname, 'src')
    }
  },
  assetsInclude: ['**/*.dr5'],
  test: {
    include: ['src/**/*.test.ts', 'mcp/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000
  }
})
