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
//   - Valoração (redesenho out/2026):
//       · EXECUTADO = avanço físico × valor do serviço no CONTRATO ATUAL (aditivo
//         recalcula o passado), ao preço de cada DIA (reajuste é prospectivo);
//         acima de 100% do serviço não agrega ("executado além do contrato").
//       · PLANEJADO = premissa da linha de base × fator de reajuste do dia
//         (valor do serviço no dia ÷ valor na data em que a LB foi travada).

import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import { segundaDaSemanaISO, semanasEntre } from '@/features/planejamento/hooks/cronograma'

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
  /** Quantidade da receita × fração alocada ao serviço (contrato atual). */
  quantidade: number
  /** Preço de venda atual (após todos os reajustes). */
  venda_unitaria: number
}

/** Preço anterior de uma receita em cada reajuste aplicado (ordem de data). */
export type HistoricoPrecos = Map<string, Array<{ data: string; preco_antes: number }>>

/** Preço de venda de uma receita numa data (reajuste vale a partir da data). */
export function precoReceitaEm(
  receitaId: string,
  data: string,
  precoAtual: number,
  hist: HistoricoPrecos
): number {
  const h = hist.get(receitaId)
  if (!h) return precoAtual
  for (const r of h) if (r.data > data) return r.preco_antes
  return precoAtual
}

/**
 * Valoração por serviço e por dia, a partir da EAP atual e do histórico de
 * reajustes. `unitExec` = valor do serviço no dia ÷ quantidade do serviço;
 * `fatorPlan` = valor no dia ÷ valor na data em que a LB foi travada.
 */
export interface Valorizacao {
  unitExec: (servicoId: string, data: string) => number
  fatorPlan: (servicoId: string, data: string) => number
  custoUnit: (servicoId: string) => number
  qtdServico: (servicoId: string) => number
}

export function criarValorizacao(
  grupos: EapGrupo[],
  hist: HistoricoPrecos,
  dataTravaLb: string | null
): Valorizacao {
  const porId = new Map(grupos.map((g) => [g.id, g]))
  const cache = new Map<string, number>()
  const valorEm = (id: string, data: string): number => {
    const k = id + '|' + data
    const c = cache.get(k)
    if (c !== undefined) return c
    const g = porId.get(id)
    const v = g
      ? g.filhos.reduce(
          (a, f) => a + f.quantidade * precoReceitaEm(f.id, data, f.venda_unitaria, hist),
          0
        )
      : 0
    cache.set(k, v)
    return v
  }
  return {
    unitExec: (id, data) => {
      const q = porId.get(id)?.quantidade_referencia ?? 0
      return q > 0 ? valorEm(id, data) / q : 0
    },
    fatorPlan: (id, data) => {
      if (!dataTravaLb) return 1
      const base = valorEm(id, dataTravaLb)
      return base > 0 ? valorEm(id, data) / base : 1
    },
    custoUnit: (id) => porId.get(id)?.custo_unitario ?? 0,
    qtdServico: (id) => porId.get(id)?.quantidade_referencia ?? 0
  }
}

/** Produção diária limitada a 100% do serviço (o excedente vai para a prateleira). */
export function producaoLimitada(
  rows: CurvaSDiaRow[],
  qtdServico: (id: string) => number
): { porLinha: Map<CurvaSDiaRow, number>; excedente: Map<string, number> } {
  const ordenadas = [...rows]
    .filter((r) => num(r.realizado_dia) > 0)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
  const acum = new Map<string, number>()
  const porLinha = new Map<CurvaSDiaRow, number>()
  const excedente = new Map<string, number>()
  for (const r of ordenadas) {
    const id = r.item_orcamentario_id
    const q = qtdServico(id)
    const ja = acum.get(id) ?? 0
    const real = num(r.realizado_dia)
    const cabe = q > 0 ? Math.max(0, Math.min(real, q - ja)) : real
    porLinha.set(r, cabe)
    acum.set(id, ja + real)
    if (real > cabe) excedente.set(id, (excedente.get(id) ?? 0) + real - cabe)
  }
  return { porLinha, excedente }
}

/** Agregador (`servico_grupo`) com seus filhos `receita`. */
export interface EapGrupo {
  id: string
  codigo: string
  descricao: string
  quantidade_referencia: number
  unidade_referencia: string
  /** Custo unitário atual do serviço (composição ao vivo). */
  custo_unitario: number
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
  valorizacao: Valorizacao
}

