import { describe, expect, it } from 'vitest'
import { SEM_DMT, faixaDmt, montarQuadroViagens, type ViagemExport } from './qdm-viagens'
import type { EapFilhoReceita, EapGrupo } from './valor-agregado-calc'

const filho: EapFilhoReceita = {
  id: 'r1',
  codigo: '1.1',
  descricao: 'Escavação e transporte',
  unidade: 'm³',
  quantidade: 2000,
  venda_unitaria: 10
}
const grupo: EapGrupo = {
  id: 'g1',
  codigo: 'S02',
  descricao: 'ESCAV, CARGA E TRANSP',
  quantidade_referencia: 1000,
  unidade_referencia: 'm³',
  custo_unitario: 0,
  filhos: [filho]
}

let seq = 0
const v = (p: Partial<ViagemExport>): ViagemExport => ({
  id: `v${++seq}`,
  itemId: 'g1',
  data: '2026-11-03',
  fichaId: 'f1',
  ordem: seq,
  veiculo: 'CBT0012 · ABC1D23',
  motorista: 'Zé',
  equipe: 'Escavação 01',
  origemId: 'corte',
  origem: 'Corte E10',
  destinoId: 'aterro',
  destino: 'Aterro E40',
  trechoId: 't1',
  trechoNome: 'Eixo',
  trechoArea: false,
  posIni: 800,
  posFim: 800,
  quantidade: 10,
  dmtKm: 0.5,
  nfTicket: '',
  ...p
})
const fmt = (_t: string, m: number): string => `E${m / 20}`

describe('faixaDmt', () => {
  it('faixas SICRO em metros', () => {
    expect([0.03, 0.05, 0.12, 0.5, 1.9, 2.5, 4, null].map(faixaDmt)).toEqual([
      'até 50 m',
      'até 50 m',
      '50 a 200 m',
      '400 a 600 m',
      '1.800 a 2.000 m',
      '2.000 a 3.000 m',
      'acima de 3.000 m',
      SEM_DMT
    ])
  })
})

describe('montarQuadroViagens', () => {
  const viagens = [
    v({ data: '2026-11-04', posIni: 820, posFim: 820 }),
    v({ posIni: 800, posFim: 800 }),
    v({
      destinoId: 'bf',
      destino: 'Bota-fora',
      dmtKm: 2.5,
      trechoId: null,
      posIni: null,
      posFim: null
    }),
    v({ origemId: 'jaz', origem: 'Jazida Km 8', dmtKm: null, quantidade: 12 }),
    v({ itemId: 'outro', quantidade: 999 })
  ]

  it('agrupa por origem → destino → DMT, com estacas, momento e rateio do filho', () => {
    const q = montarQuadroViagens({
      grupo,
      filho,
      viagens,
      producaoPeriodo: 42,
      formatarPosicao: fmt
    })
    expect(
      q.linhas.map((l) => [l.origem, l.destino, l.viagens, l.volume, l.estacas, l.faixa])
    ).toEqual([
      ['Corte E10', 'Aterro E40', 2, 20, 'E40 a E41', '400 a 600 m'],
      ['Corte E10', 'Bota-fora', 1, 10, '', '2.000 a 3.000 m'],
      ['Jazida Km 8', 'Aterro E40', 1, 12, 'E40', SEM_DMT]
    ])
    expect(q.linhas[0].momento).toBe(10)
    expect(q.linhas[0].qtd).toBe(40) // 20 / 1000 × 2000
    expect(q.total.viagens).toBe(4)
    expect(q.total.volume).toBe(42)
    expect(q.total.momento).toBe(35) // 20×0,5 + 10×2,5
    expect(q.total.dmtMedioKm).toBeCloseTo(35 / 30) // só o volume com DMT
    expect(q.total.qtd).toBe(84)
    expect(q.total.valor).toBe(840)
    expect(q.relacao.map((r) => r.data)).toEqual([
      '03/11/2026',
      '03/11/2026',
      '03/11/2026',
      '04/11/2026'
    ])
    expect(q.porFaixa.map((f) => f.faixa)).toEqual(['400 a 600 m', '2.000 a 3.000 m', SEM_DMT])
  })

  it('produção sem viagem entra como linha para bater com a Medição', () => {
    const q = montarQuadroViagens({
      grupo,
      filho,
      viagens,
      producaoPeriodo: 50,
      formatarPosicao: fmt
    })
    const ultima = q.linhas[q.linhas.length - 1]
    expect(ultima.origem).toBe('Produção sem viagem no período')
    expect(ultima.volume).toBeCloseTo(8)
    expect(q.total.volume).toBeCloseTo(50)
    expect(q.total.qtd).toBeCloseTo((50 / 1000) * 2000)
  })
})
