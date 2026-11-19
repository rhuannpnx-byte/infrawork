import { describe, expect, it } from 'vitest'
import {
  SEM_CARREGADOR,
  SEM_DMT,
  cargaPorEquipamentoEServico,
  faixaDmt,
  montarQuadroViagens,
  rotuloCarregador,
  totaisPorCarregador,
  type ViagemExport
} from './qdm-viagens'
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
  carregador: '',
  motorista: 'Zé',
  equipe: 'Escavação 01',
  origemId: 'corte',
  origem: 'Corte E10',
  destinoId: 'aterro',
  destino: 'Aterro E40',
  carga: { trechoId: 't1', trechoNome: 'Eixo', m: 200 },
  descarga: { trechoId: 't1', trechoNome: 'Eixo', m: 800 },
  quantidade: 10,
  dmtKm: 0.5,
  dmtOrigem: 'geometria',
  dmtCalculadaKm: 0.5,
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
    v({ data: '2026-11-04', descarga: { trechoId: 't1', trechoNome: 'Eixo', m: 820 } }),
    v({}),
    v({
      destinoId: 'bf',
      destino: 'Bota-fora',
      dmtKm: 2.5,
      dmtOrigem: 'rota',
      descarga: null
    }),
    v({
      origemId: 'jaz',
      origem: 'Jazida Km 8',
      carga: null,
      dmtKm: null,
      dmtOrigem: null,
      quantidade: 12
    }),
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
      q.linhas.map((l) => [
        l.origem,
        l.destino,
        l.viagens,
        l.volume,
        l.estacasCarga,
        l.estacasDescarga,
        l.faixa
      ])
    ).toEqual([
      ['Corte E10', 'Aterro E40', 2, 20, 'E10', 'E40 a E41', '400 a 600 m'],
      ['Corte E10', 'Bota-fora', 1, 10, 'E10', '', '2.000 a 3.000 m'],
      ['Jazida Km 8', 'Aterro E40', 1, 12, '', 'E40', SEM_DMT]
    ])
    expect(q.relacao.map((r) => r.dmtCalculo)).toEqual([
      'pelo eixo',
      'distância fixa',
      '',
      'pelo eixo'
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

  it('DMT ajustada mostra a calculada', () => {
    const q = montarQuadroViagens({
      grupo,
      filho,
      viagens: [v({ dmtKm: 9.1, dmtOrigem: 'manual', dmtCalculadaKm: 7.5 })],
      producaoPeriodo: 10,
      formatarPosicao: fmt
    })
    expect(q.relacao[0].dmtCalculo).toBe('ajustada (calculada 7,5 km)')
  })
})

describe('equipamento de carga', () => {
  const viagens = [
    {
      carregador: 'EH-01 · CAT 320',
      quantidade: 10,
      dmtKm: 1,
      servico: 'S02 Escavação',
      unidade: 'm³'
    },
    {
      carregador: 'EH-01 · CAT 320',
      quantidade: 14,
      dmtKm: 2,
      servico: 'S02 Escavação',
      unidade: 'm³'
    },
    {
      carregador: 'PC-02 · 938',
      quantidade: 6,
      dmtKm: null,
      servico: 'S02 Escavação',
      unidade: 'm³'
    },
    { carregador: '', quantidade: 5, dmtKm: 1, servico: 'S02 Escavação', unidade: 'm³' },
    {
      carregador: 'EH-01 · CAT 320',
      quantidade: 20,
      dmtKm: 3,
      servico: 'S05 Sub-base',
      unidade: 't'
    }
  ]

  it('soma por equipamento, com DMT médio ponderado e o não informado por último', () => {
    const r = totaisPorCarregador(viagens.slice(0, 4))
    expect(r.map((x) => [x.carregador, x.viagens, x.volume])).toEqual([
      ['EH-01 · CAT 320', 2, 24],
      ['PC-02 · 938', 1, 6],
      [SEM_CARREGADOR, 1, 5]
    ])
    expect(r[0].dmtMedioKm).toBeCloseTo((10 * 1 + 14 * 2) / 24)
    expect(r[1].dmtMedioKm).toBeNull()
    expect(r[0].pct).toBeCloseTo(24 / 35)
  })

  it('abre por serviço, porque as unidades não se somam', () => {
    const r = cargaPorEquipamentoEServico(viagens)
    expect(r.map((x) => [x.carregador, x.servico, x.unidade, x.volume])).toEqual([
      ['EH-01 · CAT 320', 'S02 Escavação', 'm³', 24],
      ['EH-01 · CAT 320', 'S05 Sub-base', 't', 20],
      ['PC-02 · 938', 'S02 Escavação', 'm³', 6],
      [SEM_CARREGADOR, 'S02 Escavação', 'm³', 5]
    ])
  })

  it('rótulo do equipamento: código e modelo; a placa quando não há modelo', () => {
    expect(rotuloCarregador({ prefixo: 'EH-01', placa: 'ABC1D23', modelo: 'CAT 320' })).toBe(
      'EH-01 · CAT 320'
    )
    expect(rotuloCarregador({ prefixo: 'EH-01', placa: 'ABC1D23', modelo: null })).toBe(
      'EH-01 · ABC1D23'
    )
    expect(rotuloCarregador(null)).toBe('')
  })

  it('o quadro do serviço traz o total por equipamento e o equipamento na relação', () => {
    const q = montarQuadroViagens({
      grupo,
      filho,
      viagens: [v({ carregador: 'EH-01 · CAT 320' }), v({ carregador: 'EH-01 · CAT 320' }), v({})],
      producaoPeriodo: 30,
      formatarPosicao: fmt
    })
    expect(q.porCarregador.map((x) => [x.carregador, x.viagens])).toEqual([
      ['EH-01 · CAT 320', 2],
      [SEM_CARREGADOR, 1]
    ])
    expect(q.relacao[0].carregador).toBe('EH-01 · CAT 320')
  })
})
