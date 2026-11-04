import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { ItemLancavel } from '@/features/acompanhamento/hooks/lancamento'
import type { TrechoLocal } from '@/features/acompanhamento/lib/local-producao'
import { parseProducao, producaoToInputs } from './producao'

const eixo: TrechoLocal = {
  id: 'e1',
  nome: 'Trecho 2 — Contorno',
  tipo: 'eixo',
  comprimento_m: 4500,
  geometry_comprimento_m: null,
  unidade_espaco_padrao: 'km',
  unidade_custom_label: null,
  unidade_custom_divisor_m: null,
  marcador_valor_inicial: 0,
  geometry_sentido: 'natural'
}
const area: TrechoLocal = { ...eixo, id: 'a1', nome: 'OAE Km 3', tipo: 'area', comprimento_m: null }
const itens = [{ id: 'i1', codigo: '01.01' }] as unknown as ItemLancavel[]

function planilha(linhas: unknown[][]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Produção')
  ws.addRow([
    'Data',
    'Código do item',
    'Equipe',
    'Encarregado',
    'Quantidade',
    'Frente',
    'Local',
    'Estaca inicial',
    'Estaca final',
    'Obs'
  ])
  for (const l of linhas) ws.addRow(l)
  return wb
}

const ctx = { itens, equipes: [], encarregados: [], trechos: [eixo, area], hojeISO: '2026-12-31' }

describe('importação de produção com local (controle por estaca)', () => {
  it('eixo com estacas vira a faixa em metros; área sem faixa; sem local só texto', () => {
    const r = parseProducao(
      planilha([
        ['01/10/2026', '01.01', '', '', 10, '', 'trecho 2 — contorno', '2+000', '2+500', ''],
        ['02/10/2026', '01.01', '', '', 5, '', 'Área OAE Km 3', '', '', ''],
        ['03/10/2026', '01.01', '', '', 7, '', '', '1+000', '1+200', '']
      ]),
      ctx
    )
    expect(r.rows.map((x) => x.acao)).toEqual(['criar', 'criar', 'criar'])
    const inp = producaoToInputs(r.rows, 'obra', new Map())
    expect(inp.map((x) => [x.trecho_id, x.posicao_inicio_m, x.posicao_fim_m])).toEqual([
      ['e1', 2000, 2500],
      ['a1', null, null],
      [null, null, null]
    ])
    expect(inp[2]!.estaca_inicial).toBe('1+000')
  })
  it('local inexistente, eixo sem estacas ou estaca fora do eixo são erros da linha', () => {
    const r = parseProducao(
      planilha([
        ['01/10/2026', '01.01', '', '', 10, '', 'Nada', '', '', ''],
        ['01/10/2026', '01.01', '', '', 10, '', 'Trecho 2 — Contorno', '', '', ''],
        ['01/10/2026', '01.01', '', '', 10, '', 'Trecho 2 — Contorno', '4+000', '9+000', '']
      ]),
      ctx
    )
    expect(r.rows.map((x) => x.acao)).toEqual(['erro', 'erro', 'erro'])
    expect(r.rows[0]!.erros[0]!.col).toBe('Local')
    expect(r.rows[2]!.erros[0]!.msg).toMatch(/fora/)
  })
})