/**
 * Curva-S de valor agregado: planejada (receita+custo) sobre todas as semanas
 * do projeto + projetada (receita+custo, até hoje) reusando a lógica da Curva-S
 * do planejamento. Indireto idêntico nos dois; imposto projetado sobre o
 * faturamento projetado.
 */
export function montarCurvaValorAgregado(input: MontarCurvaInput): ValorAgregadoBucket[] {
  const { tarefas, curvaSRows, hoje, valorizacao: val } = input
  if (!tarefas.length) return []

  // 1) Série planejada direta: perfil diário da referência × premissa da LB ×
  //    fator de reajuste do dia (semana atravessada fica dividida por dia).
  const precos = mapaPrecosDiretas(tarefas)
  const recPlanSem = new Map<string, number>()
  const custPlanSem = new Map<string, number>()
  for (const r of curvaSRows) {
    const plan = num(r.planejado_dia)
    if (plan <= 0) continue
    const p = precos.get(r.item_orcamentario_id)
    if (!p) continue
    const sem = segundaDaSemanaISO(r.data)
    recPlanSem.set(
      sem,
      (recPlanSem.get(sem) ?? 0) + plan * p.venda * val.fatorPlan(r.item_orcamentario_id, r.data)
    )
    custPlanSem.set(sem, (custPlanSem.get(sem) ?? 0) + plan * p.custo)
  }

  // 2) Earned direto por semana: produção (limitada a 100%) × valor do
  //    contrato atual ao preço do dia.
  const { porLinha } = producaoLimitada(curvaSRows, val.qtdServico)
  const recDirSem = new Map<string, number>()
  const custDirSem = new Map<string, number>()
  for (const [r, real] of porLinha) {
    if (real <= 0 || !precos.has(r.item_orcamentario_id)) continue
    const sem = segundaDaSemanaISO(r.data)
    recDirSem.set(
      sem,
      (recDirSem.get(sem) ?? 0) + real * val.unitExec(r.item_orcamentario_id, r.data)
    )
    custDirSem.set(sem, (custDirSem.get(sem) ?? 0) + real * val.custoUnit(r.item_orcamentario_id))
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
      ...recPlanSem.keys(),
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
    ultRecPlan += (recPlanSem.get(periodo) ?? 0) + (recIndSem.get(periodo) ?? 0)
    ultCustPlan += (custPlanSem.get(periodo) ?? 0) + (custIndSem.get(periodo) ?? 0)
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
  valorizacao: Valorizacao
}

/** Planejado × Projetado (R$) por serviço no período filtrado. */
export function montarComparativoPorServico(input: MontarComparativoInput): ComparativoServico[] {
  const { tarefas, curvaSRows, de, ate, valorizacao: val } = input
  const precos = mapaPrecosDiretas(tarefas)
  const { porLinha } = producaoLimitada(curvaSRows, val.qtdServico)
  const acc = new Map<string, { plan: number; real: number }>()
  for (const r of curvaSRows) {
    if (r.data < de || r.data > ate) continue
    const p = precos.get(r.item_orcamentario_id)
    if (!p) continue
    const cur = acc.get(r.item_orcamentario_id) ?? { plan: 0, real: 0 }
    cur.plan += num(r.planejado_dia) * p.venda * val.fatorPlan(r.item_orcamentario_id, r.data)
    cur.real += (porLinha.get(r) ?? 0) * val.unitExec(r.item_orcamentario_id, r.data)
    acc.set(r.item_orcamentario_id, cur)
  }
  const out: ComparativoServico[] = []
  for (const [id, v] of acc) {
    const p = precos.get(id)!
    const planejado = v.plan
    const projetado = v.real
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
  /** Inclui as linhas de indireto (default true; falso ao filtrar 1 serviço). */
  incluirIndireto?: boolean
  hist: HistoricoPrecos
}

/**
 * Medição unitária do período: para cada agregador com produção no período,
 * distribui o avanço (pct = qtd_real / quantidade_referencia) às quantidades
 * dos filhos `receita`. Linha de Indireto segue a lógica da Curva-S (fração das
 * semanas da indireta dentro do período).
 */
export function montarMedicao(input: MontarMedicaoInput): MedicaoRow[] {
  const { grupos, tarefas, curvaSRows, de, ate } = input
  const incluirIndireto = input.incluirIndireto ?? true

  // Ids dos agregadores indiretos (medidos por tempo, não por produção física).
  const indiretoGrupoIds = new Set(
    tarefas
      .filter((t) => t.is_indireto && t.item_orcamentario_id)
      .map((t) => t.item_orcamentario_id!)
  )

  // Realizado por grupo e por dia dentro do período (limitado a 100% do serviço).
  const qtdDe = (id: string): number => grupos.find((g) => g.id === id)?.quantidade_referencia ?? 0
  const { porLinha } = producaoLimitada(curvaSRows, qtdDe)
  const realPorGrupo = new Map<string, Array<{ data: string; real: number }>>()
  for (const [r, real] of porLinha) {
    if (r.data < de || r.data > ate || real <= 0) continue
    const arr = realPorGrupo.get(r.item_orcamentario_id) ?? []
    arr.push({ data: r.data, real })
    realPorGrupo.set(r.item_orcamentario_id, arr)
  }

  const rows: MedicaoRow[] = []
  for (const g of grupos) {
    if (indiretoGrupoIds.has(g.id)) continue // indireto tratado à parte (abaixo)
    const dias = realPorGrupo.get(g.id) ?? []
    const realPeriodo = dias.reduce((a, d) => a + d.real, 0)
    if (realPeriodo <= 0) continue
    const pct = g.quantidade_referencia > 0 ? realPeriodo / g.quantidade_referencia : 0
    for (const f of g.filhos) {
      const medQtd = pct * f.quantidade
      // valor ao preço de cada dia (reajuste vale a partir da data)
      const valor =
        g.quantidade_referencia > 0
          ? dias.reduce(
              (a, d) =>
                a +
                (d.real / g.quantidade_referencia) *
                  f.quantidade *
                  precoReceitaEm(f.id, d.data, f.venda_unitaria, input.hist),
              0
            )
          : 0
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
        venda_unitaria: medQtd > 0 ? valor / medQtd : f.venda_unitaria,
        medicao_valor: valor
      })
    }
  }

  // Indireto: avanço = fração das semanas da indireta dentro do período (mesma
  // lógica da Curva-S, confirmada com o usuário), aplicado às QUANTIDADES dos
  // itens `receita` que compõem o agregador (ADMINISTRAÇÃO DE OBRAS, CANTEIRO,
  // MOBILIZAÇÃO, DESMOBILIZAÇÃO…). Mesma semântica da medição direta
  // (pct × qtd contratual), só que o pct vem do tempo, não da produção física.
  if (incluirIndireto) {
    const gruposById = new Map(grupos.map((g) => [g.id, g]))
    const semDe = segundaDaSemanaISO(de)
    for (const t of tarefas) {
      if (!t.is_indireto || !t.data_inicio || !t.data_fim) continue
      const sems = semanasEntre(t.data_inicio, t.data_fim)
      if (!sems.length) continue
      const dentro = sems.filter((s) => s >= semDe && s <= ate).length
      if (dentro === 0) continue
      const fracPeriodo = dentro / sems.length

      const g = t.item_orcamentario_id ? gruposById.get(t.item_orcamentario_id) : undefined
      const grupoCod = t.servico_grupo_codigo ?? g?.codigo ?? ''
      const grupoDesc = t.servico_grupo_descricao ?? g?.descricao ?? 'Indireto'
      const filhos = (g?.filhos ?? []).filter((f) => f.quantidade * f.venda_unitaria > 0)

      if (filhos.length > 0) {
        for (const f of filhos) {
          const medQtd = fracPeriodo * f.quantidade
          rows.push({
            tipo: 'indireto',
            grupo_codigo: grupoCod,
            grupo_descricao: grupoDesc,
            item_codigo: f.codigo,
            item_descricao: f.descricao,
            unidade: f.unidade || '—',
            qtd_contratual: f.quantidade,
            pct_avanco: fracPeriodo,
            medicao_qtd: medQtd,
            venda_unitaria: f.venda_unitaria,
            medicao_valor: medQtd * f.venda_unitaria
          })
        }
      } else {
        // Sem itens de receita cadastrados: linha única pelo total do agregador.
        const receitaPeriodo = num(t.receita_total_calc) * fracPeriodo
        if (receitaPeriodo <= 0) continue
        rows.push({
          tipo: 'indireto',
          grupo_codigo: grupoCod,
          grupo_descricao: grupoDesc,
          item_codigo: '',
          item_descricao: grupoDesc,
          unidade: '—',
          qtd_contratual: 0,
          pct_avanco: fracPeriodo,
          medicao_qtd: 0,
          venda_unitaria: 0,
          medicao_valor: receitaPeriodo
        })
      }
    }
  }
  return rows
}
