import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'theme.css'), 'utf-8')

function bloco(seletor: string): Map<string, string> {
  const ini = css.indexOf(seletor)
  const texto = css.slice(ini, css.indexOf('\n}', ini))
  return new Map(
    [...texto.matchAll(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()])
  )
}

const claro = bloco(':root {')
const escuro = new Map([...claro, ...bloco(":root[data-theme='dark'] {")])

/** OKLCH → sRGB linear (Björn Ottosson). */
function oklchParaLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const corta = (v: number): number => Math.min(1, Math.max(0, v))
  return [
    corta(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    corta(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    corta(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)
  ]
}

function luminancia(tema: Map<string, string>, nome: string): number {
  let valor = tema.get(nome)
  for (let i = 0; i < 5 && valor?.startsWith('var('); i++)
    valor = tema.get(valor.slice(6, valor.indexOf(')')).trim())
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/.exec(valor ?? '')
  if (!m) throw new Error(`--${nome} não é uma cor OKLCH sólida: ${valor}`)
  const [r, g, b] = oklchParaLinear(Number(m[1]) / 100, Number(m[2]), Number(m[3]))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(tema: Map<string, string>, texto: string, fundo: string): number {
  const a = luminancia(tema, texto)
  const b = luminancia(tema, fundo)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// texto sobre os fundos em que ele é usado; 4,5:1 é o mínimo para texto pequeno (WCAG AA)
const PARES: Array<[string, string]> = [
  ['text', 'bg'],
  ['text', 'bg-panel'],
  ['text', 'bg-elevated'],
  ['text', 'bg-menu'],
  ['text-muted', 'bg'],
  ['text-muted', 'bg-panel'],
  ['text-muted', 'bg-elevated'],
  ['text-muted', 'bg-menu'],
  ['text-dim', 'bg'],
  ['text-dim', 'bg-panel'],
  ['text-dim', 'bg-elevated'],
  ['text-dim', 'bg-menu'],
  ['accent', 'bg'],
  ['accent', 'bg-panel'],
  ['accent', 'bg-menu'],
  ['on-accent', 'accent'],
  ['success', 'bg-panel'],
  ['warn', 'bg-panel'],
  ['danger', 'bg-panel']
]

describe('contraste dos tokens', () => {
  for (const [nome, tema] of [
    ['claro', claro],
    ['escuro', escuro]
  ] as const) {
    it(`tema ${nome}: texto e destaques com pelo menos 4,5:1`, () => {
      const baixos = PARES.map(([t, f]) => ({ par: `${t} sobre ${f}`, c: contraste(tema, t, f) }))
        .filter((x) => x.c < 4.5)
        .map((x) => `${x.par}: ${x.c.toFixed(2)}`)
      expect(baixos).toEqual([])
    })

    it(`tema ${nome}: contorno de campo com pelo menos 3:1 sobre a folha`, () => {
      expect(contraste(tema, 'border-strong', 'bg-panel')).toBeGreaterThanOrEqual(3)
    })
  }
})
