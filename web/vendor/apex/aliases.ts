/** Aliases `@apex/*` → pacotes do ApeX copiados em `vendor/apex/packages` (usados pelo Vite e pelo Vitest). */
import { resolve } from 'node:path'

const P = (pkg: string): string => resolve(__dirname, 'packages', pkg, 'src', 'index.ts')

export const APEX_ALIASES: Record<string, string> = {
  '@apex/dr5': P('dr5'),
  '@apex/model': P('model'),
  '@apex/calendar': P('calendar'),
  '@apex/lp': P('lp'),
  '@apex/engine': P('engine'),
  '@apex/mcp': P('mcp-obra'),
  '@apex/obra': P('obra')
}
