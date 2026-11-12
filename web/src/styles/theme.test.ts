import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')
const tema = readFileSync(join(RAIZ, 'src/styles/theme.css'), 'utf-8')

function bloco(seletor: string): string {
  const ini = tema.indexOf(seletor)
  return tema.slice(ini, tema.indexOf('\n}', ini))
}
const definidas = (css: string): Set<string> =>
  new Set([...css.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((m) => m[1]))

const claro = definidas(bloco(':root {'))
const escuro = definidas(bloco(":root[data-theme='dark'] {"))

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) return arquivos(p)
    return /\.(tsx?|css)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [p] : []
  })
}

describe('tokens do tema', () => {
  it('toda variável usada no código existe no tema', () => {
    const faltando = new Set<string>()
    const fontes = [
      ...arquivos(join(RAIZ, 'src')).filter((p) => !p.endsWith('login-wallpaper.css')),
      join(RAIZ, 'tailwind.config.js')
    ]
    for (const p of fontes) {
      const texto = readFileSync(p, 'utf-8')
      const usos = [
        ...texto.matchAll(/var\(--([a-z0-9-]+)/g),
        ...texto.matchAll(/cor\('([a-z0-9-]+)'\)/g)
      ]
      for (const m of usos) {
        const nome = m[1]
        if (nome.startsWith('tw-') || nome.startsWith('lw-') || nome.endsWith('-')) continue
        if (!claro.has(nome)) faltando.add(`${nome} (${p.slice(RAIZ.length + 1)})`)
      }
    }
    expect([...faltando]).toEqual([])
  })

  it('o tema escuro só redefine o que o claro define', () => {
    expect([...escuro].filter((n) => !claro.has(n))).toEqual([])
  })

  it('o tema escuro redefine fundos, linhas, tinta, destaque e estados', () => {
    const obrigatorias = [
      'bg',
      'bg-panel',
      'bg-elevated',
      'bg-hover',
      'border',
      'border-strong',
      'text',
      'text-muted',
      'text-dim',
      'accent',
      'on-accent',
      'success',
      'warn',
      'danger',
      'veu',
      'sombra-flutuante'
    ]
    expect(obrigatorias.filter((n) => !escuro.has(n))).toEqual([])
  })
})
