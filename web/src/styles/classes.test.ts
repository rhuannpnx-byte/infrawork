import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')
const config = readFileSync(join(RAIZ, 'tailwind.config.js'), 'utf-8')

/** Nomes de cor que o Tailwind gera a partir do `tailwind.config.js` (`accent: { hover }` vira `accent-hover`). */
function coresDefinidas(): Set<string> {
  const ini = config.indexOf('colors: {')
  const bloco = config.slice(ini, config.indexOf('\n      },', ini))
  const nomes = new Set<string>()
  let grupo: string | null = null
  for (const linha of bloco.split('\n').slice(1)) {
    const abre = /^\s*'?([a-z0-9-]+)'?: \{\s*$/.exec(linha)
    if (abre) {
      grupo = abre[1]
      continue
    }
    if (/^\s*\},?\s*$/.test(linha)) {
      grupo = null
      continue
    }
    const chave = /^\s*'?([A-Za-z0-9-]+)'?: cor\(/.exec(linha)
    if (!chave) continue
    if (!grupo) nomes.add(chave[1])
    else nomes.add(chave[1] === 'DEFAULT' ? grupo : `${grupo}-${chave[1]}`)
  }
  return nomes
}

const definidas = coresDefinidas()
// primeira palavra de um nome de cor do projeto, e nomes de outras bibliotecas que aqui não existem
const RAIZES = new Set([...definidas].map((n) => n.split('-')[0]))
const ALHEIOS = new Set([
  'warning',
  'error',
  'info',
  'primary',
  'secondary',
  'muted',
  'destructive',
  'foreground',
  'background',
  'card',
  'popover',
  'surface'
])
const CLASSE =
  /(?<![\w-])(?:bg|text|border|ring|divide|outline|fill|stroke|from|via|to|decoration|placeholder|caret)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\/\d+)?(?![\w-[(])/g

// utilitários do Tailwind que começam como um nome de cor do projeto mas não são cor
const NAO_E_COR =
  /^(text-(ellipsis|clip|wrap|nowrap|balance|pretty)|border-(collapse|separate|spacing.*|solid|dashed|dotted|double|hidden|none)|bg-(clip|origin|blend|opacity|none|fixed|local|scroll|repeat|no-repeat|cover|contain|center|bottom|top|left|right).*)$/

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) return arquivos(p)
    // a galeria lista os nomes dos tokens como texto, não como classe
    return /\.tsx$/.test(nome) && !/\.test\.tsx$/.test(nome) && nome !== 'Galeria.tsx' ? [p] : []
  })
}

describe('classes de cor', () => {
  it('o config define as cores esperadas', () => {
    for (const n of ['bg-panel', 'text-muted', 'accent', 'accent-glow-strong', 'danger', 'border'])
      expect(definidas.has(n)).toBe(true)
  })

  it('toda classe de cor do projeto usada nas telas existe no tailwind.config.js', () => {
    const erradas = new Set<string>()
    for (const p of arquivos(join(RAIZ, 'src'))) {
      const texto = readFileSync(p, 'utf-8')
      for (const m of texto.matchAll(CLASSE)) {
        const nome = m[1]
        const raiz = nome.split('-')[0]
        if (definidas.has(nome)) continue
        if (!RAIZES.has(raiz) && !ALHEIOS.has(raiz)) continue
        if (NAO_E_COR.test(m[0].replace(/\/\d+$/, ''))) continue
        erradas.add(`${m[0]} (${p.slice(RAIZ.length + 1)})`)
      }
    }
    expect([...erradas]).toEqual([])
  })
})
