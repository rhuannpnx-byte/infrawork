import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { useBaseline, useTarefas } from '@/features/planejamento/hooks'
import type { OpcoesCurvaS } from '@/features/planejamento/hooks/cronograma'
import type { Planejamento } from '@/types/planejamento'
import {
  montarCurvaValorAgregado,
  montarComparativoPorServico,
  montarMedicao,
  criarValorizacao,
  producaoLimitada,
  type HistoricoPrecos,
  type CurvaSDiaRow,
  type EapGrupo,
  type ValorAgregadoBucket,
  type ComparativoServico,
  type MedicaoRow
} from '../lib/valor-agregado-calc'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Leitura usada pela tela e pelo MCP. */
export async function carregarCurvaSDia(obraId: string): Promise<CurvaSDiaRow[]> {
  // a API devolve no máximo 1000 linhas por chamada: pagina (a CO.081 já passa de 1800)
  const out: CurvaSDiaRow[] = []
  const passo = 1000
  for (let de = 0; ; de += passo) {
    const { data, error } = await supabase
      .from('vw_acompanhamento_curva_s')
      .select('item_orcamentario_id, data, planejado_dia, realizado_dia')
      .eq('obra_id', obraId)
      .order('item_orcamentario_id')
      .order('data')
      .range(de, de + passo - 1)
    if (error) throw error
    out.push(...((data ?? []) as unknown as CurvaSDiaRow[]))
    if (!data || data.length < passo) break
  }
  return out
}

/** Leitura usada pela tela e pelo MCP. */
export async function carregarEapGrupos(obraId: string): Promise<EapGrupo[]> {
  const [itens, alocs] = await Promise.all([
    lerTodas<Record<string, unknown>>((de, ate) =>
      supabase
        .from('item_orcamentario')
        .select(
          'id, codigo, descricao, tipo, quantidade, venda_unitaria, quantidade_referencia, unidade, unidade_referencia, custo_unitario_calc'
        )
        .eq('obra_id', obraId)
        .in('tipo', ['servico_grupo', 'receita'])
        .order('codigo', { ascending: true })
        .order('id')
        .range(de, ate)
    ),
    lerTodas<Record<string, unknown>>((de, ate) =>
      supabase
        .from('item_orc_alocacao')
        .select('grupo_id, receita_id, fracao')
        .eq('obra_id', obraId)
        .order('id')
        .range(de, ate)
    )
  ])
  const receitas = new Map(
    itens.filter((i) => i.tipo === 'receita').map((r) => [r.id as string, r])
  )
  return itens
    .filter((i) => i.tipo === 'servico_grupo')
    .map((g) => ({
      id: g.id as string,
      codigo: (g.codigo as string) ?? '',
      descricao: (g.descricao as string) ?? '',
      quantidade_referencia: Number(g.quantidade_referencia ?? 0),
      unidade_referencia: (g.unidade_referencia as string) ?? '',
      custo_unitario: Number(g.custo_unitario_calc ?? 0),
      filhos: alocs
        .filter((a) => a.grupo_id === g.id && receitas.has(a.receita_id as string))
        .map((a) => {
          const c = receitas.get(a.receita_id as string)!
          return {
            id: c.id as string,
            codigo: (c.codigo as string) ?? '',
            descricao: (c.descricao as string) ?? '',
            unidade: (c.unidade as string) ?? '',
            quantidade: Number(c.quantidade ?? 0) * Number(a.fracao ?? 0),
            venda_unitaria: Number(c.venda_unitaria ?? 0)
          }
        })
        .sort((x, y) => x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true }))
    }))
}

/** Leitura usada pela tela e pelo MCP. */
export async function carregarHistoricoPrecos(obraId: string): Promise<HistoricoPrecos> {
  const [rj, itens] = await Promise.all([
    supabase
      .from('orcamento_reajuste')
      .select('id, data')
      .eq('obra_id', obraId)
      .eq('status', 'aplicado'),
    lerTodas<Record<string, unknown>>((de, ate) =>
      supabase
        .from('orcamento_reajuste_item')
        .select('reajuste_id, receita_id, preco_antes')
        .eq('obra_id', obraId)
        .not('preco_antes', 'is', null)
        .order('reajuste_id')
        .order('receita_id')
        .range(de, ate)
    )
  ])
  if (rj.error) throw rj.error
  const dataDe = new Map((rj.data ?? []).map((r) => [r.id as string, r.data as string]))
  const m: HistoricoPrecos = new Map()
  for (const i of itens) {
    const data = dataDe.get(i.reajuste_id as string)
    if (!data) continue
    const arr = m.get(i.receita_id as string) ?? []
    arr.push({ data, preco_antes: Number(i.preco_antes) })
    m.set(i.receita_id as string, arr)
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.data < b.data ? -1 : 1))
  return m
}

