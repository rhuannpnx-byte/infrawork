import { describe, expect, it } from 'vitest'
import {
  apontaEncarregado,
  encarregadoDaEquipe,
  equipesDoEncarregado,
  temEquipesVinculadas,
} from './equipes'
import type { CatalogoDto } from '@/types/dtos'

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

describe('obra que não aponta o encarregado', () => {
  const catalogo = (aponta?: boolean): CatalogoDto =>
    ({
      obra: { id: 'o', codigo: 'CO', nome: 'Obra', empresa_id: 'e', aponta_encarregado: aponta },
      equipes,
      encarregados: [
        { id: 'joao', nome: 'João', apelido: null },
        { id: 'maria', nome: 'Maria', apelido: 'Mari' },
      ],
    }) as unknown as CatalogoDto

  it('aponta por padrão: sem catálogo, catálogo antigo (sem o campo) e opção ligada', () => {
    expect(apontaEncarregado(null)).toBe(true)
    expect(apontaEncarregado(undefined)).toBe(true)
    expect(apontaEncarregado(catalogo())).toBe(true)
    expect(apontaEncarregado(catalogo(true))).toBe(true)
  })
  it('só deixa de apontar quando a obra desliga a opção', () => {
    expect(apontaEncarregado(catalogo(false))).toBe(false)
  })
  it('o encarregado vem da equipe escolhida, quando ela tem um', () => {
    expect(encarregadoDaEquipe(catalogo(false), 'a')).toEqual({ id: 'joao', nome: 'João' })
    expect(encarregadoDaEquipe(catalogo(false), 'c')).toEqual({ id: 'maria', nome: 'Maria' })
    expect(encarregadoDaEquipe(catalogo(false), 'd')).toBeNull()
    expect(encarregadoDaEquipe(catalogo(false), null)).toBeNull()
    expect(encarregadoDaEquipe(null, 'a')).toBeNull()
  })
})
