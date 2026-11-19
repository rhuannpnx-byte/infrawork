import { describe, expect, it } from 'vitest'
import {
  LARGURA_MINIMA,
  assinaturaCabecalho,
  comLargura,
  larguraPorColuna,
  normalizarRota
} from './colunas-ajustaveis'

describe('largura das colunas', () => {
  it('a rota vale para a tela, sem o id da obra ou do registro', () => {
    expect(normalizarRota('/gerencial/obras/45d4b153-a49f-4c52-906b-9f654fd423d0')).toBe(
      '/gerencial/obras/:id'
    )
    expect(normalizarRota('/orcamento/obra/plan-orc/')).toBe('/orcamento/obra/plan-orc')
    expect(normalizarRota('/')).toBe('/')
  })

  it('números do cabeçalho (contagens, datas) não mudam a assinatura', () => {
    expect(assinaturaCabecalho(['Serviços (24)', ' Data  12/11 '])).toBe(
      assinaturaCabecalho(['Serviços (3)', 'Data 01/02'])
    )
    expect(assinaturaCabecalho(['Código', 'Nome'])).not.toBe(
      assinaturaCabecalho(['Nome', 'Código'])
    )
  })

  it('a célula que junta colunas divide a largura entre elas', () => {
    expect(
      larguraPorColuna([
        { largura: 200, span: 1 },
        { largura: 240, span: 2 }
      ])
    ).toEqual([200, 120, 120])
  })

  it('nenhuma coluna fica abaixo do mínimo', () => {
    expect(larguraPorColuna([{ largura: 10, span: 1 }])).toEqual([LARGURA_MINIMA])
    expect(comLargura([100, 100], 1, 5)).toEqual([100, LARGURA_MINIMA])
    expect(comLargura([100, 100], 0, 180.4)).toEqual([180, 100])
  })
})