/** Produção real/planejada por item/dia (vw_acompanhamento_curva_s). */
export function useCurvaSDia(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<CurvaSDiaRow[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'valor-agregado', 'curva-s-dia', obraId],
    enabled: !!obraId,
    staleTime: 30_000,
    queryFn: () => carregarCurvaSDia(obraId!)
  })
}

/**
 * EAP da obra: serviços (servico_grupo) + receitas da planilha de venda
 * alocadas a cada um. Receita rateada aparece em cada serviço com a parte
 * dela (quantidade × fração), então a medição se reparte entre os serviços.
 */
export function useEapGrupos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<EapGrupo[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'valor-agregado', 'eap', obraId],
    enabled: !!obraId,
    staleTime: 60_000,
    queryFn: () => carregarEapGrupos(obraId!)
  })
}

/** Preço anterior de cada receita em cada reajuste aplicado (reajuste é datado). */
export function useHistoricoPrecos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<HistoricoPrecos>> {
  return useQuery({
    queryKey: ['acompanhamento', 'valor-agregado', 'historico-precos', obraId],
    enabled: !!obraId,
    staleTime: 60_000,
    queryFn: () => carregarHistoricoPrecos(obraId!)
  })
}

/** Perfil diário do cronograma (o cálculo grava a quantidade por dia de trabalho de cada tarefa). */
function usePerfilDiaDoPlano(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<Map<string, { dia: string; quantidade: number }[]>>> {
  return useQuery({
    queryKey: ['planejamento', 'perfil-dia', planejamentoId],
    enabled: !!planejamentoId,
    staleTime: 60_000,
    queryFn: async () => {
      const m = new Map<string, { dia: string; quantidade: number }[]>()
      const passo = 1000
      for (let de = 0; ; de += passo) {
        const { data, error } = await supabase
          .from('planejamento_tarefa_perfil_dia')
          .select('tarefa_id, dia, quantidade, planejamento_tarefa!inner(planejamento_id)')
          .eq('planejamento_tarefa.planejamento_id', planejamentoId!)
          .order('tarefa_id')
          .order('dia')
          .range(de, de + passo - 1)
        if (error) throw new Error(error.message)
        for (const r of data ?? []) {
          const l = m.get(r.tarefa_id as string) ?? []
          l.push({ dia: String(r.dia), quantidade: Number(r.quantidade) })
          m.set(r.tarefa_id as string, l)
        }
        if (!data || data.length < passo) break
      }
      return m
    }
  })
}

/**
 * Opções da curva-S de um plano: reajuste datado na venda, repartido pelo perfil diário do cronograma. Linha de
 * base: fator = preço do dia ÷ preço quando foi travada. Plano em edição (venda ao vivo, já reajustada): fator =
 * preço do dia ÷ preço atual — os dias antes de um reajuste ficam ao preço antigo. Sem reajuste, nada a carregar.
 */
export function useOpcoesCurvaS(plano: Planejamento | null | undefined): OpcoesCurvaS {
  const obraId = plano?.obra_id ?? null
  const { data: grupos } = useEapGrupos(obraId)
  const { data: hist } = useHistoricoPrecos(obraId)
  const comReajuste = !!hist && hist.size > 0
  const { data: perfilDia } = usePerfilDiaDoPlano(comReajuste ? plano?.id : null)
  return useMemo(() => {
    if (!plano || !grupos || !hist || hist.size === 0) return {}
    const base = plano.is_baseline
      ? (plano.travada_em ?? plano.updated_at ?? plano.created_at).slice(0, 10)
      : '9999-12-31'
    return { perfilDia, fatorVenda: criarValorizacao(grupos, hist, base).fatorPlan }
  }, [plano, grupos, hist, perfilDia])
}

export interface ValorAgregadoFiltrosArg {
  de: string
  ate: string
  servicoItemId: string | null
}

export interface ValorAgregadoResultado {
  curva: ValorAgregadoBucket[]
  comparativo: ComparativoServico[]
  medicao: MedicaoRow[]
  /** Opções para o filtro de serviço (agregadores). */
  listaServicos: Array<{ id: string; label: string }>
  /** EAP (agregadores + filhos receita) — base das memórias de cálculo no export. */
  grupos: EapGrupo[]
  /** Produção real/planejada por item/dia — base das memórias e da projetada. */
  curvaSRows: CurvaSDiaRow[]
  /** Executado além da quantidade do serviço no contrato (não agrega valor). */
  prateleira: Array<{
    id: string
    codigo: string
    descricao: string
    unidade: string
    excedente: number
  }>
  /** Sem vigente: a régua é a última linha de base que foi vigente. */
  referenciaProvisoria: boolean
  isLoading: boolean
  semBaseline: boolean
}

export function useValorAgregado(
  obraId: string | null | undefined,
  filtros: ValorAgregadoFiltrosArg
): ValorAgregadoResultado {
  const { data: baseline, isLoading: loadingBaseline } = useBaseline(obraId)
  const { data: tarefas = [], isLoading: loadingTarefas } = useTarefas(baseline?.id)
  const { data: curvaSRows = [], isLoading: loadingCurva } = useCurvaSDia(obraId)
  const { data: grupos = [], isLoading: loadingEap } = useEapGrupos(obraId)
  const { data: hist = new Map() as HistoricoPrecos, isLoading: loadingHist } =
    useHistoricoPrecos(obraId)
  const valorizacao = useMemo(
    () => criarValorizacao(grupos, hist, baseline?.travada_em?.slice(0, 10) ?? null),
    [grupos, hist, baseline?.travada_em]
  )

  const { servicoItemId, de, ate } = filtros

  // Aplica o filtro de serviço (servico_grupo) a tarefas/produção/EAP.
  const tarefasF = useMemo(
    () =>
      servicoItemId
        ? tarefas.filter((t) => t.is_indireto || t.item_orcamentario_id === servicoItemId)
        : tarefas,
    [tarefas, servicoItemId]
  )
  const curvaSF = useMemo(
    () =>
      servicoItemId
        ? curvaSRows.filter((r) => r.item_orcamentario_id === servicoItemId)
        : curvaSRows,
    [curvaSRows, servicoItemId]
  )
  const gruposF = useMemo(
    () => (servicoItemId ? grupos.filter((g) => g.id === servicoItemId) : grupos),
    [grupos, servicoItemId]
  )

  const hoje = todayIso()

  const curva = useMemo(
    () => montarCurvaValorAgregado({ tarefas: tarefasF, curvaSRows: curvaSF, hoje, valorizacao }),
    [tarefasF, curvaSF, hoje, valorizacao]
  )
  const comparativo = useMemo(
    () =>
      montarComparativoPorServico({ tarefas: tarefasF, curvaSRows: curvaSF, de, ate, valorizacao }),
    [tarefasF, curvaSF, de, ate, valorizacao]
  )
  const medicao = useMemo(
    () =>
      montarMedicao({
        grupos: gruposF,
        tarefas: tarefasF,
        curvaSRows: curvaSF,
        de,
        ate,
        incluirIndireto: !servicoItemId,
        hist
      }),
    [gruposF, tarefasF, curvaSF, de, ate, servicoItemId, hist]
  )

  const listaServicos = useMemo(
    () =>
      grupos
        .map((g) => ({ id: g.id, label: `${g.codigo} — ${g.descricao}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [grupos]
  )

  const prateleira = useMemo(() => {
    const { excedente } = producaoLimitada(curvaSF, valorizacao.qtdServico)
    return gruposF
      .filter((g) => (excedente.get(g.id) ?? 0) > 0)
      .map((g) => ({
        id: g.id,
        codigo: g.codigo,
        descricao: g.descricao,
        unidade: g.unidade_referencia,
        excedente: excedente.get(g.id) ?? 0
      }))
  }, [curvaSF, gruposF, valorizacao])

  return {
    curva,
    comparativo,
    medicao,
    listaServicos,
    grupos,
    curvaSRows,
    prateleira,
    referenciaProvisoria: !!baseline?.provisoria,
    isLoading: loadingBaseline || loadingTarefas || loadingCurva || loadingEap || loadingHist,
    semBaseline: !loadingBaseline && !baseline
  }
}
