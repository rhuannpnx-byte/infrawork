import type { ViagemLocal } from '@/core/db/entities'
import { formatNumero } from '@/lib/datas'

/**
 * Total das viagens com a unidade ("36 m³"). Só soma quando todas têm a mesma unidade: com m³ e t na mesma ficha
 * devolve `null` e a tela mostra só a contagem.
 */
export function totalDasViagens(
  viagens: Pick<ViagemLocal, 'quantidade' | 'unidade'>[],
): string | null {
  const unidades = new Set(viagens.map((v) => (v.unidade ?? '').trim().toLowerCase()))
  if (viagens.length === 0 || unidades.size !== 1) return null
  const total = viagens.reduce((s, v) => s + v.quantidade, 0)
  if (!(total > 0)) return null
  return `${formatNumero(total, 2)} ${viagens[0]!.unidade ?? ''}`.trim()
}
