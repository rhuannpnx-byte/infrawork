import type { ViagemLocal } from '@/core/db/entities'
import type { CatalogoDto } from '@/types/dtos'

/** O serviço é medido por peso? (A quantidade de cada viagem vem do ticket da balança.) */
export function servicoPorPeso(
  catalogo: CatalogoDto | null | undefined,
  servicoId: string | null | undefined,
): boolean {
  return catalogo?.servicos.find((s) => s.id === servicoId)?.medicao_viagem === 'peso'
}

/**
 * A quantidade com que a viagem nova já vem escrita: a capacidade do cadastro do caminhão (o apontador só muda quando
 * a carga foi diferente). Sem capacidade no cadastro, ou em serviço por peso, repete a da viagem anterior.
 */
export function quantidadeInicial(a: {
  capacidade: number | null | undefined
  porPeso: boolean
  anterior: number | null | undefined
}): number {
  if (!a.porPeso && a.capacidade != null && a.capacidade > 0) return a.capacidade
  return a.anterior ?? 0
}

/**
 * Troca a quantidade das viagens já lançadas por um valor só (a capacidade do cadastro ou o que o apontador digitou).
 * As de serviço por peso ficam como estão: cada uma tem o peso do seu ticket.
 */
export function aplicarQuantidade(
  viagens: ViagemLocal[],
  valor: number,
  porPeso: (v: ViagemLocal) => boolean,
): ViagemLocal[] {
  return viagens.map((v) => (porPeso(v) ? v : { ...v, quantidade: valor }))
}
