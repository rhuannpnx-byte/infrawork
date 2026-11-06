import { describe, expect, it } from 'vitest'
import { calcularDmt, pedeEstaca, type LocalDmt } from './dmt'

const EIXO = 'eixo-1'
const AREA = 'area-1'
const tipoTrecho = (id: string): 'eixo' | 'area' | null =>
  id === EIXO ? 'eixo' : id === AREA ? 'area' : null
const L = (p: Partial<LocalDmt> & { id: string; tipo: string }): LocalDmt => ({
  nome: p.id,
  trecho_id: EIXO,
  estaca_acesso_m: null,
  distancia_acesso_km: 0,
  ...p,
})
const jazida = L({ id: 'J1', tipo: 'jazida', estaca_acesso_m: 1000, distancia_acesso_km: 2.5 })
const caixa = L({
  id: 'CE',
  tipo: 'caixa_emprestimo',
  estaca_acesso_m: 3000,
  distancia_acesso_km: 0.3,
})
const pista = L({ id: 'P', tipo: 'pista' })
const usina = L({ id: 'U', tipo: 'usina', trecho_id: null })
const bota = L({ id: 'BF', tipo: 'bota_fora', trecho_id: null })
const rotas = [{ origem_id: 'U', destino_id: 'P', dmt_km: 18 }]
const dmt = (o: LocalDmt, d: LocalDmt, c: number | null, s: number | null) =>
  calcularDmt({ origem: o, destino: d, estacaCarga: c, estacaDescarga: s, rotas, tipoTrecho })

describe('DMT geométrica (mesma regra do banco)', () => {
  it('jazida com acesso → aterro na pista', () => {
    expect(dmt(jazida, pista, null, 6000)).toEqual({ km: 7.5, via: 'geometria', motivo: null })
  })
  it('corte → aterro pelas duas estacas', () => {
    expect(dmt(pista, pista, 1500, 4200)).toEqual({ km: 2.7, via: 'geometria', motivo: null })
  })
  it('caixa de empréstimo → aterro', () => {
    expect(dmt(caixa, pista, null, 3500).km).toBe(0.8)
  })
  it('distância fixa do par prevalece', () => {
    expect(dmt(usina, pista, null, 8000)).toEqual({ km: 18, via: 'rota', motivo: null })
  })
  it('sem estaca de acesso nem rota: orienta o cadastro', () => {
    const r = dmt(jazida, bota, null, null)
    expect(r.km).toBeNull()
    expect(r.motivo).toMatch(/estaca de acesso|distância fixa/)
  })
  it('pista sem estaca pede a estaca', () => {
    expect(dmt(jazida, pista, null, null).motivo).toBe('Informe a estaca de descarga.')
    expect(pedeEstaca(pista, tipoTrecho)).toBe(true)
    expect(pedeEstaca(L({ id: 'PA', tipo: 'pista', trecho_id: AREA }), tipoTrecho)).toBe(false)
  })
})
