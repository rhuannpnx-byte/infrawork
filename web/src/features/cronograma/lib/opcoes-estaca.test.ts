import { describe, expect, it } from 'vitest'
import { estacaDigitada, opcoesEstaca } from './opcoes-estaca'
import type { TrechoEntrada } from '../motor/tipos'

// CO.366: "km" de marco de 1.005,679 m, do km 303,4 em diante, 99.461,62 m de eixo
const co366: TrechoEntrada = {
  id: 't',
  nome: 'BR-174/MT',
  tipo: 'eixo',
  comprimento_m: 99461.62,
  exib: {
    cor: '#000',
    unidade_espaco_padrao: 'custom',
    unidade_custom_label: 'km',
    unidade_custom_divisor_m: 1005.679,
    marcador_valor_inicial: 303.4,
    geometry_sentido: 'natural'
  }
}

describe('estacas para escolher', () => {
  it('início, fim e cada km redondo do local', () => {
    const ops = opcoesEstaca(co366, [], 'srv')
    expect(ops[0]).toMatchObject({ m: 0, rotulo: 'km 303,400' })
    expect(ops[1]!.rotulo).toBe('km 304,000')
    expect(ops[ops.length - 1]!.rotulo).toBe('km 402,300')
    expect(ops).toHaveLength(2 + 99) // km 304 a 402
  })

  it('bordas das faixas da planilha onde o serviço tem quantidade', () => {
    const segs = [
      { ini: 0, fim: 1005.679 * 0.6, label_ini: '', label_fim: '', valores: { srv: 120 } },
      { ini: 1005.679 * 0.6, fim: 5000, label_ini: '', label_fim: '', valores: { outro: 5 } }
    ]
    const ops = opcoesEstaca(co366, segs, 'srv')
    expect(ops[1]!.rotulo).toBe('km 304,000')
    expect(ops).toHaveLength(2 + 99)
    expect(ops.some((o) => Math.abs(o.m - 5000) < 0.01)).toBe(false)
  })

  it('numeração decrescente também cai nos km redondos', () => {
    const inv = {
      ...co366,
      exib: {
        ...co366.exib!,
        marcador_valor_inicial: 402.3,
        geometry_sentido: 'invertido' as const
      }
    }
    const ops = opcoesEstaca(inv, [], 'srv')
    expect(ops[0]!.rotulo).toBe('km 402,300')
    expect(ops[1]!.rotulo).toBe('km 402,000')
  })

  it('estaca digitada vale só dentro do local', () => {
    expect(estacaDigitada('km 320,5', co366)?.rotulo).toBe('km 320,500')
    expect(estacaDigitada('km 300', co366)).toBeNull()
  })
})
