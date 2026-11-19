/**
 * Junta o que o relatório de viabilidade mostra: o plano calculado que já está na tela (entrada e resultado do
 * motor) e, lidos na hora, o orçamento, as taxas, o indireto e as composições com custo.
 */
import { Calendar, getWorkDaysBetween } from '@apex/calendar'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { carregarPlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { carregarLucratividade } from '@/features/orcamento/hooks/lucratividade'
import { carregarTaxas } from '@/features/orcamento/hooks/taxas'
import { carregarIndireto } from '@/features/orcamento/hooks/indireto'
import type { ItemTreeNode, RecursoGrupo, TaxaRegime } from '@/types/orcamento'
import type { ResultadoCalculo } from '../motor/calculo'
import type { PlanoEntrada, TipoDependencia } from '../motor/tipos'
import { jornadaReferencia } from '../motor/calendario'
import { ehCritica, limiteCriticoDe } from '../motor/critico'
import { diaDoFim, segParaData } from '../motor/tempo'
import { montarGantt, numerarHierarquia, type OpcoesGantt } from '../visoes/gantt-dados'
import { montarHistograma } from '../visoes/histograma'
import type { UnidadeComposicao } from '../hooks/composicoes'
import type {
  AgrupadorRelatorio,
  ComposicaoRelatorio,
  DadosViabilidade,
  IndiretoNoPlano,
  LigacaoGantt,
  LinhaGantt,
  TaxaNoPlano
} from './tipos'

const n = (v: unknown, d = 0): number => (v === null || v === undefined || v === '' ? d : Number(v))

const TIPO_LIGACAO: Record<TipoDependencia, LigacaoGantt['tipo']> = {
  FS: 'TI',
  SS: 'II',
  FF: 'TT',
  SF: 'IT',
  EST: 'EST'
}

/** Linhas e ligações do Gantt, na mesma estrutura de tópicos da tela, com tudo expandido. */
export function ganttDoPlano(
  e: PlanoEntrada,
  r: ResultadoCalculo,
  opcoes: OpcoesGantt & { automaticas: boolean }
): DadosViabilidade['gantt'] {
  // com tarefas-resumo, vale a estrutura de tópicos do plano; os níveis automáticos de local e serviço só
  // repetiriam a barra de cada tarefa. Sem resumos, fica o agrupamento escolhido na tela.
  const temResumos = e.tarefas.some((t) => t.tipo_no === 'grupo')
  const dados = montarGantt(e, r, {
    ...opcoes,
    resumos: true,
    agrupar: temResumos ? false : opcoes.agrupar
  })
  numerarHierarquia(dados.linhas)
  const spec = r.calendarios[r.calendarioPadraoId]
  const cal = spec ? new Calendar(spec) : null
  const limite = limiteCriticoDe(r)
  const dias = (v: number): number => Math.round(v * 10) / 10

  const linhas: LinhaGantt[] = dados.linhas.map((l) => {
    const t = l.tipo === 'tarefa' && l.id ? r.tarefas.get(l.id) : undefined
    return {
      id: l.chave,
      eap: l.numero ?? null,
      nome: l.texto,
      nivel: l.nivel,
      tipo: l.tipo === 'tarefa' ? 'tarefa' : 'resumo',
      inicio: l.barra ? segParaData(l.barra.inicio) : null,
      fim: l.barra ? diaDoFim(l.barra.inicio, l.barra.fim) : null,
      duracaoDias: t
        ? dias(t.duracao_dias_uteis)
        : l.barra && cal
          ? dias(Math.max(0, getWorkDaysBetween(cal, l.barra.inicio, l.barra.fim)))
          : null,
      critica: !!t && ehCritica(t.folga_total_h, limite)
    }
  })

  // a ligação é entre tarefas; a linha da tarefa é a que carrega o id dela
  const linhaDaTarefa = new Map<string, string>()
  for (const l of dados.linhas)
    if (l.id && (l.tipo === 'tarefa' || !linhaDaTarefa.has(l.id))) linhaDaTarefa.set(l.id, l.chave)
  const defasagem = new Map(e.dependencias.map((d) => [d.id, n(d.atraso_min)]))
  const ligacoes: LigacaoGantt[] = []
  for (const d of dados.dependencias) {
    if (!d.usuario && !opcoes.automaticas) continue
    const de = linhaDaTarefa.get(d.pred)
    const para = linhaDaTarefa.get(d.succ)
    if (!de || !para) continue
    ligacoes.push({
      de,
      para,
      tipo: TIPO_LIGACAO[d.tipo],
      defasagemDias: d.id ? (defasagem.get(d.id) ?? 0) : 0,
      automatica: !d.usuario
    })
  }

  if (opcoes.marcos && dados.marcos.length) {
    linhas.push({
      id: 'marcos',
      eap: null,
      nome: 'Marcos',
      nivel: 0,
      tipo: 'resumo',
      inicio: null,
      fim: null,
      duracaoDias: null,
      critica: false
    })
    for (const m of dados.marcos) {
      const quando = m.fim ?? m.inicio
      const dia = quando == null ? null : segParaData(quando)
      linhas.push({
        id: `marco:${m.id}`,
        eap: null,
        nome: m.nome,
        nivel: 1,
        tipo: 'marco',
        inicio: dia,
        fim: dia,
        duracaoDias: null,
        critica: false
      })
    }
  }
  return { linhas, ligacoes }
}

interface CpuCarregada {
  composicao: ComposicaoRelatorio
  servicoId: string
  unidade: UnidadeComposicao
}

/**
 * Composições dos serviços, com custo: as vinculadas ao serviço (`servico_cpu_link`, com fator) ou, sem vínculo, a
 * vigente — a mesma escolha do histograma e do cálculo da equipe.
 */
async function carregarComposicoes(servicoIds: string[]): Promise<CpuCarregada[]> {
  const ids = [...new Set(servicoIds)].sort()
  if (!ids.length) return []
  const [links, vigentes, servicos] = await Promise.all([
    supabase
      .from('servico_cpu_link')
      .select('servico_id, cpu_id, fator, operacao')
      .in('servico_id', ids),
    supabase.from('cpu').select('id, servico_id').in('servico_id', ids).eq('is_vigente', true),
    supabase.from('servico').select('id, codigo, nome, unidade').in('id', ids)
  ])
  for (const x of [links, vigentes, servicos]) if (x.error) throw x.error

  const escolha: Array<{
    servicoId: string
    cpuId: string
    fator: number
    operacao: 'dividir' | 'multiplicar'
  }> = []
  const comVinculo = new Set<string>()
  for (const l of links.data ?? []) {
    comVinculo.add(l.servico_id as string)
    escolha.push({
      servicoId: l.servico_id as string,
      cpuId: l.cpu_id as string,
      fator: n(l.fator, 1) || 1,
      operacao: l.operacao === 'multiplicar' ? 'multiplicar' : 'dividir'
    })
  }
  for (const v of vigentes.data ?? [])
    if (!comVinculo.has(v.servico_id as string))
      escolha.push({
        servicoId: v.servico_id as string,
        cpuId: v.id as string,
        fator: 1,
        operacao: 'dividir'
      })
  const cpuIds = [...new Set(escolha.map((x) => x.cpuId))]
  if (!cpuIds.length) return []

  const [cpus, itens] = await Promise.all([
    supabase
      .from('cpu')
      .select(
        'id, nome, versao, producao_diaria_qtde, producao_diaria_unidade, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, custo_unit_calc'
      )
      .in('id', cpuIds),
    lerTodas<Record<string, unknown>>((de, ate) =>
      supabase
        .from('cpu_item')
        .select(
          'id, cpu_id, grupo, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, consumo_material_por_unid, ordem, custo_total_calc, recurso:recurso_id(id, nome, unidade, grupo)'
        )
        .in('cpu_id', cpuIds)
        .order('cpu_id')
        .order('grupo')
        .order('ordem')
        .order('id')
        .range(de, ate)
    )
  ])
  if (cpus.error) throw cpus.error

  type Recurso = { id: string; nome: string; unidade: string | null; grupo: RecursoGrupo }
  const recursoDe = (it: Record<string, unknown>): Recurso | null => {
    const bruto = it.recurso
    return ((Array.isArray(bruto) ? bruto[0] : bruto) as Recurso | null) ?? null
  }
  const recursoIds = [
    ...new Set(itens.map((it) => recursoDe(it)?.id).filter((x): x is string => !!x))
  ]
  const precos = new Map<string, number | null>()
  for (let i = 0; i < recursoIds.length; i += 200) {
    const { data, error } = await supabase
      .from('vw_recurso_com_preco')
      .select('id, preco_vigente')
      .in('id', recursoIds.slice(i, i + 200))
    if (error) throw error
    for (const p of data ?? [])
      precos.set(p.id as string, p.preco_vigente === null ? null : n(p.preco_vigente))
  }

  const itensPorCpu = new Map<string, Record<string, unknown>[]>()
  for (const it of itens) {
    const lista = itensPorCpu.get(it.cpu_id as string) ?? []
    lista.push(it)
    itensPorCpu.set(it.cpu_id as string, lista)
  }
  const cpuPorId = new Map((cpus.data ?? []).map((c) => [c.id as string, c]))
  const servicoPorId = new Map((servicos.data ?? []).map((s) => [s.id as string, s]))

  const out: CpuCarregada[] = []
  for (const x of escolha) {
    const cpu = cpuPorId.get(x.cpuId)
    const servico = servicoPorId.get(x.servicoId)
    if (!cpu || !servico) continue
    const brutos = (itensPorCpu.get(x.cpuId) ?? []).filter((it) => recursoDe(it))
    out.push({
      servicoId: x.servicoId,
      composicao: {
        servico: {
          codigo: servico.codigo as string,
          nome: servico.nome as string,
          unidade: (servico.unidade as string | null) ?? null
        },
        nome: (cpu.nome as string | null) ?? null,
        versao: n(cpu.versao, 1),
        fator: x.fator,
        operacao: x.operacao,
        producaoDiaria: n(cpu.producao_diaria_qtde),
        unidadeProducao: (cpu.producao_diaria_unidade as string | null) ?? '',
        custoEquipamentoDia: n(cpu.custo_eq_dia_calc),
        custoCombustivelDia: n(cpu.custo_comb_dia_calc),
        custoMaoDeObraDia: n(cpu.custo_mo_dia_calc),
        custoMaterialDia: n(cpu.custo_mat_dia_calc),
        custoUnitario: n(cpu.custo_unit_calc),
        itens: brutos.map((it) => {
          const rec = recursoDe(it)!
          return {
            grupo: it.grupo as ComposicaoRelatorio['itens'][number]['grupo'],
            recurso: rec.nome,
            unidade: rec.unidade ?? '',
            quantidade: n(it.quantidade),
            horasDia: it.horas_dia === null ? null : n(it.horas_dia),
            consumoCombustivelLh:
              it.consumo_combustivel_lh === null ? null : n(it.consumo_combustivel_lh),
            indiceProdutividade: n(it.indice_produtividade, 1) || 1,
            consumoMaterialPorUnid:
              it.consumo_material_por_unid === null ? null : n(it.consumo_material_por_unid),
            preco: precos.get(rec.id) ?? null,
            custoDia: n(it.custo_total_calc)
          }
        })
      },
      unidade: {
        fator: x.fator,
        operacao: x.operacao,
        producao: n(cpu.producao_diaria_qtde),
        itens: brutos.map((it) => {
          const rec = recursoDe(it)!
          return {
            grupo: it.grupo as UnidadeComposicao['itens'][number]['grupo'],
            recurso: { id: rec.id, nome: rec.nome, unidade: rec.unidade ?? '', grupo: rec.grupo },
            quantidade: n(it.quantidade),
            horas_dia: n(it.horas_dia),
            consumo_combustivel_lh: n(it.consumo_combustivel_lh),
            indice_produtividade: n(it.indice_produtividade, 1) || 1,
            consumo_material_por_unid:
              it.consumo_material_por_unid === null ? null : n(it.consumo_material_por_unid)
          }
        })
      }
    })
  }
  return out.sort((a, b) =>
    a.composicao.servico.codigo.localeCompare(b.composicao.servico.codigo, 'pt-BR', {
      numeric: true
    })
  )
}

const achatar = (nos: ItemTreeNode[]): ItemTreeNode[] =>
  nos.flatMap((x) => [x, ...achatar(x.children)])

function taxasDoPlano(regimes: TaxaRegime[], e: PlanoEntrada): TaxaNoPlano[] {
  const hoje = new Date().toISOString().slice(0, 10)
  const vigente = regimes
    .filter(
      (t) =>
        t.ativo &&
        (!t.vigencia_inicio || t.vigencia_inicio <= hoje) &&
        (!t.vigencia_fim || t.vigencia_fim >= hoje)
    )
    .sort((a, b) => (b.vigencia_inicio ?? '').localeCompare(a.vigencia_inicio ?? ''))[0]
  const nasTarefas = new Map<string, number>()
  for (const t of e.tarefas) {
    const id = t.is_indireto && t.indireto?.aplica_taxas ? t.indireto.taxa_regime_id : null
    if (id) nasTarefas.set(id, (nasTarefas.get(id) ?? 0) + 1)
  }
  const out: TaxaNoPlano[] = []
  for (const t of regimes) {
    const usos: string[] = []
    if (vigente && t.id === vigente.id) usos.push('Regime vigente da obra (impostos sobre a venda)')
    const qtd = nasTarefas.get(t.id)
    if (qtd)
      usos.push(`${qtd} ${qtd === 1 ? 'tarefa de indireto' : 'tarefas de indireto'} do plano`)
    if (usos.length) out.push({ ...t, uso: usos.join('; ') })
  }
  return out
}

export interface PedidoViabilidade {
  obraId: string
  obra: { codigo: string; nome: string }
  entrada: PlanoEntrada
  resultado: ResultadoCalculo
  opcoesGantt: OpcoesGantt & { automaticas: boolean }
}

export async function carregarDadosViabilidade({
  obraId,
  obra,
  entrada: e,
  resultado: r,
  opcoesGantt
}: PedidoViabilidade): Promise<DadosViabilidade> {
  const [planOrc, resumo, regimes, indiretoCadastro] = await Promise.all([
    carregarPlanOrc(obraId),
    carregarLucratividade(obraId),
    carregarTaxas(obraId),
    carregarIndireto(obraId)
  ])
  const servicosDoPlano = e.tarefas
    .filter((t) => t.tipo_no === 'tarefa' && !t.is_indireto && t.servico_id)
    .map((t) => t.servico_id!)
  const servicosDoOrcamento = planOrc.servicos
    .map((s) => s.servico_id)
    .filter((x): x is string => !!x)
  const cpus = await carregarComposicoes([...servicosDoPlano, ...servicosDoOrcamento])

  const composicoesPorServico = new Map<string, UnidadeComposicao[]>()
  for (const c of cpus)
    composicoesPorServico.set(c.servicoId, [
      ...(composicoesPorServico.get(c.servicoId) ?? []),
      c.unidade
    ])
  const servicoDe = new Map(cpus.map((c) => [c.servicoId, c.composicao.servico]))

  const calendarioPlano =
    e.calendarios.find((c) => c.id === e.plano.calendario_id) ??
    e.calendarios.find((c) => c.padrao) ??
    e.calendarios[0]
  const spec = r.calendarios[r.calendarioPadraoId]
  const histograma = spec
    ? montarHistograma(e, r, composicoesPorServico, {
        unidadeTempo: 'recursos',
        calendario: new Calendar(spec),
        jornada: calendarioPlano ? jornadaReferencia(calendarioPlano) : 8
      })
    : { semanas: [], recursos: [] }

  const itemPorId = new Map(planOrc.flat.map((i) => [i.id, i]))
  const agrupadores: AgrupadorRelatorio[] = planOrc.servicos.map((item) => ({
    item,
    servico: item.servico_id ? (servicoDe.get(item.servico_id) ?? null) : null,
    receitas: planOrc.alocacoes
      .filter((a) => a.grupo_id === item.id)
      .map((a) => {
        const receita = itemPorId.get(a.receita_id)
        return {
          codigo: receita?.codigo ?? '',
          descricao: receita?.descricao ?? '(receita removida)',
          fracao: n(a.fracao),
          vendaTotal: n(receita?.venda_total_calc) * n(a.fracao)
        }
      })
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }))

  const tarefaPorId = new Map(e.tarefas.map((t) => [t.id, t]))
  const indiretoPlano: IndiretoNoPlano[] = r.indiretos.map((i) => {
    const t = tarefaPorId.get(i.tarefa_id)
    return {
      nome: t?.nome ?? 'Indireto',
      inicio: i.fim > i.inicio ? segParaData(i.inicio) : null,
      fim: i.fim > i.inicio ? diaDoFim(i.inicio, i.fim) : null,
      diasUteis: i.dias_uteis,
      periodos: i.periodos,
      periodicidade: t?.indireto?.custo_periodicidade ?? 'mes',
      custoUnitario:
        t?.indireto?.custo_unitario ?? (i.periodos > 0 ? i.custo_total / i.periodos : null),
      custoTotal: i.custo_total,
      receitaTotal: i.receita_total,
      custoTaxas: i.custo_taxas
    }
  })

  return {
    obra,
    plano: {
      nome: e.plano.nome,
      situacao: e.plano.is_baseline ? 'Linha de base' : 'Plano em edição',
      inicio: r.inicioProjeto != null ? segParaData(r.inicioProjeto) : e.plano.inicio,
      fim:
        r.fimProjeto != null && r.inicioProjeto != null
          ? diaDoFim(r.inicioProjeto, r.fimProjeto)
          : null,
      prazo: e.plano.prazo,
      calendario: calendarioPlano
        ? {
            nome: calendarioPlano.nome,
            jornadaHoras: jornadaReferencia(calendarioPlano),
            diasPorSemana: calendarioPlano.semana.filter((d) => n(d.horas) > 0).length
          }
        : null
    },
    geradoEm: new Date(),
    gantt: ganttDoPlano(e, r, opcoesGantt),
    resumo,
    taxas: taxasDoPlano(regimes, e),
    indiretoCadastro,
    indiretoPlano,
    orcamento: achatar(planOrc.tree),
    agrupadores,
    composicoes: cpus.map((c) => c.composicao),
    histograma
  }
}
