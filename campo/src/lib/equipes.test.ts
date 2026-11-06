import { describe, expect, it } from 'vitest'
import { equipesDoEncarregado, temEquipesVinculadas } from './equipes'

const equipes = [
  { id: 'a', nome: 'Terraplenagem 01', encarregado_id: 'joao' },
  { id: 'b', nome: 'Terraplenagem 02', encarregado_id: 'joao' },
  { id: 'c', nome: 'Drenagem', encarregado_id: 'maria' },
  { id: 'd', nome: 'Apoio', encarregado_id: null },
  { id: 'e', nome: 'Sinalização' },
]
const ids = (l: { id: string }[]) => l.map((e) => e.id)

describe('equipes do encarregado', () => {
  it('mostra só as equipes do encarregado', () => {
    expect(ids(equipesDoEncarregado(equipes, 'joao'))).toEqual(['a', 'b'])
    expect(ids(equipesDoEncarregado(equipes, 'maria'))).toEqual(['c'])
  })
  it('encarregado sem equipe vinculada vê as equipes sem encarregado', () => {
    expect(ids(equipesDoEncarregado(equipes, 'pedro'))).toEqual(['d', 'e'])
    expect(temEquipesVinculadas(equipes, 'pedro')).toBe(false)
    expect(temEquipesVinculadas(equipes, 'joao')).toBe(true)
  })
  it('sem encarregado, as equipes sem encarregado', () => {
    expect(ids(equipesDoEncarregado(equipes, null))).toEqual(['d', 'e'])
  })
  it('catálogo antigo (sem vínculo) mostra todas', () => {
    const antigo = equipes.map(({ id, nome }) => ({ id, nome }))
    expect(ids(equipesDoEncarregado(antigo, 'joao'))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
