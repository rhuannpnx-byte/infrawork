// Composição de preço unitário (CPU) de um serviço da obra: produção diária,
// custo unitário e os insumos por grupo (equipamento, combustível, MO, material).
// Tudo escopado por obra_id (cpu.obra_id), respeitando a permissão.

import { supabase } from '../supabase.js'

interface CpuRow {
  id: string
  nome: string | null
  producao_diaria_qtde: number | null
  producao_diaria_unidade: string | null
  custo_unit_calc: number | null
  custo_eq_dia_calc: number | null
  custo_comb_dia_calc: number | null
  custo_mo_dia_calc: number | null
  custo_mat_dia_calc: number | null
  servico_id: string | null
}

export interface ComposicaoResultado {
  nao_encontrado?: boolean
  servicos_disponiveis?: string[]
  ambiguo?: boolean
  opcoes?: string[]
  servico?: { codigo: string | null; nome: string | null; unidade: string | null }
  producao_diaria?: string
  custo_unitario?: number | null
  custo_dia?: { equipamento: number; combustivel: number; mao_de_obra: number; material: number }
  itens?: Array<Record<string, unknown>>
}

export interface ServicoComCpu {
  codigo: string | null
  nome: string
  unidade: string | null
  producao_diaria: string | null
  custo_unitario: number | null
}

/** Lista todos os serviços da obra que têm CPU vigente (para "liste as composições"). */
export async function listarComposicoes(obraId: string): Promise<ServicoComCpu[]> {
  const { data: cpus } = await supabase
    .from('cpu')
    .select(
      'nome, producao_diaria_qtde, producao_diaria_unidade, custo_unit_calc, servico:servico_id(codigo, nome, unidade)'
    )
    .eq('obra_id', obraId)
    .eq('is_vigente', true)
  const out: ServicoComCpu[] = []
  for (const c of cpus ?? []) {
    const s = c.servico as { codigo?: string; nome?: string; unidade?: string } | null
    const nome = s?.nome ?? (c.nome as string) ?? ''
    if (!nome) continue
    out.push({
      codigo: s?.codigo ?? null,
      nome,
      unidade: s?.unidade ?? null,
      producao_diaria:
        c.producao_diaria_qtde != null
          ? `${c.producao_diaria_qtde} ${c.producao_diaria_unidade ?? ''}/dia`
          : null,
      custo_unitario: c.custo_unit_calc != null ? Number(c.custo_unit_calc) : null
    })
  }
  out.sort((a, b) => a.nome.localeCompare(b.nome))
  return out
}

export async function buscarComposicao(obraId: string, busca: string): Promise<ComposicaoResultado> {
  const q = busca.trim().toLowerCase().replace(/\b(servi[çc]o|aplica[çc][ãa]o|de|da|do)\b/g, '').trim()

  // CPUs vigentes da obra
  const { data: cpus } = await supabase
    .from('cpu')
    .select(
      'id, nome, producao_diaria_qtde, producao_diaria_unidade, custo_unit_calc, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, servico_id'
    )
    .eq('obra_id', obraId)
    .eq('is_vigente', true)
  const lista = (cpus ?? []) as CpuRow[]
  if (lista.length === 0) return { nao_encontrado: true, servicos_disponiveis: [] }

  // nomes de serviço para matching
  const servIds = [...new Set(lista.map((c) => c.servico_id).filter(Boolean))] as string[]
  const { data: servs } = await supabase
    .from('servico')
    .select('id, codigo, nome, unidade')
    .in('id', servIds.length ? servIds : ['00000000-0000-0000-0000-000000000000'])
  const servById = new Map(
    (servs ?? []).map((s) => [
      s.id as string,
      { codigo: s.codigo as string, nome: s.nome as string, unidade: s.unidade as string | null }
    ])
  )

  const rotulo = (c: CpuRow): string => servById.get(c.servico_id ?? '')?.nome ?? c.nome ?? ''
  const matches = lista.filter((c) => {
    const s = servById.get(c.servico_id ?? '')
    const alvo = `${s?.codigo ?? ''} ${s?.nome ?? ''} ${c.nome ?? ''}`.toLowerCase()
    return q.length > 0 && alvo.includes(q)
  })

  if (matches.length === 0) {
    return {
      nao_encontrado: true,
      servicos_disponiveis: [...new Set(lista.map(rotulo))].filter(Boolean).slice(0, 30)
    }
  }
  if (matches.length > 1) {
    return { ambiguo: true, opcoes: [...new Set(matches.map(rotulo))].filter(Boolean).slice(0, 15) }
  }

  const cpu = matches[0]
  const serv = servById.get(cpu.servico_id ?? '') ?? null

  // itens da CPU + recurso
  const { data: itensRaw } = await supabase
    .from('cpu_item')
    .select(
      'grupo, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, consumo_material_por_unid, custo_total_calc, recurso:recurso_id(id, codigo, nome, unidade)'
    )
    .eq('cpu_id', cpu.id)
    .order('grupo')
    .order('ordem')
  const itensList = (itensRaw ?? []) as Array<Record<string, unknown>>

  // preços vigentes dos recursos (por obra)
  const recIds = itensList
    .map((i) => (i.recurso as { id?: string } | null)?.id)
    .filter(Boolean) as string[]
  const precoById = new Map<string, number>()
  if (recIds.length) {
    const { data: precos } = await supabase
      .from('vw_recurso_com_preco')
      .select('id, preco_vigente')
      .in('id', recIds)
    for (const p of precos ?? []) {
      precoById.set(p.id as string, Number(p.preco_vigente) || 0)
    }
  }

  const itens = itensList.map((i) => {
    const r = (i.recurso as { id?: string; codigo?: string; nome?: string; unidade?: string } | null) ?? {}
    const out: Record<string, unknown> = {
      grupo: i.grupo,
      recurso: r.nome ?? r.codigo ?? '—',
      unidade: r.unidade ?? null,
      custo_unit_recurso: r.id ? (precoById.get(r.id) ?? null) : null,
      custo_total: i.custo_total_calc != null ? Number(i.custo_total_calc) : null
    }
    if (i.quantidade != null) out.quantidade = Number(i.quantidade)
    if (i.horas_dia != null) out.horas_dia = Number(i.horas_dia)
    if (i.consumo_combustivel_lh != null) out.consumo_comb_lh = Number(i.consumo_combustivel_lh)
    if (i.indice_produtividade != null) out.indice_produtividade = Number(i.indice_produtividade)
    if (i.consumo_material_por_unid != null)
      out.consumo_material_por_unid = Number(i.consumo_material_por_unid)
    return out
  })

  return {
    servico: serv ?? { codigo: null, nome: cpu.nome, unidade: null },
    producao_diaria:
      cpu.producao_diaria_qtde != null
        ? `${cpu.producao_diaria_qtde} ${cpu.producao_diaria_unidade ?? ''}/dia`
        : undefined,
    custo_unitario: cpu.custo_unit_calc != null ? Number(cpu.custo_unit_calc) : null,
    custo_dia: {
      equipamento: Number(cpu.custo_eq_dia_calc) || 0,
      combustivel: Number(cpu.custo_comb_dia_calc) || 0,
      mao_de_obra: Number(cpu.custo_mo_dia_calc) || 0,
      material: Number(cpu.custo_mat_dia_calc) || 0
    },
    itens
  }
}
