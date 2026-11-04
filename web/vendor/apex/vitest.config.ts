/**
 * Suíte do ApeX sobre o motor copiado (fase F0 do plano do cronograma): mesmos testes de `dr5`, `model`, `calendar`,
 * `engine` e `lp` do repositório de origem. Com `APEX_ORACLES` apontando para os 27 `.dr5` do DynaRoad, os testes de
 * oráculo também rodam. Execução: `npm run test:apex`.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { APEX_ALIASES } from './aliases'

export default defineConfig({
  root: __dirname,
  // nos testes o `@apex/lp` é o original, com o HiGHS (o app usa a cópia sem solver: transportes fora do escopo)
  resolve: { alias: { ...APEX_ALIASES, '@apex/lp': resolve(__dirname, 'test-support', 'lp-original.ts') } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // fora: os testes do lp exercitam a cópia sem solver; robustez.test.ts usa a CLI do ApeX, que não foi copiada
    exclude: ['packages/lp/test/**', 'packages/dr5/test/robustez.test.ts'],
    testTimeout: 60000,
    setupFiles: ['tools/vitest/yield.ts'],
    env: { APEX_LOCALE: 'en-US' },
    maxWorkers: 4,
    minWorkers: 1
  }
})
