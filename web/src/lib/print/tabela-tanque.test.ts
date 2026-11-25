import { describe, expect, it } from 'vitest'
import { arranjoDaFolha, htmlTabelaTanque, type LinhaFolhaTanque } from './tabela-tanque'

// altura que sobra para a tabela na página A4 (277 mm úteis − 95 mm de cabeçalho, ábaco e rodapé)
const ALTURA_TABELA = 182

const linhas = (n: number): LinhaFolhaTanque[] =>
  Array.from({ length: n }, (_, i) => ({ leitura: i, litros: i * 120, litrosPorCm: i ? 120 : 0 }))

describe('folha do tanque numa página', () => {
  it('a tabela inteira cabe na altura da página, para qualquer altura de tanque', () => {
    for (const n of [51, 101, 201, 251, 301, 321, 451, 601, 661, 901, 1201, 2001]) {
      const a = arranjoDaFolha(n)
      const naTabela = Math.ceil(n / a.passoCm) + (a.passoCm > 1 ? 1 : 0)
      expect(a.colunas * a.linhasPorColuna).toBeGreaterThanOrEqual(naTabela)
      expect(a.alturaLinha * (a.linhasPorColuna + 1)).toBeLessThanOrEqual(ALTURA_TABELA + 1e-6)
    }
  })
  it('tanque comum sai centímetro a centímetro; só o muito alto sai de 2 em 2 ou de 5 em 5', () => {
    expect(arranjoDaFolha(251).passoCm).toBe(1)
    expect(arranjoDaFolha(451).passoCm).toBe(1)
    expect(arranjoDaFolha(661).passoCm).toBe(2)
    expect(arranjoDaFolha(2001).passoCm).toBe(5)
  })
  it('a linha nunca fica menor que o legível', () => {
    for (const n of [251, 451, 661, 1201, 2001])
      expect(arranjoDaFolha(n).alturaLinha).toBeGreaterThan(1.9)
  })
  it('o HTML traz todas as leituras do passo e avisa quando não é de 1 em 1 cm', () => {
    const base = {
      obra: 'Obra',
      tanque: 'T1',
      material: 'CAP',
      formato: 'Cilíndrico',
      medidas: 'Ø 250',
      capacidadeLitros: 30000,
      leituraPor: 'cheio' as const,
      alturaReferenciaCm: null
    }
    const comum = htmlTabelaTanque({ ...base, linhas: linhas(251) })
    expect((comum.match(/<tr/g) ?? []).length).toBe(251 + 4)
    expect(comum).not.toMatch(/para caber numa página/)
    const alto = htmlTabelaTanque({ ...base, linhas: linhas(661) })
    expect(alto).toMatch(/de 2 em 2 cm para caber numa página/)
    // a última leitura entra mesmo quando não cai no passo
    expect(alto).toMatch(/<td>660<\/td>/)
  })
})
