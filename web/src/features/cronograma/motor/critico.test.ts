import { describe, expect, it } from 'vitest'
import { ehCritica, limiteCritico } from './critico'

describe('caminho crítico', () => {
  it('plano que termina antes do prazo: críticas são as de menor folga (a distância até o prazo)', () => {
    const folgas = [391.3, 391.3, 394.7, 397.1, 482.5, 3102]
    const limite = limiteCritico(folgas)
    expect(limite).toBe(391.3)
    expect(folgas.map((f) => ehCritica(f, limite))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false
    ])
  })

  it('prazo estourado: crítica é toda tarefa sem folga (≤ 0)', () => {
    const folgas = [-40, -40, -10, 0, 12]
    const limite = limiteCritico(folgas)
    expect(limite).toBe(0)
    expect(folgas.map((f) => ehCritica(f, limite))).toEqual([true, true, true, true, false])
  })

  it('sem tarefas, nada é crítico', () => {
    expect(limiteCritico([])).toBeNull()
    expect(ehCritica(0, null)).toBe(false)
  })
})
