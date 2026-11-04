/**
 * Filtro das visões (o filtro ativo por visão do ApeX): tarefa-resumo, trechos/áreas, serviços e equipes nomeadas.
 * Aplica-se à entrada do plano antes de montar o Gantt ou o tempo-caminho: ficam as tarefas que passam e os seus
 * ancestrais (tarefas-resumo), e só as dependências entre tarefas que ficaram.
 */
import type { PlanoEntrada, TarefaEntrada } from '../motor/tipos'

export interface FiltroVisao {
  /** tarefa-resumo (e tudo dentro dela); null = todas */
  resumo: string | null
  /** ids de trechos/áreas; '' = tarefas sem local; null/[] = todos */
  trechos: string[] | null
  /** ids de serviços (tipos); null/[] = todos */
  servicos: string[] | null
  /** ids de equipes nomeadas; null/[] = todas */
  equipes: string[] | null
}

export const SEM_LOCAL_FILTRO = ''

export const FILTRO_VAZIO: FiltroVisao = {
  resumo: null,
  trechos: null,
  servicos: null,
  equipes: null
}

export const filtroAtivo = (f: FiltroVisao | undefined): boolean =>
  !!f && !!(f.resumo || f.trechos?.length || f.servicos?.length || f.equipes?.length)

/** Quantos critérios estão em uso (o número do botão). */
export const criteriosAtivos = (f: FiltroVisao | undefined): number =>
  !f
    ? 0
    : (f.resumo ? 1 : 0) +
      (f.trechos?.length ? 1 : 0) +
      (f.servicos?.length ? 1 : 0) +
      (f.equipes?.length ? 1 : 0)

export function aplicarFiltro(e: PlanoEntrada, f: FiltroVisao | undefined): PlanoEntrada {
  if (!f || !filtroAtivo(f)) return e
  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  const ancestrais = (t: TarefaEntrada): string[] => {
    const out: string[] = []
    for (let x = t.parent_id; x; x = porId.get(x)?.parent_id ?? null) out.push(x)
    return out
  }
  const passa = (t: TarefaEntrada): boolean => {
    if (f.resumo && t.id !== f.resumo && !ancestrais(t).includes(f.resumo)) return false
    if (f.trechos?.length) {
      const ids = t.locais.map((l) => l.trecho_id).filter((x): x is string => !!x)
      const semLocal = ids.length === 0 && f.trechos.includes(SEM_LOCAL_FILTRO)
      if (!semLocal && !ids.some((id) => f.trechos!.includes(id))) return false
    }
    if (f.servicos?.length && !(t.servico_id && f.servicos.includes(t.servico_id))) return false
    if (f.equipes?.length && !t.equipes_ids.some((q) => f.equipes!.includes(q))) return false
    return true
  }
  const mantidas = new Set<string>()
  for (const t of e.tarefas) {
    if (t.tipo_no !== 'tarefa' || !passa(t)) continue
    mantidas.add(t.id)
    for (const a of ancestrais(t)) mantidas.add(a)
  }
  return {
    ...e,
    tarefas: e.tarefas.filter((t) => mantidas.has(t.id)),
    dependencias: e.dependencias.filter(
      (d) => mantidas.has(d.predecessora_id) && mantidas.has(d.sucessora_id)
    )
  }
}
