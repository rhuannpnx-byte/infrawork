import { describe, expect, it } from 'vitest'
import type { PainelEquipeDto, PainelServicoDto } from '@/types/dtos'
import {
  idadeDados,
  moeda,
  ordenarServicos,
  pct,
  pctFinanceiro,
  semLancamentoHoje,
  serieCurva,
  textoDesvio,
} from './lib'

const serv = (p: Partial<PainelServicoDto>): PainelServicoDto => ({
  id: p.codigo ?? 'x',
  codigo: 'S00',
  descricao: '',
  unidade: 'm³',
  qtd_plan: 100,
  qtd_real: 0,
  pct_avanco: 0,
  pct_esperado: 0,
  status: 'no_prazo',
  desvio_dias: null,
  inicio: null,
  fim: null,
  ritmo_plan: null,
  media_7d: null,
  dias14: [],
  valor_executado: 0,
  valor_previsto: 0,
  excedente_qtd: null,
  ...p,
})

const eq = (p: Partial<PainelEquipeDto>): PainelEquipeDto => ({
  id: p.nome ?? null,
  nome: 'E',
  lancou_hoje: false,
  ativa_semana: false,
  dias_30d: 0,
  registros_7d: 0,
  ultimo: null,
  servicos: [],
  ...p,
})

describe('formatação', () => {
  it('percentual vem em fração', () => {
    expect(pct(0.1234)).toBe('12,3%')
    expect(pct(null)).toBe('—')
  })
  it('moeda curta para o celular', () => {
    expect(moeda(140_778_697.85)).toBe('R$ 140,78 mi')
    expect(moeda(53_580.4)).toBe('R$ 53,6 mil')
    expect(moeda(5358.04)).toBe('R$ 5.358,04')
  })
  it('desvio: positivo é folga, negativo é atraso', () => {
    expect(textoDesvio(12)).toEqual({ texto: '12 d de folga', tom: 'ok' })
    expect(textoDesvio(-3)).toEqual({ texto: '3 d de atraso', tom: 'bad' })
    expect(textoDesvio(null)).toBeNull()
  })
})

describe('ordem dos serviços', () => {
  it('atrasado e em risco primeiro; depois a maior distância do esperado', () => {
    const r = ordenarServicos([
      serv({ codigo: 'S03', status: 'no_prazo', pct_esperado: 0.5, pct_avanco: 0.1 }),
      serv({ codigo: 'S02', status: 'em_risco' }),
      serv({ codigo: 'S01', status: 'no_prazo', pct_esperado: 0.2, pct_avanco: 0.2 }),
      serv({ codigo: 'S04', status: 'atrasado' }),
      serv({ codigo: 'S05', status: 'concluido' }),
    ]).map((s) => s.codigo)
    expect(r).toEqual(['S04', 'S02', 'S03', 'S01', 'S05'])
  })
})

describe('quem não lançou hoje', () => {
  it('só quem trabalhou na semana e ainda não lançou hoje, mais recente primeiro', () => {
    const r = semLancamentoHoje([
      eq({ nome: 'A', ativa_semana: true, lancou_hoje: true, ultimo: '2026-11-04' }),
      eq({ nome: 'B', ativa_semana: true, lancou_hoje: false, ultimo: '2026-11-01' }),
      eq({ nome: 'C', ativa_semana: false, lancou_hoje: false, ultimo: '2026-10-01' }),
      eq({ nome: 'D', ativa_semana: true, lancou_hoje: false, ultimo: '2026-11-03' }),
      eq({
        nome: 'Sem equipe',
        id: null,
        ativa_semana: true,
        lancou_hoje: false,
        ultimo: '2026-11-03',
      }),
    ]).map((e) => e.nome)
    expect(r).toEqual(['D', 'B'])
  })
})

describe('curva e idade dos dados', () => {
  it('realizado para em hoje (o futuro não vira zero)', () => {
    const { pontos, idxHoje } = serieCurva(
      [
        { s: '2026-10-26', p: 0.01, r: 0.02 },
        { s: '2026-11-02', p: 0.03, r: 0.03 },
        { s: '2026-11-09', p: 0.05, r: 0.03 },
      ],
      '2026-11-04',
    )
    expect(idxHoje).toBe(1)
    expect(pontos.map((p) => p.r)).toEqual([0.02, 0.03, null])
  })
  it('retrato com mais de 24 h é antigo', () => {
    const agora = Date.UTC(2026, 10, 4, 12)
    expect(idadeDados(agora - 23 * 3600_000, agora).antigo).toBe(false)
    expect(idadeDados(agora - 25 * 3600_000, agora).antigo).toBe(true)
  })
  it('% financeiro sobre o valor dos serviços', () => {
    expect(
      pctFinanceiro({
        contrato: 200,
        servicos: 100,
        executado: 25,
        executado_mes: 0,
        previsto: 0,
        servicos_alem_contrato: 0,
      }),
    ).toBe(0.25)
  })
})
