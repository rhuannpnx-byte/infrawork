/**
 * Quantidade de cada serviço em cada local (a soma das faixas da versão atual), com o total nos locais, o orçado e
 * o que ainda não foi para nenhum local. Unidades diferentes ficam em linhas diferentes: nada soma entre serviços.
 */
import type { SegmentoValores } from '@/lib/quantidades/segmentos'

export interface ServicoQuantidade {
  id: string
  codigo: string
  descricao: string
  unidade: string
  /** quantidade orçada do serviço */
  quantidade: number
}

export interface LinhaPorLocal {
  servico: ServicoQuantidade
  /** id do local → quantidade (só os locais com quantidade) */
  porLocal: Map<string, number>
  nosLocais: number
  /** orçado − nos locais (negativo: os locais passam do orçado) */
  semLocal: number
}

/** Diferença que é só arredondamento (as células têm até 3 casas). */
const TOL = 0.0005

export function quantidadesPorLocal(
  servicos: ServicoQuantidade[],
  segmentosPorLocal: Map<string, SegmentoValores[]>
): LinhaPorLocal[] {
  const total = new Map<string, Map<string, number>>()
  for (const [local, segs] of segmentosPorLocal)
    for (const s of segs)
      for (const [item, v] of Object.entries(s.valores)) {
        if (!(v > 0)) continue
        const m = total.get(item) ?? new Map<string, number>()
        m.set(local, (m.get(local) ?? 0) + v)
        total.set(item, m)
      }
  return servicos
    .filter((s) => s.quantidade > TOL || total.has(s.id))
    .map((servico) => {
      const porLocal = total.get(servico.id) ?? new Map<string, number>()
      const nosLocais = [...porLocal.values()].reduce((a, v) => a + v, 0)
      const semLocal = servico.quantidade - nosLocais
      return { servico, porLocal, nosLocais, semLocal: Math.abs(semLocal) < TOL ? 0 : semLocal }
    })
}
