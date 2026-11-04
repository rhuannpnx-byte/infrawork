import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  converterAba,
  converterArea,
  gerarPlanilhaQuantidades,
  lerPlanilhaQuantidades,
  mapeamentoDaPlanilha
} from './boq-xlsx'
import type { TrechoCtx } from '@/lib/format/posicao'

const ctxKm: TrechoCtx = {
  unidade_espaco_padrao: 'km',
  marcador_valor_inicial: 0,
  geometry_sentido: 'natural'
}

function livro(abas: Record<string, unknown[][]>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  for (const [nome, linhas] of Object.entries(abas)) {
    const ws = wb.addWorksheet(nome)
    linhas.forEach((l, i) =>
      l.forEach((v, j) => (ws.getCell(i + 1, j + 1).value = v as ExcelJS.CellValue))
    )
  }
  return wb
}

describe('lerPlanilhaQuantidades', () => {
  it('layout por ponto (DynaRoad): "Estaca" + serviços, linha de unidades, zero no meio; valores pt-BR', () => {
    const wb = livro({
      'Eixo A': [
        ['Projeto X'],
        [],
        ['Estaca', 'S01 Escavação', 'S02 Aterro'],
        ['', 'm³', 'm³'],
        [0, 100, ''],
        [1, 200, 0],
        [2, 0, '300,5'],
        [3, 150, 400]
      ]
    })
    const r = lerPlanilhaQuantidades(wb)
    expect(r.erros).toEqual([])
    const aba = r.abas[0]!
    expect(aba.layout).toBe('ponto')
    expect(aba.colunas.map((c) => [c.titulo, c.unidade])).toEqual([
      ['S01 Escavação', 'm³'],
      ['S02 Aterro', 'm³']
    ])
    expect(aba.pontos.map((p) => p.estaca)).toEqual([0, 1, 2, 3])
    const conv = converterAba(
      aba,
      ctxKm,
      { geometry_comprimento_m: 3000 },
      new Map([
        [2, 'esc'],
        [3, 'ate']
      ]),
      1000
    )
    expect(conv.erros).toEqual([])
    // pontos médios: km 0 → [0,500], km 1 → [500,1500], km 2 → [1500,2500], km 3 → [2500,3000]
    expect(conv.segmentos.map((s) => [s.ini, s.fim])).toEqual([
      [0, 500],
      [500, 1500],
      [1500, 2500],
      [2500, 3000]
    ])
    expect(conv.segmentos[2]!.valores).toEqual({ ate: 300.5 })
    expect(conv.totais).toEqual({ esc: 450, ate: 700.5 })
  })

  it('estaca em texto "2+500" e erro apontando a célula na linha de soma', () => {
    const wb = livro({
      BR: [
        ['Station', 'Base'],
        ['0+000', 10],
        ['2+500', 20],
        ['Total', 30]
      ]
    })
    const r = lerPlanilhaQuantidades(wb)
    expect(r.erros).toEqual([{ aba: 'BR', celula: 'A4', mensagem: expect.stringMatching(/soma/) }])
    const conv = converterAba(
      r.abas[0]!,
      ctxKm,
      { geometry_comprimento_m: 0 },
      new Map([[2, 'b']]),
      1000
    )
    expect(conv.segmentos.map((s) => [s.ini, s.fim])).toEqual([
      [0, 1250],
      [1250, 2500]
    ])
  })

  it('layout por faixa (modelo do InfraWork) com Início/Fim em metros, e aba de áreas', () => {
    const wb = livro({
      'Eixo 1': [
        ['Início (m)', 'Fim (m)', 'Unid inicial', 'Unid final', 'S01 Base (m³)'],
        [0, 1000, 'km 0', 'km 1', 400],
        [1000, 2000, 'km 1', 'km 2', 900]
      ],
      Áreas: [
        ['Área', 'Estaca', 'Distância', 'S01 Base (m³)', 'S02 Sinalização (un)'],
        ['OAE Córrego', 1000, 500, 50, 2],
        ['Canteiro', '', '', '', 1]
      ],
      Capa: [['Obra tal'], ['Nada aqui']]
    })
    const r = lerPlanilhaQuantidades(wb)
    expect(r.erros).toEqual([])
    expect(r.ignoradas).toEqual(['Capa'])
    const faixa = r.abas.find((a) => a.layout === 'faixa')!
    expect(faixa.emMetros).toBe(true)
    expect(faixa.colunas.map((c) => c.titulo)).toEqual(['S01 Base (m³)'])
    const conv = converterAba(
      faixa,
      ctxKm,
      { geometry_comprimento_m: 2000 },
      new Map([[5, 'base']]),
      1000
    )
    expect(conv.segmentos.map((s) => [s.ini, s.fim, s.valores.base])).toEqual([
      [0, 1000, 400],
      [1000, 2000, 900]
    ])
    const areas = r.abas.find((a) => a.layout === 'areas')!
    expect(areas.colunas.map((c) => c.titulo)).toEqual(['S01 Base (m³)', 'S02 Sinalização (un)'])
    expect(areas.areas.map((a) => a.nome)).toEqual(['OAE Córrego', 'Canteiro'])
    expect(
      converterArea(
        areas.areas[0]!,
        new Map([
          [4, 'base'],
          [5, 'sin']
        ])
      )
    ).toEqual({
      ini: 0,
      fim: 1,
      label_ini: 'área',
      label_fim: 'área',
      valores: { base: 50, sin: 2 }
    })
  })

  it('quantidade não numérica, negativa e estacas fora de ordem são erros com a célula', () => {
    const r = lerPlanilhaQuantidades(
      livro({
        E: [
          ['Estaca', 'A'],
          [0, 'abc'],
          [1, -5]
        ]
      })
    )
    expect(r.erros.map((e) => e.celula)).toEqual(['B2', 'B3'])
    const r2 = lerPlanilhaQuantidades(
      livro({
        E: [
          ['Estaca', 'A'],
          [0, 1],
          [1, 1],
          [3, 1],
          [2, 1]
        ]
      })
    )
    const conv = converterAba(
      r2.abas[0]!,
      ctxKm,
      { geometry_comprimento_m: 0 },
      new Map([[2, 'a']]),
      1000
    )
    expect(conv.erros.map((e) => [e.celula, e.mensagem])).toEqual([
      ['A5', expect.stringMatching(/crescentes/)]
    ])
  })

  it('eixo de numeração decrescente: a planilha em ordem de marcador vira faixas crescentes em metros', () => {
    const r = lerPlanilhaQuantidades(
      livro({
        E: [
          ['Estaca', 'A'],
          [100, 10],
          [99, 20],
          [98, 30]
        ]
      })
    )
    const conv = converterAba(
      r.abas[0]!,
      { ...ctxKm, marcador_valor_inicial: 100, geometry_sentido: 'invertido' },
      { geometry_comprimento_m: 2000 },
      new Map([[2, 'a']]),
      1000
    )
    expect(conv.erros).toEqual([])
    // km 98 → 2000 m internos (a estaca mais alta em metros), km 100 → 0
    expect(conv.segmentos.map((s) => [s.ini, s.fim, s.valores.a])).toEqual([
      [0, 500, 10],
      [500, 1500, 20],
      [1500, 2000, 30]
    ])
  })

  it('ida e volta: a planilha gerada é lida de volta com o mesmo conteúdo e o mapeamento da aba oculta', async () => {
    const blob = await gerarPlanilhaQuantidades({
      obraNome: 'Obra',
      servicos: [{ id: 'b', codigo: 'S01', descricao: 'Base', unidade: 'm³' }],
      locais: [
        {
          nome: 'Eixo 1',
          tipo: 'eixo',
          segmentos: [
            { ini: 0, fim: 1000, label_ini: 'km 0', label_fim: 'km 1', valores: { b: 400 } }
          ]
        },
        {
          nome: 'OAE',
          tipo: 'area',
          segmentos: [{ ini: 0, fim: 1, label_ini: 'área', label_fim: 'área', valores: { b: 7 } }]
        }
      ]
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const r = lerPlanilhaQuantidades(wb)
    expect(r.erros).toEqual([])
    expect(r.abas.map((a) => [a.nome, a.layout])).toEqual([
      ['Eixo 1', 'faixa'],
      ['Áreas', 'areas']
    ])
    expect(mapeamentoDaPlanilha(wb).get('s01 base (m³)')).toBe('b')
    const conv = converterAba(
      r.abas[0]!,
      ctxKm,
      { geometry_comprimento_m: 1000 },
      new Map([[5, 'b']]),
      1000
    )
    expect(conv.segmentos[0]!.valores).toEqual({ b: 400 })
    expect(r.abas[1]!.areas[0]).toMatchObject({ nome: 'OAE', valores: { 2: 7 } })
  })
})
