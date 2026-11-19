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
    expect(r[2]).toEqual([263, 45])
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

  it('início-início sai do início da predecessora; término-término chega no fim da sucessora', () => {
    expect(rotaDaLigacao('II', pred, caixa(300, 380, 50))[0]).toEqual([100, 10])
    const tt = rotaDaLigacao('TT', pred, caixa(120, 300, 50))
    expect(tt[tt.length - 1]).toEqual([300, 50])
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
