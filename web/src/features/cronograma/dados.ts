/**
 * Carga de um plano do banco para a entrada do motor (`PlanoEntrada`).
 *
 * Plano em edição: calendários, fatores, equipes (composições vivas) e dependências entre serviços atuais; os locais
 * com quantidade do trecho são divididos pelo template atual. Linha de base: tudo o que foi congelado na promoção
 * (calendários, dependências entre serviços, equipe de cada tarefa e os trechos de tarefa calculados).
 */
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { hojeLocalISO } from '@/lib/format/local-date'
import type { ControleEntrada } from './motor/controle'
import { fetchTemplateAtual } from '@/features/planejamento/hooks/trechos'
import type {
  CalendarioEntrada,
  DefinicaoCalendario,
  DependenciaEntrada,
  DependenciaTipo,
  EquipeServico,
  FatorMes,
  IndiretoConfig,
  LimiteRecurso,
  LocalEntrada,
  MarcoEntrada,
  PlanoEntrada,
  SegmentoTemplate,
  TarefaEntrada,
  WpCongelado
} from './motor/tipos'

const n = (v: unknown, d = 0): number => {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(x) ? x : d
}
const nn = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : n(v))

/** Lê todas as linhas (a API corta em 1000 por chamada); consultas que podem passar disso terminam em `.order('id')`. */
async function todos<T>(
  q: () => { range: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }> }
): Promise<T[]> {
  return lerTodas<T>((de, ate) => q().range(de, ate))
}

interface PlanoRow {
  id: string
  obra_id: string
  data_date: string | null
  nome: string
  data_referencia_inicio: string
  prazo: string | null
  calendario_id: string | null
  modo: 'programacao' | 'controle'
  is_baseline: boolean
  dados_rev: number
  calculo_rev: number | null
  recalculo_pendente: boolean
  premissa_calendarios: { calendarios?: CalendarioCongelado[]; fatores?: [string, number][] } | null
  premissa_tipos: DependenciaTipo[] | null
}

interface CalendarioCongelado {
  id: string
  nome: string
  padrao: boolean
  semana: CalendarioEntrada['semana']
  definicoes: DefinicaoCalendario[]
}

/**
 * Tarefas na ordem da árvore (pré-ordem; irmãs por `ordem`). É a ordem de criação dos work sites no projeto do ApeX,
 * que desempata o nivelamento de recursos entre tarefas de mesma prioridade: não pode depender da ordem física das
 * linhas (que muda numa cópia do plano).
 */
function emPreOrdem(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const filhas = new Map<string | null, Record<string, unknown>[]>()
  const ids = new Set(rows.map((r) => r.id as string))
  for (const r of rows) {
    const pai = (r.parent_id as string | null) ?? null
    const k = pai && ids.has(pai) ? pai : null
    const l = filhas.get(k) ?? []
    l.push(r)
    filhas.set(k, l)
  }
  const chave = (r: Record<string, unknown>): string =>
    String(r.servico_grupo_codigo ?? r.codigo_eap ?? '') +
    ' ' +
    String(r.nome_custom ?? r.servico_grupo_descricao ?? '')
  for (const l of filhas.values())
    l.sort((a, b) => n(a.ordem) - n(b.ordem) || chave(a).localeCompare(chave(b), 'pt-BR'))
  const out: Record<string, unknown>[] = []
  const visitar = (pai: string | null): void => {
    for (const r of filhas.get(pai) ?? []) {
      out.push(r)
      visitar(r.id as string)
    }
  }
  visitar(null)
  return out.length === rows.length ? out : rows
}

const defn = (d: Record<string, unknown>): DefinicaoCalendario => ({
  tipo: d.tipo as DefinicaoCalendario['tipo'],
  nome: (d.nome as string) ?? '',
  data_inicio: (d.data_inicio as string | null) ?? null,
  data_fim: (d.data_fim as string | null) ?? null,
  todo_ano: d.todo_ano === true,
  dia_semana: d.dia_semana === null || d.dia_semana === undefined ? null : n(d.dia_semana),
  semana: (d.semana as DefinicaoCalendario['semana']) ?? null
})

