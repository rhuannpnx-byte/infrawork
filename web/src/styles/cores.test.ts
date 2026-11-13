import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/**
 * Onde cor fixa é permitida: o que fica sobre foto ou mapa de satélite, o login (tem paleta própria), o que vai
 * para arquivo exportado ou impresso (não segue o tema da tela) e as cores gravadas no banco (equipe, trecho,
 * série do cronograma), que são dado, não tema.
 */
const PERMITIDOS = [
  /[\\/]app[\\/]routes[\\/]Login/,
  /[\\/]app[\\/]routes[\\/]login-/,
  /[\\/]app[\\/]OAuthConsentimento/,
  /[\\/]features[\\/]acompanhamento[\\/]components[\\/]fotos[\\/](MapaFotosSatelite|FotoLightbox|FotoMapHoverCard|MapaLegenda|MapaConfigPopover)\.tsx$/,
  /[\\/]features[\\/]planejamento[\\/](components[\\/]MapaTrecho|modals[\\/](ImportarKmlTrechoDialog|VisualizarMapaTrechoDialog))\.tsx$/,
  /[\\/]lib[\\/](leaflet|print|excel|xlsx|colors|kml)[\\/]/,
  /[\\/]features[\\/]acompanhamento[\\/]lib[\\/](relatorio-servico|programacao-mensal-xlsx|valor-agregado-export)\.ts$/,
  /[\\/]features[\\/]cronograma[\\/]visoes[\\/]/,
  /[\\/]types[\\/]/,
  /[\\/]stores[\\/]theme-store\.ts$/,
  /[\\/]features[\\/]acompanhamento[\\/]components[\\/]fotos[\\/](FotosGridVirtualizado|AvisoProducaoSemFoto)\.tsx$/,
  /\.test\.tsx?$/
]

/** Valor padrão de uma cor gravada no banco (equipe, local, barra do cronograma): `cor ?? '#…'`. */
const COR_DE_DADO = /(\?\?|\|\|) '#[0-9a-fA-F]{6}'/

const PALETA =
  /\b(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret|placeholder)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])/g

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) return arquivos(p)
    return /\.tsx?$/.test(nome) ? [p] : []
  })
}

function ocorrencias(padrao: RegExp): string[] {
  const out: string[] = []
  for (const p of arquivos(SRC)) {
    if (PERMITIDOS.some((r) => r.test(p))) continue
    const linhas = readFileSync(p, 'utf-8').split('\n')
    linhas.forEach((linha, i) => {
      // comentário e valor padrão de cor de dado (equipe, local) não contam
      if (/^\s*(\/\/|\*|\/\*)/.test(linha) || COR_DE_DADO.test(linha)) return
      for (const m of linha.matchAll(padrao))
        out.push(`${p.slice(SRC.length + 1)}:${i + 1} ${m[0]}`)
    })
  }
  return out
}

describe('cor só por token', () => {
  it('nenhuma classe da paleta padrão do Tailwind fora das exceções', () => {
    expect(ocorrencias(PALETA)).toEqual([])
  })

  it('nenhuma cor em hexadecimal fora das exceções', () => {
    expect(ocorrencias(HEX)).toEqual([])
  })
})
