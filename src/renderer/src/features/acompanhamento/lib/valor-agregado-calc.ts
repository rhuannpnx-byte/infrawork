// Cálculo do "Valor Agregado" (Earned Value) do acompanhamento.
//
// Tudo client-side, reusando a MESMA lógica da Curva-S do planejamento
// (`calcularCurvaSemanal`) para a série planejada e a produção real por item/dia
// (`vw_acompanhamento_curva_s`) para as séries projetadas (valor do que foi
// efetivamente produzido).
//
// Regras de negócio (definidas com o usuário):
//   - Receita/Custo projetados = valor agregado ACUMULADO do que foi produzido
//     (qtd real × preço/custo unitário do item). A série projetada vai só até hoje.
//   - Indireto é IDÊNTICO em planejado e projetado (usuário não imputa indireto
//     real). Distribuído linearmente por semana ISO, igual à Curva-S.
//   - Impostos entram como CUSTO, calculados sobre o faturamento PROJETADO
//     (taxa efetiva derivada do planejamento: Σ custo_taxas / Σ receita).
//   - Medição: avanço do agregador (servico_grupo) no período é aplicado
//     proporcionalmente às quantidades dos filhos `receita` na EAP
//     (pct = qtd_real_no_período / quantidade_referencia).

import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import {
  calcularCurvaSemanal,
  segundaDaSemanaISO,
  semanasEntre
} from '@/features/planejamento/hooks/cronograma'

/** Linha diária de `vw_acompanhamento_curva_s` (subset usado aqui). */
export interface CurvaSDiaRow {
  item_orcamentario_id: string
  data: string
  planejado_dia: number | string | null
  realizado_dia: number | string | null
}

/** Filho `receita` de um agregador na EAP. */
export interface EapFilhoReceita {
  id: string
  codigo: string
  descricao: string
  unidade: string
  quantidade: number
  venda_unitaria: number
}

/** Agregador (`servico_grupo`) com seus filhos `receita`. */
export interface EapGrupo {
  id: string
  codigo: string
  descricao: string
  quantidade_referencia: number
  unidade_referencia: string
  filhos: EapFilhoReceita[]
}

export interface ValorAgregadoBucket {
  periodo: string
  receita_planejada_acum: number
  custo_planejado_acum: number
  /** null nas semanas futuras (sem produção). */
  receita_projetada_acum: number | null
  custo_projetado_acum: number | null
}

export interface ComparativoServico {
  item_orcamentario_id: string
  codigo: string
  descricao: string
  /** R$ planejado no período (qtd planejada × venda unit). */
  planejado: number
  /** R$ projetado no período (qtd real × venda unit). */
  projetado: number
}

