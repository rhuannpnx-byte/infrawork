/**
 * Cálculo do cronograma de um plano pelo motor do ApeX: monta o projeto (modelo padrão + documento apex-obra/1 +
 * complementos), refaz as dependências automáticas e as datas (uma vez, com o adiador), e extrai os resultados.
 *
 * Igual ao ApeX: `applyAutoDependencies` + `Scheduler.calculate(true)` (nivelamento), `Scheduler.floats` (folgas
 * contra prazo, marcos e datas forçadas) e `violations` (bandeiras vermelhas). Perfil = a quantidade de cada trecho
 * espalhada uniformemente pelos segundos de trabalho do calendário da tarefa (a mesma hipótese do tempo-local do
 * ApeX: avanço linear em tempo de trabalho dentro do work place).
 */
import { readDr5, FT, type FieldValue } from '@apex/dr5'
import { Project, type Entity, type Ref } from '@apex/model'
import { Calendar, getWorkDaysBetween, parseCalendarBlob, type CalendarSpec } from '@apex/calendar'
import {
  applyAutoDependencies,
  postponeTiming,
  resourceUsage,
  resetTimings,
  Scheduler,
  violations as calcularViolacoes,
  workPlacesOf,
  wpBegin,
  wpEnd,
  type Violation
} from '@apex/engine'
import {
  addIdentifiedResource,
  buildObra,
  setIdentifiedResource,
  type BuildReport
} from '@apex/obra'
import {
  AREA_SEM_LOCAL,
  gerarObra,
  idDaTarefa,
  nomeEquipeNomeada,
  type ObraGerada,
  type WpPlano
} from './obra'
import { DIA, diaDoFim, inicioDoDia, segParaData, segParaTimestamp, segundaDaSemana } from './tempo'
import { calcularIndiretos, type ResultadoIndireto } from './indiretos'
import { calcularControle, type ResultadoControle } from './controle'
import type { PlanoEntrada } from './tipos'

export interface WpResultado extends WpPlano {
  ordem: number
  inicio: number
  fim: number
}

export type ViolacaoTarefa =
  | {
      tipo: 'dependencia'
      dependencia_predecessora: string
      atraso_real: number
      atraso_max: number
    }
  | { tipo: 'restricao'; ponto: 'inicio' | 'fim' }
  | { tipo: 'marco'; marco_id: string; ponto: 'inicio' | 'fim' }
  | { tipo: 'projeto'; ponto: 'inicio' | 'fim' }

export interface TarefaResultado {
  id: string
  inicio: number
  fim: number
  /** horas de trabalho entre início e fim (calendário da tarefa) */
  duracao_h: number
  duracao_dias_uteis: number
  folga_total_h: number
  folga_livre_h: number
  /** o que limita a folga: prazo, marco, início ou fim forçado */
  restricao_limite: string
  violacoes: ViolacaoTarefa[]
  /** sem equipe com produção: duração nula (equipe nula do ApeX) */
  sem_producao: boolean
  /** calendário da tarefa (o próprio ou o padrão do plano) */
  calendario_id: string
  wps: WpResultado[]
}

export interface ResultadoCalculo {
  tarefas: Map<string, TarefaResultado>
  /** tarefa → dia ("AAAA-MM-DD") → quantidade */
  perfilDia: Map<string, Map<string, number>>
  /** tarefa → segunda-feira ("AAAA-MM-DD") → quantidade */
  perfilSemana: Map<string, Map<string, number>>
  indiretos: ResultadoIndireto[]
  /** ordem de cálculo (prioridade + dependências) */
  ordem: string[]
  /** dependências automáticas criadas pelos tipos (predecessora → sucessora, por estacas) */
  automaticas: { predecessora_id: string; sucessora_id: string; tipo: number; atraso: number }[]
  avisos: string[]
  inicioProjeto: number
  fimProjeto: number | null
  /** prazo do projeto (segundos) */
  prazoProjeto: number
  /** calendários do cálculo (id → especificação do ApeX), para as visões desenharem com as mesmas regras */
  calendarios: Record<string, CalendarSpec>
  calendarioPadraoId: string
  /** marcos e as tarefas que cada um inclui (filtros do marco) */
  marcos: { id: string; tarefas: string[] }[]
  /**
   * Uso dos recursos das equipes no tempo (`ResourceCalculator` do ApeX, na tarefa-resumo raiz): por recurso, os
   * intervalos [início, fim, unidades] já somados entre as tarefas.
   */
  recursos: { recurso_id: string; spans: [number, number, number][] }[]
  /** modo controle: realizado, grau de execução e previsão de cada tarefa */
  controle?: ResultadoControle
}

