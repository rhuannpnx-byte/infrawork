import { describe, expect, it } from 'vitest'
import {
  configDoForm,
  configsParaCriar,
  FORM_INDIRETO_PADRAO,
  formDoConfig,
  PARCELAS_PADRAO,
  rotuloParcela,
  type FormIndireto
} from './indireto-form'

const parcelado: FormIndireto = {
  ...FORM_INDIRETO_PADRAO,
  distribuicao: 'parcelado',
  parcelas: PARCELAS_PADRAO.parcelado
}

describe('indireto: formulário', () => {
  it('contínuo cria uma tarefa e limpa os campos de parcela', () => {
    const r = configsParaCriar(FORM_INDIRETO_PADRAO)
    expect(Array.isArray(r) && r.length).toBe(1)
    expect((r as Record<string, unknown>[])[0]).toMatchObject({
      distribuicao: 'continuo',
      parcela_percentual: ''
    })
  })

  it('parcelado 50/50 cria duas tarefas, início e fim', () => {
    const r = configsParaCriar(parcelado) as Record<string, unknown>[]
    expect(r.map((c) => [c.parcela_percentual, c.parcela_ancora, c.parcela_dias])).toEqual([
      ['0.5', 'inicio', 30],
      ['0.5', 'fim', 30]
    ])
    expect(rotuloParcela(r[1])).toBe('50% · últimos 30 dias')
  })

  it('na criação as parcelas podem ficar abaixo de 100%, nunca acima', () => {
    const r = configsParaCriar({
      ...parcelado,
      parcelas: [
        { pct: '50', ancora: 'inicio', dias: '30' },
        { pct: '30', ancora: 'fim', dias: '30' }
      ]
    })
    expect(Array.isArray(r) && r.length).toBe(2)
    const acima = configsParaCriar({
      ...parcelado,
      parcelas: [
        { pct: '70', ancora: 'inicio', dias: '30' },
        { pct: '40', ancora: 'fim', dias: '30' }
      ]
    })
    expect(acima).toMatch(/110%/)
  })

  it('pontual é 100% e exige dias inteiros', () => {
    const f: FormIndireto = { ...FORM_INDIRETO_PADRAO, distribuicao: 'pontual' }
    expect((configsParaCriar(f) as Record<string, unknown>[])[0].parcela_percentual).toBe('1')
    expect(
      configsParaCriar({ ...f, parcelas: [{ pct: '100', ancora: 'inicio', dias: '0' }] })
    ).toMatch(/dias úteis/)
  })

  it('a tarefa salva volta ao formulário: 100% é pontual, menos é parcela de um parcelado', () => {
    const cfg = {
      ...formDoConfig(null),
      custo_periodicidade: 'mes' as const,
      custo_unitario: null,
      receita_modo: 'mesma_logica_custo' as const,
      receita_unitaria: null,
      receita_percentual: null,
      offset_dias_antes: 0,
      offset_dias_depois: 0,
      receita_extrapola: true,
      aplica_taxas: false,
      taxa_percentual: null,
      distribuicao: 'parcela' as const,
      parcela_percentual: 0.5,
      parcela_ancora: 'fim' as const,
      parcela_dias: 20
    }
    const f = formDoConfig(cfg)
    expect(f.distribuicao).toBe('parcelado')
    expect(f.parcelas).toEqual([{ pct: '50', ancora: 'fim', dias: '20' }])
    expect(configDoForm(f)).toMatchObject({ parcela_percentual: '0.5', parcela_ancora: 'fim' })
    expect(formDoConfig({ ...cfg, parcela_percentual: 1 }).distribuicao).toBe('pontual')
  })
})