export interface MedicaoRow {
  tipo: 'servico' | 'indireto'
  grupo_codigo: string
  grupo_descricao: string
  item_codigo: string
  item_descricao: string
  unidade: string
  /** Quantidade contratual do filho (referência). */
  qtd_contratual: number
  /** Avanço do agregador no período (0..1). */
  pct_avanco: number
  /** Quantidade medida no período = pct × qtd_contratual. */
  medicao_qtd: number
  venda_unitaria: number
  /** Valor medido no período = medicao_qtd × venda_unitaria. */
  medicao_valor: number
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Mapa item_orcamentario_id → { venda_unit, custo_unit } das tarefas diretas. */
function mapaPrecosDiretas(
  tarefas: PlanejamentoTarefaCompleta[]
): Map<string, { venda: number; custo: number; codigo: string; descricao: string }> {
  const m = new Map<string, { venda: number; custo: number; codigo: string; descricao: string }>()
  for (const t of tarefas) {
    if (t.is_indireto) continue
    const id = t.item_orcamentario_id
    if (!id || m.has(id)) continue
    m.set(id, {
      venda: num(t.venda_unitaria_item),
      custo: num(t.custo_unit_snapshot),
      codigo: t.servico_grupo_codigo ?? '',
      descricao: t.servico_grupo_descricao ?? ''
    })
  }
  return m
}

/** Taxa efetiva de imposto derivada do planejamento (Σ custo_taxas / Σ receita). */
export function taxaEfetivaImposto(tarefas: PlanejamentoTarefaCompleta[]): number {
  let receita = 0
  let taxas = 0
  for (const t of tarefas) {
    receita += num(t.receita_total_calc)
    taxas += num(t.custo_taxas_calc)
  }
  return receita > 0 ? taxas / receita : 0
}

export interface MontarCurvaInput {
  tarefas: PlanejamentoTarefaCompleta[]
  curvaSRows: CurvaSDiaRow[]
  /** Data de "hoje" (ISO) — limite da série projetada. */
  hoje: string
}

/**
 * Curva-S de valor agregado: planejada (receita+custo) sobre todas as semanas
 * do projeto + projetada (receita+custo, até hoje) reusando a lógica da Curva-S
 * do planejamento. Indireto idêntico nos dois; imposto projetado sobre o
 * faturamento projetado.
 */
export function montarCurvaValorAgregado(input: MontarCurvaInput): ValorAgregadoBucket[] {
  const { tarefas, curvaSRows, hoje } = input
  if (!tarefas.length) return []

  // 1) Série planejada — reusa exatamente a Curva-S do planejamento.
  const planejada = calcularCurvaSemanal(tarefas)
  const planByPeriodo = new Map(planejada.map((p) => [p.periodo, p]))

  // 2) Earned direto por semana (produção real × preços unitários do item).
  const precos = mapaPrecosDiretas(tarefas)
  const recDirSem = new Map<string, number>()
  const custDirSem = new Map<string, number>()
  for (const r of curvaSRows) {
    const real = num(r.realizado_dia)
    if (real <= 0) continue
    const p = precos.get(r.item_orcamentario_id)
    if (!p) continue
    const sem = segundaDaSemanaISO(r.data)
    recDirSem.set(sem, (recDirSem.get(sem) ?? 0) + real * p.venda)
    custDirSem.set(sem, (custDirSem.get(sem) ?? 0) + real * p.custo)
  }

  // 3) Indireto por semana (SEM taxas — idêntico em planejado e projetado).
  const recIndSem = new Map<string, number>()
  const custIndSem = new Map<string, number>()
  for (const t of tarefas) {
    if (!t.is_indireto || !t.data_inicio || !t.data_fim) continue
    const sems = semanasEntre(t.data_inicio, t.data_fim)
    if (!sems.length) continue
    const frac = 1 / sems.length
    const cust = num(t.custo_total_calc)
    const rec = num(t.receita_total_calc)
    for (const s of sems) {
      custIndSem.set(s, (custIndSem.get(s) ?? 0) + cust * frac)
      recIndSem.set(s, (recIndSem.get(s) ?? 0) + rec * frac)
    }
  }

  // 4) Taxa efetiva de imposto (sobre faturamento projetado).
  const taxaRate = taxaEfetivaImposto(tarefas)

  // 5) Montar buckets sobre a união das semanas.
  const semHoje = segundaDaSemanaISO(hoje)
  const semanas = Array.from(
    new Set<string>([
      ...planejada.map((p) => p.periodo),
      ...recDirSem.keys(),
      ...custDirSem.keys(),
      ...recIndSem.keys(),
      ...custIndSem.keys()
    ])
  ).sort()

  let recProjAcum = 0
  let custProjAcum = 0
  let ultRecPlan = 0
  let ultCustPlan = 0
  const out: ValorAgregadoBucket[] = []
  for (const periodo of semanas) {
    const pl = planByPeriodo.get(periodo)
    if (pl) {
      ultRecPlan = pl.receita_acumulada
      ultCustPlan = pl.custo_acumulado
    }
    let recProj: number | null = null
    let custProj: number | null = null
    if (periodo <= semHoje) {
      const recSem = (recDirSem.get(periodo) ?? 0) + (recIndSem.get(periodo) ?? 0)
      const custSem = (custDirSem.get(periodo) ?? 0) + (custIndSem.get(periodo) ?? 0)
      const taxasSem = recSem * taxaRate
      recProjAcum += recSem
      custProjAcum += custSem + taxasSem
      recProj = recProjAcum
      custProj = custProjAcum
    }
    out.push({
      periodo,
      receita_planejada_acum: ultRecPlan,
      custo_planejado_acum: ultCustPlan,
      receita_projetada_acum: recProj,
      custo_projetado_acum: custProj
    })
  }
  return out
}

export interface MontarComparativoInput {
  tarefas: PlanejamentoTarefaCompleta[]
  curvaSRows: CurvaSDiaRow[]
  de: string
  ate: string
}

/** Planejado × Projetado (R$) por serviço no período filtrado. */
export function montarComparativoPorServico(input: MontarComparativoInput): ComparativoServico[] {
  const { tarefas, curvaSRows, de, ate } = input
  const precos = mapaPrecosDiretas(tarefas)
  const acc = new Map<string, { plan: number; real: number }>()
  for (const r of curvaSRows) {
    if (r.data < de || r.data > ate) continue
    if (!precos.has(r.item_orcamentario_id)) continue
    const cur = acc.get(r.item_orcamentario_id) ?? { plan: 0, real: 0 }
    cur.plan += num(r.planejado_dia)
    cur.real += num(r.realizado_dia)
    acc.set(r.item_orcamentario_id, cur)
  }
  const out: ComparativoServico[] = []
  for (const [id, v] of acc) {
    const p = precos.get(id)!
    const planejado = v.plan * p.venda
    const projetado = v.real * p.venda
    if (planejado <= 0 && projetado <= 0) continue
    out.push({
      item_orcamentario_id: id,
      codigo: p.codigo,
      descricao: p.descricao,
      planejado,
      projetado
    })
  }
  return out.sort((a, b) => b.planejado - a.planejado)
}

export interface MontarMedicaoInput {
  grupos: EapGrupo[]
  tarefas: PlanejamentoTarefaCompleta[]
  curvaSRows: CurvaSDiaRow[]
  de: string
  ate: string
}

/**
 * Medição unitária do período: para cada agregador com produção no período,
 * distribui o avanço (pct = qtd_real / quantidade_referencia) às quantidades
 * dos filhos `receita`. Linha de Indireto segue a lógica da Curva-S (fração das
 * semanas da indireta dentro do período).
 */
export function montarMedicao(input: MontarMedicaoInput): MedicaoRow[] {
  const { grupos, tarefas, curvaSRows, de, ate } = input

  // Realizado por grupo dentro do período.
  const realPorGrupo = new Map<string, number>()
  for (const r of curvaSRows) {
    if (r.data < de || r.data > ate) continue
    const real = num(r.realizado_dia)
    if (real <= 0) continue
    realPorGrupo.set(r.item_orcamentario_id, (realPorGrupo.get(r.item_orcamentario_id) ?? 0) + real)
  }

  const rows: MedicaoRow[] = []
  for (const g of grupos) {
    const realPeriodo = realPorGrupo.get(g.id) ?? 0
    if (realPeriodo <= 0) continue
    const pct = g.quantidade_referencia > 0 ? realPeriodo / g.quantidade_referencia : 0
    for (const f of g.filhos) {
      const medQtd = pct * f.quantidade
      rows.push({
        tipo: 'servico',
        grupo_codigo: g.codigo,
        grupo_descricao: g.descricao,
        item_codigo: f.codigo,
        item_descricao: f.descricao,
        unidade: f.unidade,
        qtd_contratual: f.quantidade,
        pct_avanco: pct,
        medicao_qtd: medQtd,
        venda_unitaria: f.venda_unitaria,
        medicao_valor: medQtd * f.venda_unitaria
      })
    }
  }

  // Indireto: fração das semanas da indireta dentro do período × receita.
  const semDe = segundaDaSemanaISO(de)
  let indiretoValor = 0
  for (const t of tarefas) {
    if (!t.is_indireto || !t.data_inicio || !t.data_fim) continue
    const sems = semanasEntre(t.data_inicio, t.data_fim)
    if (!sems.length) continue
    const dentro = sems.filter((s) => s >= semDe && s <= ate).length
    if (dentro === 0) continue
    indiretoValor += num(t.receita_total_calc) * (dentro / sems.length)
  }
  if (indiretoValor > 0) {
    rows.push({
      tipo: 'indireto',
      grupo_codigo: '',
      grupo_descricao: 'Indireto',
      item_codigo: '',
      item_descricao: 'Custos indiretos do período (rateio Curva-S)',
      unidade: '—',
      qtd_contratual: 0,
      pct_avanco: 0,
      medicao_qtd: 0,
      venda_unitaria: 0,
      medicao_valor: indiretoValor
    })
  }
  return rows
}