export interface PlanoCalculado {
  projeto: Project
  obra: ObraGerada
  relatorio: BuildReport
  resultado: ResultadoCalculo
  /** tarefa (id InfraWork) → entidade do ApeX */
  entidades: Map<string, Entity>
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d)

const fRef = (oid: bigint): FieldValue => ({ kind: 'bigint', type: FT.POINTER64, value: oid })
const fDbl = (v: number): FieldValue => ({
  kind: 'float',
  type: FT.DOUBLE,
  value: v,
  raw: new Uint8Array(0)
})
const mapa = (valueType: number, entries: [FieldValue, FieldValue][]): FieldValue =>
  entries.length
    ? { kind: 'map', type: FT.PAIR_CONTAINER, keyType: FT.POINTER64, valueType, entries }
    : { kind: 'map', type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] }

function porNome(p: Project, classe: string): Map<string, Entity> {
  return new Map(p.byClass(classe).map((e) => [e.name, e]))
}

/** Calendário padrão do projeto (o mesmo que o Scheduler usa para tarefas sem calendário próprio). */
export function calendarioPadrao(p: Project): Calendar {
  const mgr = p.resolve(p.root()!.get('m_pCalendarManager') as Ref)
  const cal = p.resolve(mgr?.get('m_pDefaultCalendar') as Ref)
  const blob = cal?.fields.find((f) => f.id === 100 && f.type === 0x10)
  if (!blob || blob.value.kind !== 'bytes') throw new Error('projeto sem calendário padrão')
  return new Calendar(parseCalendarBlob(blob.value.value))
}

/** Especificação de cada calendário do projeto, pelo nome (= id do calendário no InfraWork). */
function especificacoes(p: Project): Record<string, CalendarSpec> {
  const out: Record<string, CalendarSpec> = {}
  for (const c of p.byClass('Calendar')) {
    const blob = c.fields.find((f) => f.id === 100 && f.type === 0x10)
    if (!blob || blob.value.kind !== 'bytes') continue
    try {
      out[c.name] = parseCalendarBlob(blob.value.value)
    } catch {
      // calendário ilegível: a visão usa o padrão
    }
  }
  return out
}

/** Complementos que o documento não leva (dentro da edição aberta). */
function complementar(p: Project, o: ObraGerada): void {
  const recursos = porNome(p, 'Resource')
  // 1. quantidades reais (fracionárias) dos recursos das equipes
  const crews = porNome(p, 'WorkGroup')
  for (const [nome, recs] of o.recursosEquipes) {
    const g = crews.get(nome)
    if (!g) continue
    const entries: [FieldValue, FieldValue][] = []
    for (const r of recs) {
      const e = recursos.get(r.recurso)
      if (e && r.qtd > 0) entries.push([fRef(e.oid), fDbl(r.qtd)])
    }
    g.setRaw('m_resources', mapa(FT.DOUBLE, entries))
  }
  // 2. equipes nomeadas = recursos identificados (uso "outras", 8)
  const tarefas = new Map(p.byClass('OtherWorkSite').map((t) => [idDaTarefa(t.name), t]))
  const ir = new Map<string, Entity>()
  for (const [tarefa, equipes] of o.identificados) {
    const t = tarefas.get(tarefa)
    if (!t) continue
    for (const q of equipes) {
      let r = ir.get(q)
      if (!r) {
        const base = recursos.get(nomeEquipeNomeada(q))
        if (!base) continue
        r = addIdentifiedResource(p, base, nomeEquipeNomeada(q))
        ir.set(q, r)
      }
      setIdentifiedResource(t, 8, null, r.oid)
    }
  }
  // 3. filtro de estacas dos marcos (m_mLocations: eixo → (início, fim))
  const marcos = porNome(p, 'Milestone')
  const eixos = new Map([...p.byClass('RoadLine'), ...p.byClass('Area')].map((e) => [e.name, e]))
  for (const [id, faixas] of o.faixasMarcos) {
    const m = marcos.get(id)
    if (!m) continue
    const entries: [FieldValue, FieldValue][] = []
    for (const f of faixas) {
      const rl = eixos.get(f.eixo)
      if (rl)
        entries.push([
          fRef(rl.oid),
          { kind: 'tuple', type: FT.TUPLE, items: [fDbl(f.inicio), fDbl(f.fim)] }
        ])
    }
    m.set('m_bStationSpanFilteringEnabled', true)
    m.setRaw('m_mLocations', mapa(FT.TUPLE, entries))
  }
}

