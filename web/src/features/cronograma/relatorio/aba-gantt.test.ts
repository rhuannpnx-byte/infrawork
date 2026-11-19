import { describe, expect, it } from 'vitest'
import { criarGrade } from '@/lib/excel/desenho-xlsx'
import { escalaDoPlano, rotaDaLigacao } from './aba-gantt'

describe('escala da grade do Gantt', () => {
  it('começa na segunda-feira da semana do início', () => {
    // 01/12/2026 é terça-feira
    const e = escalaDoPlano('2026-12-01', '2028-09-27')
    expect(new Date(e.inicioMs).toISOString().slice(0, 10)).toBe('2026-11-30')
    expect(new Date(e.inicioMs).getUTCDay()).toBe(1)
  })

  it('plano longo usa uma coluna por semana; plano curto, uma por dia', () => {
    const longo = escalaDoPlano('2026-12-01', '2028-09-27')
    expect(longo.diasPorColuna).toBe(7)
    expect(longo.colunas * 7).toBeGreaterThanOrEqual(667)
    const curto = escalaDoPlano('2027-03-01', '2027-04-30')
    expect(curto.diasPorColuna).toBe(1)
    expect(curto.colunas % 7).toBe(0)
    expect(curto.colunas).toBeGreaterThanOrEqual(61)
  })
})

describe('seta da predecessora', () => {
  const pred = { x0: 100, x1: 200, yMeio: 10 }
  const caixa = (x0: number, x1: number, y: number): Parameters<typeof rotaDaLigacao>[2] => ({
    x0,
    x1,
    yMeio: y,
    yTopo: y - 5,
    yBase: y + 5
  })

  it('término-início com folga: sai do fim, anda e desce no início da sucessora', () => {
    const r = rotaDaLigacao('TI', pred, caixa(260, 340, 50))
    expect(r[0]).toEqual([200, 10])
    expect(r).toHaveLength(3)
    expect(r[2]).toEqual([264, 45])
  })

  it('sucessora que começa antes do fim da predecessora: contorna e entra de lado', () => {
    const r = rotaDaLigacao('TI', pred, caixa(150, 240, 50))
    expect(r).toHaveLength(6)
    expect(r[0]).toEqual([200, 10])
    expect(r[r.length - 1]).toEqual([150, 50])
    // só trechos horizontais ou verticais
    for (let i = 1; i < r.length; i++)
      expect(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1]).toBe(true)
  })

  it('início-início: sai pela esquerda e entra pela esquerda, na altura do meio da barra', () => {
    const ii = rotaDaLigacao('II', pred, caixa(300, 380, 50))
    expect(ii).toEqual([
      [100, 10],
      [92, 10],
      [92, 50],
      [300, 50]
    ])
  })

  it('término-término: sai pela direita e entra pela direita da sucessora', () => {
    const tt = rotaDaLigacao('TT', pred, caixa(120, 300, 50))
    expect(tt).toEqual([
      [200, 10],
      [308, 10],
      [308, 50],
      [300, 50]
    ])
  })

  it('o último trecho antes da ponta tem ao menos 8 px, em todos os tipos', () => {
    for (const tipo of ['TI', 'II', 'TT', 'IT', 'EST'] as const)
      for (const suc of [
        caixa(150, 240, 50),
        caixa(260, 340, 50),
        caixa(20, 80, 50),
        caixa(20, 80, -30)
      ]) {
        const r = rotaDaLigacao(tipo, pred, suc)
        const [a, b] = r.slice(-2)
        expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeGreaterThanOrEqual(8)
        for (let i = 1; i < r.length; i++)
          expect(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1]).toBe(true)
      }
  })
})

describe('grade da aba', () => {
  it('converte pixel em âncora de célula com deslocamento', () => {
    const g = criarGrade([40, 60, 28, 28], [20, 20, 20])
    expect(g.ancora(0, 0)).toEqual({ col: 0, dx: 0, lin: 0, dy: 0 })
    expect(g.ancora(105, 25)).toEqual({ col: 2, dx: 5, lin: 1, dy: 5 })
    expect(g.xDaColuna(2)).toBe(100)
    expect(g.yDaLinha(2)).toBe(40)
  })
})
