/**
 * Escopo distribuído: quanto da quantidade orçada de cada serviço (agrupador do orçamento) já está em tarefas do
 * plano. Serviços têm unidades diferentes, então o total da obra sai em valor (R$), nunca somando quantidades.
 */
import type { TarefaEntrada } from '../motor/tipos'

export interface ItemEscopo {
  id: string
  codigo: string
  descricao: string
  unidade: string | null
  quantidade_referencia: number
  venda_total: number | null
  indireto_id: string | null
}

/** `sem`: nenhuma tarefa; `parcial`: falta distribuir; `completo`; `acima`: as tarefas passam do orçado. */
export type EstadoEscopo = 'sem' | 'parcial' | 'completo' | 'acima'

export interface TarefaDoEscopo {
  id: string
  nome: string
  /** tarefa-resumo em que a tarefa está (para distinguir tarefas de mesmo nome) */
  grupo: string | null
  quantidade: number
}

export interface LinhaEscopo {
  id: string
  codigo: string
  descricao: string
  unidade: string | null
  orcado: number
  distribuido: number
  /** orçado − distribuído; negativo quando as tarefas passam do orçado */
  saldo: number
  /** distribuído ÷ orçado (pode passar de 1) */
  fracao: number
  estado: EstadoEscopo
  tarefas: TarefaDoEscopo[]
}

export interface ResumoEscopo {
  linhas: LinhaEscopo[]
  /** venda dos serviços com quantidade orçada */
  valorOrcado: number
  /** venda já coberta por tarefas (o que passa do orçado não conta) */
  valorDistribuido: number
  /** `null` quando o orçamento não tem venda */
  fracaoValor: number | null
  contagem: Record<EstadoEscopo, number>
  /** tarefas de serviço sem agrupador do orçamento: não entram na conta */
  tarefasSemItem: number
}

/** Diferença que é só arredondamento (as quantidades têm até 6 casas). */
const tolerancia = (orcado: number): number => 0.00005 + Math.abs(orcado) * 1e-9

export function estadoDoEscopo(orcado: number, distribuido: number): EstadoEscopo {
  const tol = tolerancia(orcado)
  if (distribuido <= tol) return orcado <= tol ? 'completo' : 'sem'
  if (Math.abs(orcado - distribuido) <= tol) return 'completo'
  return distribuido > orcado ? 'acima' : 'parcial'
}

export function resumoDoEscopo(itens: ItemEscopo[], tarefas: TarefaEntrada[]): ResumoEscopo {
  const nomeDoGrupo = new Map<string, string>()
  for (const t of tarefas) if (t.tipo_no === 'grupo') nomeDoGrupo.set(t.id, t.nome)
  const porItem = new Map<string, TarefaDoEscopo[]>()
  let tarefasSemItem = 0
  for (const t of tarefas) {
    if (t.tipo_no !== 'tarefa' || t.is_indireto) continue
    if (!t.item_orcamentario_id) {
      tarefasSemItem++
      continue
    }
    const lista = porItem.get(t.item_orcamentario_id) ?? []
    lista.push({
      id: t.id,
      nome: t.nome,
      grupo: (t.parent_id && nomeDoGrupo.get(t.parent_id)) || null,
      quantidade: Number(t.quantidade) || 0
    })
    porItem.set(t.item_orcamentario_id, lista)
  }

  const contagem: Record<EstadoEscopo, number> = { sem: 0, parcial: 0, completo: 0, acima: 0 }
  let valorOrcado = 0
  let valorDistribuido = 0
  const linhas: LinhaEscopo[] = []
  for (const it of itens) {
    if (it.indireto_id) continue
    const doItem = porItem.get(it.id) ?? []
    const orcado = Number(it.quantidade_referencia) || 0
    const distribuido = doItem.reduce((s, x) => s + x.quantidade, 0)
    // agrupador sem quantidade e sem tarefa não é escopo a distribuir
    if (orcado <= 0 && doItem.length === 0) continue
    const estado = estadoDoEscopo(orcado, distribuido)
    contagem[estado]++
    const fracao = orcado > 0 ? distribuido / orcado : distribuido > 0 ? Infinity : 1
    if (orcado > 0 && it.venda_total != null) {
      valorOrcado += it.venda_total
      valorDistribuido += it.venda_total * Math.min(1, fracao)
    }
    linhas.push({
      id: it.id,
      codigo: it.codigo,
      descricao: it.descricao,
      unidade: it.unidade,
      orcado,
      distribuido,
      saldo: orcado - distribuido,
      fracao,
      estado,
      tarefas: doItem
    })
  }
  return {
    linhas,
    valorOrcado,
    valorDistribuido,
    fracaoValor: valorOrcado > 0 ? valorDistribuido / valorOrcado : null,
    contagem,
    tarefasSemItem
  }
}