/** Monta o projeto do ApeX a partir do plano e calcula as datas (dependências automáticas + nivelamento). */
export function montarProjeto(
  e: PlanoEntrada,
  modelo: Uint8Array
): { projeto: Project; obra: ObraGerada; relatorio: BuildReport } {
  const obra = gerarObra(e)
  // linha de base: as datas gravadas valem como estão (só folgas e violações são calculadas sobre elas)
  const recalcular = !e.wpsCongelados
  const p = Project.fromDr5(readDr5(modelo))
  let relatorio!: BuildReport
  p.edit('InfraWork: montar plano', () =>
    postponeTiming(
      p,
      () => {
        relatorio = buildObra(p, obra.doc, { label: 'InfraWork: montar plano' })
        complementar(p, obra)
        // o cálculo sempre roda no fim (mesmo sem nada pendente): dependências automáticas e datas
        applyAutoDependencies(p)
        if (recalcular) resetTimings(p)
      },
      {
        autodeps: () => applyAutoDependencies(p),
        timing: (wanted) => {
          if (recalcular) resetTimings(p, wanted.size ? wanted : undefined)
        }
      }
    )
  )
  return { projeto: p, obra, relatorio }
}

/** Quantidade de um work place espalhada pelos segundos de trabalho: dia → quantidade. */
function distribuir(
  cal: Calendar,
  inicio: number,
  fim: number,
  qtd: number,
  porDia: Map<string, number>
): void {
  if (!(qtd > 0)) return
  const ws0 = cal.AS2WS(inicio),
    ws1 = cal.AS2WS(fim)
  const total = ws1 - ws0
  if (!(total > 0)) {
    const d = segParaData(inicio)
    porDia.set(d, (porDia.get(d) ?? 0) + qtd)
    return
  }
  for (let d = inicioDoDia(inicio); d < fim; d += DIA) {
    const a = Math.max(d, inicio),
      b = Math.min(d + DIA, fim)
    const w = cal.AS2WS(b) - cal.AS2WS(a)
    if (w <= 0) continue
    const k = segParaData(d)
    porDia.set(k, (porDia.get(k) ?? 0) + (qtd * w) / total)
  }
}

const VIOL_PONTO = { START: 'inicio', FINISH: 'fim' } as const

/** Monta, calcula e extrai os resultados. */
export function calcularPlano(e: PlanoEntrada, modelo: Uint8Array): PlanoCalculado {
  const { projeto: p, obra, relatorio } = montarProjeto(e, modelo)
  const { resultado, entidades } = extrairResultado(e, p, obra, relatorio)
  if (e.controle) {
    resultado.controle = calcularControle(
      p,
      e,
      e.controle,
      entidades,
      (id) => resultado.tarefas.get(id)?.inicio ?? Number.MAX_SAFE_INTEGER
    )
  }
  return { projeto: p, obra, relatorio, resultado, entidades }
}

