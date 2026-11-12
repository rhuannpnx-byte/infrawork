import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) return arquivos(p)
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [p] : []
  })
}

describe('ícones pelo nome', () => {
  it('todo nome de ícone usado no menu e nos estados vazios está no mapa', () => {
    const mapa = readFileSync(join(SRC, 'components/layout/IconRenderer.tsx'), 'utf-8')
    const conhecidos = new Set([...mapa.matchAll(/^\s+'?([a-z0-9-]+)'?: [A-Z]/gm)].map((m) => m[1]))
    const usados = new Set<string>()
    for (const p of arquivos(SRC)) {
      const texto = readFileSync(p, 'utf-8')
      for (const m of texto.matchAll(/\bicon(?::| = |=)\s*["']([a-z0-9-]+)["']/g)) usados.add(m[1])
      for (const m of texto.matchAll(/\bicon \?\? '([a-z0-9-]+)'/g)) usados.add(m[1])
    }
    expect(usados.size).toBeGreaterThan(20)
    expect([...usados].filter((n) => !conhecidos.has(n))).toEqual([])
  })
})
