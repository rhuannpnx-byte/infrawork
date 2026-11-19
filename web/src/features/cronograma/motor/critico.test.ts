import { describe, expect, it } from 'vitest'
import { criterioCritico, ehCritica, limiteCritico } from './critico'
import type { PlanoEntrada } from './tipos'

const plano = (horas: number): Pick<PlanoEntrada, 'plano' | 'calendarios'> => ({
  plano: { calendario_id: 'c' } as PlanoEntrada['plano'],
  calendarios: [
    {
      id: 'c',
      nome: 'Obra',
      padrao: true,
      semana: Array.from({ length: 7 }, (_, i) => ({ inicio: '07:00', horas: i < 5 ? horas : 0 })),
      definicoes: []
    }
  ] as PlanoEntrada['calendarios']
})
const resultado = (folgas: number[]): { tarefas: Map<string, { folga_total_h: number }> } => ({
  tarefas: new Map(folgas.map((f, i) => [String(i), { folga_total_h: f }]))
})

describe('caminho crítico', () => {
  it('plano que termina antes do prazo: menor folga e as que passam dela em menos de um dia útil', () => {
    // folgas da CO.081 (REV.12): 391,3 h nas que puxam o término; 394,7 e 397,1 h também empurram o término
    // quando atrasadas (validado no motor); 451,4 h em diante não
    const folgas = [391.3, 391.3, 394.7, 397.1, 451.4, 482.5, 3102]
    const critica = criterioCritico(plano(8), resultado(folgas))
    expect(folgas.map(critica)).toEqual([true, true, true, true, false, false, false])
  })

  it('a tolerância é a jornada do calendário do plano', () => {
    expect(criterioCritico(plano(4), resultado([100, 103, 105])).call(null, 105)).toBe(false)
    expect(criterioCritico(plano(9), resultado([100, 103, 108.5])).call(null, 108.5)).toBe(true)
  })

  it('prazo estourado: crítica é toda tarefa sem folga (≤ 0) e as de menos de um dia', () => {
    const folgas = [-40, -40, -10, 0, 5, 12]
    expect(limiteCritico(folgas)).toBe(0)
    const critica = criterioCritico(plano(8), resultado(folgas))
    expect(folgas.map(critica)).toEqual([true, true, true, true, true, false])
  })

  it('sem tarefas, nada é crítico', () => {
    expect(limiteCritico([])).toBeNull()
    expect(ehCritica(0, null, 8)).toBe(false)
  })
})