/** Lê do projeto (já calculado ou editado) os resultados do plano. */
export function extrairResultado(
  e: PlanoEntrada,
  p: Project,
  obra: ObraGerada,
  relatorio: BuildReport
): { resultado: ResultadoCalculo; entidades: Map<string, Entity> } {
  const s = new Scheduler(p)
  const ordemOid = s.order()
  const floats = s.floats(ordemOid)
  const viol = calcularViolacoes(s)

  const entidades = new Map<string, Entity>()
  for (const t of p.byClass('OtherWorkSite')) entidades.set(idDaTarefa(t.name), t)
  const idDeOid = new Map<bigint, string>()
  for (const [id, t] of entidades) idDeOid.set(t.oid, id)

  const violPorTarefa = new Map<string, ViolacaoTarefa[]>()
  const addViol = (oid: bigint, v: ViolacaoTarefa): void => {
    const id = idDeOid.get(oid)
    if (!id) return
    const l = violPorTarefa.get(id) ?? []
    l.push(v)
    violPorTarefa.set(id, l)
  }
  for (const v of viol as Violation[]) {
    if (v.kind === 'dependency') {
      const d = p.get(v.dependency)
      const pred = idDeOid.get(d?.get('m_pPredecessor') as bigint) ?? ''
      addViol(v.site, {
        tipo: 'dependencia',
        dependencia_predecessora: pred,
        atraso_real: v.realDelay,
        atraso_max: v.maxDelay
      })
    } else if (v.kind === 'forced')
      addViol(v.site, { tipo: 'restricao', ponto: VIOL_PONTO[v.point] })
    else if (v.kind === 'milestone')
      addViol(v.site, {
        tipo: 'marco',
        marco_id: p.get(v.milestone)?.name ?? '',
        ponto: VIOL_PONTO[v.point]
      })
    else addViol(v.site, { tipo: 'projeto', ponto: VIOL_PONTO[v.point] })
  }

  const semProducao = new Set(
    obra.avisos.filter((a) => a.startsWith('sem_producao:')).map((a) => a.slice(13))
  )
  const calendarios = especificacoes(p)
  const calPadraoId =
    (
      e.calendarios.find((c) => c.id === e.plano.calendario_id) ??
      e.calendarios.find((c) => c.padrao) ??
      e.calendarios[0]
    )?.id ?? ''
  const calendarioDe = new Map(
    e.tarefas.map((t) => [
      t.id,
      t.calendario_id && calendarios[t.calendario_id] ? t.calendario_id : calPadraoId
    ])
  )
  const tarefas = new Map<string, TarefaResultado>()
  const perfilDia = new Map<string, Map<string, number>>()
  const perfilSemana = new Map<string, Map<string, number>>()
  for (const [id, t] of entidades) {
    const site = s.sites.get(t.oid)
    if (!site) continue
    const cal = site.calendar
    const planos = obra.wps.get(id) ?? []
    const ents = workPlacesOf(p, t)
    const wps: WpResultado[] = []
    const porDia = new Map<string, number>()
    ents.forEach((w, ordem) => {
      const loc = p.resolve(w.get('m_pLocation') as Ref)
      const eixo = p.resolve(loc?.get('m_pRoadLine') as Ref)
      const sb = num(loc?.get('m_dStationBegin')),
        se = num(loc?.get('m_dStationEnd'))
      // área do InfraWork = Area do ApeX com o id do trecho; "Sem local" = sem trecho
      const trecho =
        eixo?.className === 'Area'
          ? eixo.name === AREA_SEM_LOCAL
            ? null
            : eixo.name
          : (eixo?.name ?? null)
      const plano =
        planos.find((x) => x.trecho_id === trecho && Math.abs(x.inicio_m - sb) < 1e-6) ??
        planos[ordem]
      const qtd = num(w.get('m_dAmount'))
      const ini = wpBegin(w),
        fim = wpEnd(w)
      wps.push({
        tarefa_id: id,
        local_id: plano?.local_id ?? null,
        trecho_id: trecho,
        inicio_m: sb,
        fim_m: se,
        quantidade: qtd,
        ordem,
        inicio: ini,
        fim: fim
      })
      distribuir(cal, ini, fim, qtd, porDia)
    })
    if (wps.length === 0) continue
    const inicio = Math.min(...wps.map((w) => w.inicio))
    const fim = Math.max(...wps.map((w) => w.fim))
    const f = floats.get(t.oid)
    const ws = (x: number): number => cal.AS2WS(x)
    tarefas.set(id, {
      id,
      inicio,
      fim,
      duracao_h: (ws(fim) - ws(inicio)) / 3600,
      duracao_dias_uteis: fim > inicio ? Math.max(0, getWorkDaysBetween(cal, inicio, fim)) : 0,
      folga_total_h: f ? (ws(f.latestTotalStart) - ws(f.currentStart)) / 3600 : 0,
      folga_livre_h: f ? (ws(f.latestFreeStart) - ws(f.currentStart)) / 3600 : 0,
      restricao_limite: f?.constraint ?? 'TC_DEADLINE',
      violacoes: violPorTarefa.get(id) ?? [],
      sem_producao: semProducao.has(id),
      calendario_id: calendarioDe.get(id) ?? calPadraoId,
      wps
    })
    perfilDia.set(id, porDia)
    const porSemana = new Map<string, number>()
    for (const [d, q] of porDia) {
      const seg = segParaData(
        segundaDaSemana(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000)
      )
      porSemana.set(seg, (porSemana.get(seg) ?? 0) + q)
    }
    perfilSemana.set(id, porSemana)
  }

  const automaticas = p
    .byClass('Dependency')
    .filter((d) => d.get('m_bUserGenerated') !== true)
    .map((d) => ({
      predecessora_id: idDeOid.get(d.get('m_pPredecessor') as bigint) ?? '',
      sucessora_id: idDeOid.get(d.get('m_pSuccessor') as bigint) ?? '',
      tipo: num(d.get('m_nType')),
      atraso: num(d.get('m_nDelayMin'))
    }))
    .filter((d) => d.predecessora_id && d.sucessora_id)

  const indiretos = calcularIndiretos(e, tarefas, calendarioPadrao(p))

  const marcos = p.byClass('Milestone').map((m) => ({
    id: m.name,
    tarefas: [...s.sites.values()]
      .filter((site) => s.isInMilestone(m, site))
      .map((site) => idDeOid.get(site.entity.oid))
      .filter((x): x is string => !!x)
  }))

  const fins = [...tarefas.values()].map((t) => t.fim)
  const resultado: ResultadoCalculo = {
    tarefas,
    perfilDia,
    perfilSemana,
    indiretos,
    ordem: ordemOid.map((o) => idDeOid.get(o)).filter((x): x is string => !!x),
    automaticas,
    avisos: [...obra.avisos, ...relatorio.warnings],
    inicioProjeto: s.projectStart,
    fimProjeto: fins.length ? Math.max(...fins) : null,
    prazoProjeto: s.projectEnd,
    calendarios,
    calendarioPadraoId: calPadraoId,
    marcos,
    recursos: usoDosRecursos(p)
  }
  return { resultado, entidades }
}

