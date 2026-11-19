import { describe, expect, it } from 'vitest'
import { segmentosDoTemplate } from './trecho'
import { quantidadesPorLocal } from './quantidades-por-local'
import {
  montarResumo,
  montarTemplate,
  type QuantidadesAtualBruto,
  type ResumoQuantidadesBruto
} from './quantidades-leitura'

const bruto = (segmentos: QuantidadesAtualBruto['segmentos']): QuantidadesAtualBruto => ({
  versao: {
    id: 'v1',
    template_id: 't1',
    numero: 3,
    is_atual: true,
    comentario: 'Importado de planilha.xlsx',
    criado_por: null,
    created_at: '2026-11-19T12:00:00Z'
  },
  modo: 'simplificado',
  colunas: [
    {
      id: 'c-a',
      item_orcamentario_id: 'A',
      ordem: 0,
      codigo: 'S01',
      descricao: 'Sub-base',
      unidade: 'm³'
    },
    {
      id: 'c-b',
      item_orcamentario_id: 'B',
      ordem: 1,
      codigo: 'S02',
      descricao: 'Base',
      unidade: 'm³'
    }
  ],
  segmentos
})

describe('montarTemplate', () => {
  const t = montarTemplate(
    bruto([
      [0, 20, 'EST 0', 'EST 1', { '0': 10.5, '1': 3 }],
      [20, 40, 'EST 1', 'EST 2', {}],
      [40, 60, null, null, { '1': 7.25 }]
    ])
  )

  it('devolve a versão, o modo e as colunas com o nome do serviço', () => {
    expect(t.numero).toBe(3)
    expect(t.modo).toBe('simplificado')
    expect(t.colunas.map((c) => [c.id, c.item_orcamentario_id, c.nome, c.unidade])).toEqual([
      ['c-a', 'A', 'S01 Sub-base', 'm³'],
      ['c-b', 'B', 'S02 Base', 'm³']
    ])
  })

  it('troca a posição da coluna pelo id dela nos valores de cada faixa', () => {
    expect(
      t.segmentos.map((s) => [s.ordem, s.posicao_inicio_m, s.posicao_fim_m, s.valores])
    ).toEqual([
      [0, 0, 20, { 'c-a': 10.5, 'c-b': 3 }],
      [1, 20, 40, {}],
      [2, 40, 60, { 'c-b': 7.25 }]
    ])
    expect(segmentosDoTemplate(t)[2]).toEqual({
      ini: 40,
      fim: 60,
      label_ini: '',
      label_fim: '',
      valores: { B: 7.25 }
    })
  })

  it('não perde faixa nenhuma num eixo com mais de mil faixas', () => {
    // a leitura antiga, pelas tabelas, parava na milésima faixa
    const faixas = Array.from(
      { length: 2742 },
      (_, i): QuantidadesAtualBruto['segmentos'][number] => [
        i * 20,
        (i + 1) * 20,
        '',
        '',
        { '0': 2 }
      ]
    )
    const grande = montarTemplate(bruto(faixas))
    expect(grande.segmentos).toHaveLength(2742)
    const total = segmentosDoTemplate(grande).reduce((soma, s) => soma + (s.valores.A ?? 0), 0)
    expect(total).toBe(5484)
  })
})

describe('montarResumo', () => {
  const linhas: ResumoQuantidadesBruto[] = [
    {
      trecho_id: 'eixo1',
      versao_id: 'v1',
      numero: 2,
      faixas: 2742,
      servicos: 2,
      totais: { A: 5484, B: 100 }
    }
  ]

  it('indexa por local e alimenta a tabela de quantidades por local sem saldo falso', () => {
    const r = montarResumo(linhas)
    expect(r.get('eixo1')).toMatchObject({ numero: 2, faixas: 2742, servicos: 2 })
    const tabela = quantidadesPorLocal(
      [
        { id: 'A', codigo: 'S01', descricao: 'Sub-base', unidade: 'm³', quantidade: 5484 },
        { id: 'B', codigo: 'S02', descricao: 'Base', unidade: 'm³', quantidade: 130 }
      ],
      new Map([...r].map(([id, x]) => [id, x.totais]))
    )
    expect(tabela.map((l) => [l.servico.id, l.nosLocais, l.semLocal])).toEqual([
      ['A', 5484, 0],
      ['B', 100, 30]
    ])
  })

  it('obra sem quantidades: mapa vazio', () => {
    expect(montarResumo(null).size).toBe(0)
    expect(montarResumo([]).size).toBe(0)
  })
})

describe('as faixas e os valores nunca são lidos direto das tabelas', () => {
  // A API corta toda consulta em 1.000 linhas sem avisar: foi assim que um eixo de 2.742 faixas aparecia com saldo
  // "sem local". Quem precisa das quantidades usa trecho_quantidades_atual ou trechos_quantidades_resumo.
  it('nenhum arquivo do web ou do MCP consulta trecho_quantidade_segmento, _celula ou _coluna', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join, resolve } = await import('node:path')
    const raiz = resolve(__dirname, '../../../..')
    const achados: string[] = []
    const varrer = (pasta: string): void => {
      for (const e of readdirSync(pasta, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        const caminho = join(pasta, e.name)
        if (e.isDirectory()) varrer(caminho)
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const texto = readFileSync(caminho, 'utf8')
          if (
            /(from|ler(<[^>]*>)?)\(\s*['"]trecho_quantidade_(segmento|celula|coluna)['"]/.test(
              texto
            )
          )
            achados.push(caminho.slice(raiz.length + 1))
        }
      }
    }
    varrer(join(raiz, 'src'))
    varrer(join(raiz, 'mcp'))
    expect(achados).toEqual([])
  })
})