/** Equipe do serviço no formato da RPC servico_equipe_viva. */
function equipeDaRpc(x: Record<string, unknown>): EquipeServico {
  return {
    servico_id: x.servico_id as string,
    producao_diaria: nn(x.producao_diaria),
    recursos: ((x.recursos as Record<string, unknown>[] | null) ?? []).map((r) => ({
      recurso_id: r.recurso_id as string,
      nome: (r.nome as string) ?? '',
      grupo: (r.grupo as string | undefined) ?? undefined,
      qtd: n(r.qtd)
    }))
  }
}

/** Retrato completo de um plano para o motor. */
export async function carregarPlanoEntrada(planejamentoId: string): Promise<PlanoEntrada> {
  const c = supabase
  const { data: pr, error: pErr } = await c
    .from('planejamento')
    .select(
      'id, obra_id, nome, data_referencia_inicio, prazo, calendario_id, modo, is_baseline, dados_rev, calculo_rev, recalculo_pendente, premissa_calendarios, premissa_tipos, data_date'
    )
    .eq('id', planejamentoId)
    .single()
  if (pErr) throw pErr
  const p = pr as unknown as PlanoRow
  const obra = p.obra_id

  const [trechos, servicos, nomeadas, tarefasRaw, deps, marcos, limites] = await Promise.all([
    todos(() =>
      c
        .from('obra_trecho')
        .select(
          'id, nome, ordem, cor, tipo, comprimento_m, unidade_espaco_padrao, unidade_custom_label, unidade_custom_divisor_m, marcador_valor_inicial, geometry_sentido'
        )
        .eq('obra_id', obra)
        .order('ordem')
    ),
    todos(() => c.from('servico').select('id, codigo, nome, unidade').eq('obra_id', obra)),
    todos(() => c.from('equipe').select('id, nome, is_sistema').eq('obra_id', obra)),
    todos(() =>
      c
        .from('vw_planejamento_tarefa_completa')
        .select('*')
        .eq('planejamento_id', planejamentoId)
        .order('ordem')
        .order('id')
    ),
    todos(() =>
      c
        .from('planejamento_dependencia')
        .select('id, predecessora_id, sucessora_id, tipo, atraso_min, atraso_max, dias_uteis')
        .eq('planejamento_id', planejamentoId)
    ),
    todos(() =>
      c.from('planejamento_marco').select('*').eq('planejamento_id', planejamentoId).order('ordem')
    ),
    todos(() =>
      c
        .from('planejamento_recurso_limite')
        .select('id, recurso_id, grupo_id, maximo')
        .eq('planejamento_id', planejamentoId)
    )
  ])
  const tarefasRows = emPreOrdem(tarefasRaw as Record<string, unknown>[])

  // ── calendários, fatores, equipes e dependências entre serviços
  let calendarios: CalendarioEntrada[]
  let fatoresMes: FatorMes[]
  let equipes: EquipeServico[]
  let tiposDependencias: DependenciaTipo[]
  let wpsCongelados: WpCongelado[] | undefined
  if (p.is_baseline && p.premissa_calendarios?.calendarios?.length) {
    calendarios = p.premissa_calendarios.calendarios.map((k) => ({
      id: k.id,
      nome: k.nome,
      padrao: k.padrao,
      semana: k.semana,
      definicoes: (k.definicoes ?? []).map((d) => defn(d as unknown as Record<string, unknown>))
    }))
    fatoresMes = (p.premissa_calendarios.fatores ?? []).map(([ano_mes, fator]) => ({
      ano_mes,
      fator: n(fator, 1)
    }))
    tiposDependencias = p.premissa_tipos ?? []
    const prem = await todos(() =>
      c
        .from('planejamento_lb_premissa')
        .select('tarefa_id, equipe')
        .eq('planejamento_id', planejamentoId)
    )
    const porServico = new Map<string, EquipeServico>()
    for (const x of prem as { equipe: Record<string, unknown> | null }[]) {
      if (x.equipe && x.equipe.servico_id && !porServico.has(x.equipe.servico_id as string)) {
        porServico.set(x.equipe.servico_id as string, equipeDaRpc(x.equipe))
      }
    }
    equipes = [...porServico.values()]
    const wps = await todos(() =>
      c
        .from('planejamento_tarefa_wp')
        .select('*')
        .eq('planejamento_id', planejamentoId)
        .order('ordem')
    )
    wpsCongelados = (wps as Record<string, unknown>[]).map((w) => ({
      tarefa_id: w.tarefa_id as string,
      local_id: (w.local_id as string | null) ?? null,
      ordem: n(w.ordem),
      trecho_id: (w.trecho_id as string | null) ?? null,
      inicio_m: nn(w.inicio_m),
      fim_m: nn(w.fim_m),
      quantidade: n(w.quantidade),
      inicio_em: w.inicio_em as string,
      fim_em: w.fim_em as string
    }))
  } else {
    const [cals, defs, fat, eq, td] = await Promise.all([
      todos(() =>
        c
          .from('calendario')
          .select('id, nome, padrao, semana, ordem')
          .eq('obra_id', obra)
          .order('ordem')
      ),
      todos(() =>
        c
          .from('calendario_definicao')
          .select(
            'calendario_id, tipo, nome, data_inicio, data_fim, todo_ano, dia_semana, semana, ordem, calendario!inner(obra_id)'
          )
          .eq('calendario.obra_id', obra)
          .order('ordem')
      ),
      todos(() => c.from('obra_produtividade_mes').select('ano_mes, fator').eq('obra_id', obra)),
      c.rpc('obra_equipes_vivas', { _obra_id: obra }).then(({ data, error }) => {
        if (error) throw error
        return (data as Record<string, unknown>[] | null) ?? []
      }),
      todos(() =>
        c
          .from('servico_dependencia')
          .select('predecessor_id, sucessor_id, atraso_dias')
          .eq('obra_id', obra)
      )
    ])
    calendarios = (cals as Record<string, unknown>[]).map((k) => ({
      id: k.id as string,
      nome: k.nome as string,
      padrao: k.padrao === true,
      semana: k.semana as CalendarioEntrada['semana'],
      definicoes: (defs as Record<string, unknown>[])
        .filter((d) => d.calendario_id === k.id)
        .map(defn)
    }))
    fatoresMes = (fat as Record<string, unknown>[]).map((f) => ({
      ano_mes: String(f.ano_mes),
      fator: n(f.fator, 1)
    }))
    equipes = eq.map(equipeDaRpc)
    tiposDependencias = (td as Record<string, unknown>[]).map((d) => ({
      predecessor_id: d.predecessor_id as string,
      sucessor_id: d.sucessor_id as string,
      atraso_dias: n(d.atraso_dias)
    }))
  }

  // ── taxas dos indiretos
  const regimes = [
    ...new Set(
      tarefasRows
        .map((t) => (t.indireto_config as Record<string, unknown> | null)?.taxa_regime_id)
        .filter((x): x is string => typeof x === 'string')
    )
  ]
  const taxaPct = new Map<string, number>()
  if (regimes.length) {
    const rs = await todos(() =>
      c.from('encargos_sociais_regime').select('id, total_perc_calc').in('id', regimes)
    )
    for (const r of rs as Record<string, unknown>[])
      taxaPct.set(r.id as string, n(r.total_perc_calc))
  }

  const nomesEquipe = (nomeadas as Record<string, unknown>[]).filter((q) => q.is_sistema !== true)
  const nomeadaIds = new Set(nomesEquipe.map((q) => q.id as string))
  const tarefas: TarefaEntrada[] = tarefasRows
    .filter((t) => t.tipo_no === 'tarefa' || t.tipo_no === 'grupo')
    .map((t) => {
      const cfg = t.indireto_config as Record<string, unknown> | null
      const indireto: IndiretoConfig | null = cfg
        ? {
            custo_periodicidade:
              (cfg.custo_periodicidade as IndiretoConfig['custo_periodicidade']) ?? 'mes',
            custo_unitario: nn(cfg.custo_unitario),
            receita_modo:
              (cfg.receita_modo as IndiretoConfig['receita_modo']) ?? 'mesma_logica_custo',
            receita_unitaria: nn(cfg.receita_unitaria),
            receita_percentual: nn(cfg.receita_percentual),
            offset_dias_antes: n(cfg.offset_dias_antes),
            offset_dias_depois: n(cfg.offset_dias_depois),
            receita_extrapola: cfg.receita_extrapola !== false,
            aplica_taxas: cfg.aplica_taxas === true,
            taxa_percentual:
              typeof cfg.taxa_regime_id === 'string'
                ? (taxaPct.get(cfg.taxa_regime_id) ?? null)
                : null,
            taxa_regime_id: typeof cfg.taxa_regime_id === 'string' ? cfg.taxa_regime_id : null
          }
        : null
      const locais: LocalEntrada[] = ((t.locais as Record<string, unknown>[] | null) ?? []).map(
        (l) => ({
          id: l.id as string,
          ordem: n(l.ordem),
          trecho_id: (l.trecho_id as string | null) ?? null,
          inicio_m: nn(l.inicio_m),
          fim_m: nn(l.fim_m),
          quantidade: n(l.quantidade),
          qtd_origem: l.qtd_origem === 'trecho' ? 'trecho' : 'manual'
        })
      )
      const equipesIds = ((t.equipes as Record<string, unknown>[] | null) ?? [])
        .map((e) => e.id as string)
        .filter((x) => nomeadaIds.has(x))
      return {
        id: t.id as string,
        tipo_no: t.tipo_no as 'tarefa' | 'grupo',
        parent_id: (t.parent_id as string | null) ?? null,
        ordem: n(t.ordem),
        nome: ((t.nome_custom as string | null) ||
          (t.servico_grupo_descricao as string | null) ||
          'Tarefa') as string,
        item_orcamentario_id: (t.item_orcamentario_id as string | null) ?? null,
        servico_id: (t.servico_id as string | null) ?? null,
        is_indireto: t.is_indireto === true,
        quantidade: n(t.quantidade_alocada),
        prioridade: n(t.prioridade, 500),
        asap: t.asap === true,
        inicio_dia: t.inicio_dia === true,
        sentido: t.sentido === 'decrescente' ? 'decrescente' : 'crescente',
        restricao_inicio: (t.restricao_inicio as TarefaEntrada['restricao_inicio']) ?? null,
        restricao_inicio_em: (t.restricao_inicio_em as string | null) ?? null,
        restricao_fim: (t.restricao_fim as TarefaEntrada['restricao_fim']) ?? null,
        restricao_fim_em: (t.restricao_fim_em as string | null) ?? null,
        coef_producao: n(t.coef_producao, 1),
        qtd_equipes: n(t.qtd_equipes, 1),
        calendario_id: (t.calendario_id as string | null) ?? null,
        derivar_predecessoras: t.derivar_predecessoras !== false,
        equipes_ids: equipesIds,
        locais,
        inicio_em: (t.inicio_em as string | null) ?? null,
        venda_unitaria: nn(t.venda_unitaria_item),
        venda_total_item: nn(t.venda_total_item),
        quantidade_referencia: nn(t.quantidade_referencia),
        custo_unitario_item: nn(t.custo_unitario_item),
        indireto,
        exib: {
          codigo: (t.servico_grupo_codigo as string | null) ?? null,
          notas: (t.notas as string | null) ?? null,
          aparencia: (t.aparencia as { cor?: string; rotulo?: boolean } | null) ?? null
        }
      }
    })

  // ── templates dos trechos com locais "do trecho" (plano em edição)
  const templates: Record<string, SegmentoTemplate[]> = {}
  if (!wpsCongelados) {
    const comTrecho = new Set<string>()
    for (const t of tarefas)
      for (const l of t.locais)
        if (l.qtd_origem === 'trecho' && l.trecho_id) comTrecho.add(l.trecho_id)
    await Promise.all(
      [...comTrecho].map(async (id) => {
        const tpl = await fetchTemplateAtual(id)
        if (!tpl) return
        const itemDaColuna = new Map(tpl.colunas.map((k) => [k.id, k.item_orcamentario_id]))
        templates[id] = tpl.segmentos.map((s) => {
          const valores: Record<string, number> = {}
          for (const [col, v] of Object.entries(s.valores)) {
            const item = itemDaColuna.get(col)
            if (item) valores[item] = (valores[item] ?? 0) + Number(v)
          }
          return { inicio_m: Number(s.posicao_inicio_m), fim_m: Number(s.posicao_fim_m), valores }
        })
      })
    )
  }

  // ── modo controle: a produção lançada até a data de controle (o motor monta o realizado e a previsão)
  let controle: ControleEntrada | undefined
  if (p.modo === 'controle') {
    const hoje = hojeLocalISO()
    const data = p.data_date && p.data_date < hoje ? p.data_date : hoje
    const itens = [
      ...new Set(tarefas.map((t) => t.item_orcamentario_id).filter((x): x is string => !!x))
    ]
    const prod = itens.length
      ? await todos(() =>
          c
            .from('acompanhamento_producao')
            .select(
              'item_orcamentario_id, equipe_id, data, quantidade, fator_conversao, trecho_id, posicao_inicio_m, posicao_fim_m'
            )
            .eq('obra_id', obra)
            .in('item_orcamentario_id', itens)
            .lte('data', data)
            .order('data')
            .order('id')
        )
      : []
    controle = {
      data,
      producoes: (prod as Record<string, unknown>[]).map((x) => ({
        item_orcamentario_id: x.item_orcamentario_id as string,
        equipe_id: (x.equipe_id as string | null) ?? null,
        data: String(x.data),
        quantidade: n(x.quantidade) * n(x.fator_conversao, 1),
        trecho_id: (x.trecho_id as string | null) ?? null,
        inicio_m: x.posicao_inicio_m == null ? null : n(x.posicao_inicio_m),
        fim_m: x.posicao_fim_m == null ? null : n(x.posicao_fim_m)
      }))
    }
  }

  return {
    ...(controle ? { controle } : {}),
    plano: {
      id: p.id,
      nome: p.nome,
      inicio: p.data_referencia_inicio,
      prazo: p.prazo,
      calendario_id: p.calendario_id,
      modo: p.modo ?? 'programacao',
      data_controle: p.data_date ?? null,
      is_baseline: p.is_baseline,
      dados_rev: n(p.dados_rev),
      calculo_rev: p.calculo_rev === null ? null : n(p.calculo_rev),
      recalculo_pendente: p.recalculo_pendente === true
    },
    calendarios,
    fatoresMes,
    trechos: (trechos as Record<string, unknown>[]).map((t) => ({
      id: t.id as string,
      nome: t.nome as string,
      tipo: t.tipo === 'area' ? 'area' : 'eixo',
      comprimento_m: nn(t.comprimento_m),
      exib: {
        cor: (t.cor as string) ?? '#3b82f6',
        unidade_espaco_padrao: (t.unidade_espaco_padrao as 'km' | 'm' | 'estaca' | 'custom') ?? 'm',
        unidade_custom_label: (t.unidade_custom_label as string | null) ?? null,
        unidade_custom_divisor_m: nn(t.unidade_custom_divisor_m),
        marcador_valor_inicial: nn(t.marcador_valor_inicial),
        geometry_sentido: (t.geometry_sentido as 'natural' | 'invertido' | null) ?? 'natural'
      }
    })),
    servicos: (servicos as Record<string, unknown>[]).map((s) => ({
      id: s.id as string,
      codigo: (s.codigo as string) ?? '',
      nome: (s.nome as string) ?? '',
      unidade: (s.unidade as string | null) ?? null
    })),
    equipes,
    tiposDependencias,
    equipesNomeadas: nomesEquipe.map((q) => ({ id: q.id as string, nome: q.nome as string })),
    tarefas,
    dependencias: (deps as Record<string, unknown>[]).map((d): DependenciaEntrada => ({
      id: d.id as string,
      predecessora_id: d.predecessora_id as string,
      sucessora_id: d.sucessora_id as string,
      tipo: d.tipo as DependenciaEntrada['tipo'],
      atraso_min: nn(d.atraso_min),
      atraso_max: nn(d.atraso_max),
      dias_uteis: d.dias_uteis === true
    })),
    marcos: (marcos as Record<string, unknown>[]).map((m): MarcoEntrada => ({
      id: m.id as string,
      nome: m.nome as string,
      inicio: (m.inicio as string | null) ?? null,
      fim: (m.fim as string | null) ?? null,
      filtro_servicos: m.filtro_servicos === true,
      servicos: (m.servicos as string[]) ?? [],
      filtro_recursos: m.filtro_recursos === true,
      recursos: (m.recursos as string[]) ?? [],
      filtro_estacas: m.filtro_estacas === true,
      faixas: ((m.faixas as MarcoEntrada['faixas']) ?? []).map((f) => ({
        trecho_id: f.trecho_id,
        inicio_m: n(f.inicio_m),
        fim_m: n(f.fim_m)
      })),
      incluidas: (m.incluidas as string[]) ?? [],
      excluidas: (m.excluidas as string[]) ?? []
    })),
    limites: (limites as Record<string, unknown>[]).map((l): LimiteRecurso => ({
      recurso_id: l.recurso_id as string,
      grupo_id: (l.grupo_id as string | null) ?? null,
      maximo: n(l.maximo)
    })),
    templates,
    ...(wpsCongelados ? { wpsCongelados } : {})
  }
}