/** `ResourceCalculator::Calculate` na raiz: o uso de cada recurso das equipes (os "R:<id>"). */
function usoDosRecursos(p: Project): ResultadoCalculo['recursos'] {
  let r: ReturnType<typeof resourceUsage>
  try {
    r = resourceUsage(p, false)
  } catch {
    return []
  }
  if (r.root === undefined) return []
  const out: ResultadoCalculo['recursos'] = []
  for (const e of p.byClass('Resource')) {
    if (!e.name.startsWith('R:')) continue
    const spans = r.usage
      .usage(r.root, e.oid)
      .map((s): [number, number, number] => [s.b, s.e, Math.round(s.q * 1e6) / 1e6])
    if (spans.length) out.push({ recurso_id: e.name.slice(2), spans })
  }
  return out
}

/** Payload de planejamento_gravar_calculo a partir do resultado. */
export function payloadGravacao(e: PlanoEntrada, r: ResultadoCalculo): Record<string, unknown> {
  const tarefas = [...r.tarefas.values()].map((t) => ({
    id: t.id,
    inicio_em: segParaTimestamp(t.inicio),
    fim_em: segParaTimestamp(t.fim),
    data_inicio: segParaData(t.inicio),
    data_fim: diaDoFim(t.inicio, t.fim),
    duracao_dias_uteis: Math.round(t.duracao_dias_uteis * 100) / 100,
    folga_total_h: Math.round(t.folga_total_h * 10000) / 10000,
    folga_livre_h: Math.round(t.folga_livre_h * 10000) / 10000,
    folga_total_dias: Math.floor(t.folga_total_h / 24 + 1e-9),
    folga_livre_dias: Math.floor(t.folga_livre_h / 24 + 1e-9),
    critico: t.folga_total_h <= 1e-6,
    restricao_limite: t.restricao_limite,
    violacoes: t.violacoes
  }))
  for (const i of r.indiretos) {
    tarefas.push({
      id: i.tarefa_id,
      inicio_em: segParaTimestamp(i.inicio),
      fim_em: segParaTimestamp(i.fim),
      data_inicio: segParaData(i.inicio),
      data_fim: diaDoFim(i.inicio, i.fim),
      duracao_dias_uteis: Math.round(i.dias_uteis * 100) / 100,
      folga_total_h: 0,
      folga_livre_h: 0,
      folga_total_dias: 0,
      folga_livre_dias: 0,
      critico: false,
      restricao_limite: 'TC_DEADLINE',
      violacoes: [],
      quantidade: Math.max(i.periodos, 0.0001)
    } as (typeof tarefas)[number])
  }
  // locais: menor início e maior fim dos seus trechos
  const locais = new Map<string, { inicio: number; fim: number }>()
  for (const t of r.tarefas.values())
    for (const w of t.wps) {
      if (!w.local_id) continue
      const cur = locais.get(w.local_id)
      locais.set(
        w.local_id,
        cur
          ? { inicio: Math.min(cur.inicio, w.inicio), fim: Math.max(cur.fim, w.fim) }
          : { inicio: w.inicio, fim: w.fim }
      )
    }
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6
  const areas = new Set(e.trechos.filter((t) => t.tipo === 'area').map((t) => t.id))
  return {
    dados_rev: e.plano.dados_rev,
    tarefas,
    locais: [...locais].map(([id, x]) => ({
      id,
      inicio_em: segParaTimestamp(x.inicio),
      fim_em: segParaTimestamp(x.fim)
    })),
    wps: [...r.tarefas.values()].flatMap((t) =>
      t.wps.map((w) => ({
        tarefa_id: t.id,
        local_id: w.local_id,
        ordem: w.ordem,
        trecho_id: w.trecho_id,
        inicio_m: w.trecho_id && !areas.has(w.trecho_id) ? w.inicio_m : null,
        fim_m: w.trecho_id && !areas.has(w.trecho_id) ? w.fim_m : null,
        quantidade: w.quantidade,
        inicio_em: segParaTimestamp(w.inicio),
        fim_em: segParaTimestamp(w.fim)
      }))
    ),
    perfil_dia: [...r.perfilDia].flatMap(([id, m]) =>
      [...m].map(([dia, q]) => ({ tarefa_id: id, dia, quantidade: r6(q) }))
    ),
    perfil_semana: [...r.perfilSemana].flatMap(([id, m]) =>
      [...m].map(([seg, q]) => ({ tarefa_id: id, semana_segunda: seg, quantidade: r6(q) }))
    ),
    indiretos: r.indiretos.map((i) => ({
      tarefa_id: i.tarefa_id,
      custo_total_calc: i.custo_total,
      receita_total_calc: i.receita_total,
      custo_taxas_calc: i.custo_taxas,
      periodos_calc: i.periodos
    })),
    aviso: null,
    data_fim_obra: r.fimProjeto !== null ? segParaData(r.fimProjeto) : null
  }
}
