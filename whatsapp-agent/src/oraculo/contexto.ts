// Monta o contexto compacto por obra para o Oráculo (resumos, não dumps).
// Tudo escopado por obra_id. Reaproveita as mesmas views do dashboard de
// acompanhamento (o agente consulta direto via service_role).

import { supabase } from '../supabase.js'

export interface ContextoObra {
  orcamento: Record<string, unknown> | null
  producao: Record<string, unknown> | null
  planejamento: {
    data_inicio: string | null
    data_fim: string | null
    total_tarefas: number
    tarefas_criticas: number
  } | null
}

/** Resumo de orçamento + produção + planejamento de UMA obra, em formato enxuto
 *  para alimentar o LLM sem estourar tokens. */
export async function montarContexto(obraId: string): Promise<ContextoObra> {
  const [orc, prod, plan] = await Promise.all([
    supabase
      .from('vw_orcamento_consolidado')
      .select(
        'venda_total, custo_direto_real, custo_indireto_total, custo_total, impostos, lucro_liquido, lucratividade_perc'
      )
      .eq('obra_id', obraId)
      .maybeSingle(),
    supabase
      .from('vw_acompanhamento_obra_resumo')
      .select(
        'avanco_pct, producao_30d_qtd, producao_30d_registros, dias_com_apontamento, equipes_ativas_hoje, equipes_ativas_semana, fotos_total, fotos_com_geo, alertas_criticos, alertas_abertos_total, ultimo_sync_em'
      )
      .eq('obra_id', obraId)
      .maybeSingle(),
    supabase
      .from('vw_planejamento_tarefa_completa')
      .select('data_inicio, data_fim, is_critico, tipo_no')
      .eq('obra_id', obraId)
      .eq('is_baseline', true)
  ])

  let planejamento: ContextoObra['planejamento'] = null
  const tarefas = (plan.data ?? []).filter(
    (t) => (t as { tipo_no?: string }).tipo_no !== 'grupo'
  )
  if (tarefas.length > 0) {
    const inicios = tarefas
      .map((t) => (t as { data_inicio: string | null }).data_inicio)
      .filter(Boolean) as string[]
    const fins = tarefas
      .map((t) => (t as { data_fim: string | null }).data_fim)
      .filter(Boolean) as string[]
    planejamento = {
      data_inicio: inicios.length ? inicios.sort()[0] : null,
      data_fim: fins.length ? fins.sort()[fins.length - 1] : null,
      total_tarefas: tarefas.length,
      tarefas_criticas: tarefas.filter((t) => (t as { is_critico?: boolean }).is_critico).length
    }
  }

  return {
    orcamento: orc.data ?? null,
    producao: prod.data ?? null,
    planejamento
  }
}
