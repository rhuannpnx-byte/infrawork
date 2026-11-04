/**
 * Plano do InfraWork → documento apex-obra/1 (base "empty", modo Schedule/Control) + o índice de volta.
 *
 * Nomes no documento (únicos por espécie, estáveis): tarefas e tarefas-resumo pelo id; serviços (tipos de tarefa)
 * pelo id; calendários pelo id; recursos "R:<id>"; equipes nomeadas "E:<id>"; equipes do ApeX (composição × N)
 * "C:<servico>:<N>"; eixos pelo id do trecho; a área "Sem local" para tarefas sem trecho.
 *
 * O que o documento não leva e `projeto.ts` completa depois de montar: quantidades fracionárias dos recursos das
 * equipes, recursos identificados (equipes nomeadas) e o filtro de estacas dos marcos.
 */
import { calendarioParaObra, jornadaReferencia } from './calendario'
import { DIA, isoParaSeg, segParaDoc } from './tempo'
import type { PlanoEntrada, TarefaEntrada, TipoDependencia } from './tipos'

export const AREA_SEM_LOCAL = 'Sem local'
export const RAIZ = 'Projeto'
export const nomeRecurso = (id: string): string => `R:${id}`
export const nomeEquipeNomeada = (id: string): string => `E:${id}`
export const nomeEquipe = (servico: string, n: number): string => `C:${servico}:${n}`
/**
 * Nome do work site da tarefa: a posição no plano (pré-ordem da árvore) + o id. O ApeX desempata as tarefas de mesma
 * prioridade pelo nome (`NamePred`, ordem "lógica"); com o id puro o desempate seria a ordem aleatória dos UUIDs (e uma
 * cópia do plano podia reprogramar diferente). Com a posição, empate = quem vem antes no cronograma (DECISOES D-10).
 */
export const nomeTarefa = (posicao: number, id: string): string =>
  `T${String(posicao).padStart(6, '0')}:${id}`
/** id da tarefa a partir do nome do work site (`nomeTarefa`) */
export const idDaTarefa = (nome: string): string => (/^T\d{6}:/.test(nome) ? nome.slice(8) : nome)

/** Trecho de tarefa (work place) gerado para o motor, com a origem no InfraWork. */
export interface WpPlano {
  tarefa_id: string
  local_id: string | null
  /** id do trecho; null = área "Sem local" */
  trecho_id: string | null
  inicio_m: number
  fim_m: number
  quantidade: number
  /** linha de base: datas congeladas do trecho (segundos) */
  inicio?: number
  fim?: number
}

export interface ObraGerada {
  doc: Record<string, unknown>
  /** trabalho estrito no motor: tarefa → seus work places na ordem de estaca */
  wps: Map<string, WpPlano[]>
  /** composição × N → recursos com as quantidades reais (fracionárias) */
  recursosEquipes: Map<string, { recurso: string; qtd: number }[]>
  /** tarefa → equipes nomeadas (recursos identificados) */
  identificados: Map<string, string[]>
  /** marco → faixas de estacas (filtro), já em nomes de eixo */
  faixasMarcos: Map<string, { eixo: string; inicio: number; fim: number }[]>
  /** tarefas fora do motor (indiretos, sem serviço) */
  foraDoMotor: string[]
  /** jornada de referência (h) usada para a taxa por hora das equipes */
  jornada: number
  avisos: string[]
}

const DEP_TIPO: Record<TipoDependencia, string> = {
  FS: 'finish_start',
  SS: 'start_start',
  FF: 'finish_finish',
  SF: 'start_finish',
  EST: 'by_stations'
}

const arredonda = (x: number): number => Math.round(x * 1e6) / 1e6

/** Divide os locais em work places: com o template do trecho, um por segmento com quantidade; área = 0…1. */
export function workPlacesDaTarefa(t: TarefaEntrada, e: PlanoEntrada): WpPlano[] {
  const out: WpPlano[] = []
  const areas = new Set(e.trechos.filter((x) => x.tipo === 'area').map((x) => x.id))
  const locais =
    t.locais.length > 0
      ? [...t.locais].sort((a, b) => a.ordem - b.ordem)
      : [
          {
            id: null as unknown as string,
            ordem: 0,
            trecho_id: null,
            inicio_m: null,
            fim_m: null,
            quantidade: t.quantidade,
            qtd_origem: 'manual' as const
          }
        ]
  for (const l of locais) {
    const localId = (l.id ?? null) as string | null
    if (l.trecho_id && areas.has(l.trecho_id)) {
      // área do ApeX: um work place de 0 a 1 (sem estacas)
      out.push({
        tarefa_id: t.id,
        local_id: localId,
        trecho_id: l.trecho_id,
        inicio_m: 0,
        fim_m: 1,
        quantidade: Math.max(0, l.quantidade)
      })
      continue
    }
    if (!l.trecho_id || l.inicio_m === null || l.fim_m === null || !(l.fim_m > l.inicio_m)) {
      out.push({
        tarefa_id: t.id,
        local_id: localId,
        trecho_id: null,
        inicio_m: 0,
        fim_m: 1,
        quantidade: Math.max(0, l.quantidade)
      })
      continue
    }
    const segs =
      l.qtd_origem === 'trecho' && t.item_orcamentario_id ? (e.templates[l.trecho_id] ?? []) : []
    const partes: WpPlano[] = []
    if (segs.length > 0 && t.item_orcamentario_id) {
      for (const s of [...segs].sort((a, b) => a.inicio_m - b.inicio_m)) {
        const v = s.valores[t.item_orcamentario_id] ?? 0
        const a = Math.max(l.inicio_m, s.inicio_m),
          b = Math.min(l.fim_m, s.fim_m)
        if (!(v > 0) || !(b > a) || !(s.fim_m > s.inicio_m)) continue
        partes.push({
          tarefa_id: t.id,
          local_id: localId,
          trecho_id: l.trecho_id,
          inicio_m: a,
          fim_m: b,
          quantidade: (v * (b - a)) / (s.fim_m - s.inicio_m)
        })
      }
    }
    const soma = partes.reduce((x, p) => x + p.quantidade, 0)
    if (partes.length > 0 && soma > 0) {
      // a quantidade do local (calculada no banco, arredondada) é a que vale: as partes seguem a proporção do template
      const k = l.quantidade / soma
      for (const p of partes) out.push({ ...p, quantidade: arredonda(p.quantidade * k) })
    } else {
      out.push({
        tarefa_id: t.id,
        local_id: localId,
        trecho_id: l.trecho_id,
        inicio_m: l.inicio_m,
        fim_m: l.fim_m,
        quantidade: Math.max(0, l.quantidade)
      })
    }
  }
  return out
}

/** Os work places de dois conjuntos se cruzam (mesmo eixo, sobreposição de comprimento > 0)? */
function cruzam(a: WpPlano[], b: WpPlano[]): boolean {
  return a.some((x) =>
    b.some((y) => x.trecho_id === y.trecho_id && x.inicio_m < y.fim_m && y.inicio_m < x.fim_m)
  )
}

export function gerarObra(e: PlanoEntrada): ObraGerada {
  const avisos: string[] = []
  const calPadrao =
    e.calendarios.find((c) => c.id === e.plano.calendario_id) ??
    e.calendarios.find((c) => c.padrao) ??
    e.calendarios[0]
  if (!calPadrao) throw new Error('A obra não tem calendário')
  const jornada = jornadaReferencia(calPadrao)

  // ── tarefas no motor e seus work places
  const tarefas = new Map(e.tarefas.map((t) => [t.id, t]))
  const grupos = e.tarefas.filter((t) => t.tipo_no === 'grupo')
  const foraDoMotor: string[] = []
  const noMotor: TarefaEntrada[] = []
  for (const t of e.tarefas) {
    if (t.tipo_no !== 'tarefa') continue
    if (t.is_indireto || !t.servico_id) {
      foraDoMotor.push(t.id)
      continue
    }
    noMotor.push(t)
  }
  const wps = new Map<string, WpPlano[]>()
  if (e.wpsCongelados) {
    for (const w of [...e.wpsCongelados].sort((a, b) => a.ordem - b.ordem)) {
      if (!tarefas.has(w.tarefa_id)) continue
      const lista = wps.get(w.tarefa_id) ?? []
      lista.push({
        tarefa_id: w.tarefa_id,
        local_id: w.local_id,
        trecho_id: w.trecho_id,
        inicio_m: w.inicio_m ?? 0,
        fim_m: w.fim_m ?? 1,
        quantidade: w.quantidade,
        inicio: isoParaSeg(w.inicio_em),
        fim: isoParaSeg(w.fim_em)
      })
      wps.set(w.tarefa_id, lista)
    }
    for (const t of noMotor) if (!wps.has(t.id)) wps.set(t.id, workPlacesDaTarefa(t, e))
  } else {
    for (const t of noMotor) wps.set(t.id, workPlacesDaTarefa(t, e))
  }

  // ── eixos (um por trecho usado), áreas usadas e a área "Sem local"
  const areasObra = new Set(e.trechos.filter((x) => x.tipo === 'area').map((x) => x.id))
  const usados = new Set<string>()
  const areasUsadas = new Set<string>()
  let semLocal = false
  for (const l of wps.values())
    for (const w of l) {
      if (!w.trecho_id) semLocal = true
      else if (areasObra.has(w.trecho_id)) areasUsadas.add(w.trecho_id)
      else usados.add(w.trecho_id)
    }
  for (const m of e.marcos)
    if (m.filtro_estacas)
      for (const f of m.faixas) if (!areasObra.has(f.trecho_id)) usados.add(f.trecho_id)
  const fimEixo = new Map<string, number>()
  for (const tr of e.trechos) fimEixo.set(tr.id, Math.max(1, Number(tr.comprimento_m) || 0))
  for (const l of wps.values())
    for (const w of l)
      if (w.trecho_id) fimEixo.set(w.trecho_id, Math.max(fimEixo.get(w.trecho_id) ?? 1, w.fim_m))
  const eixos = [...usados].sort((a, b) => {
    const ta = e.trechos.findIndex((t) => t.id === a),
      tb = e.trechos.findIndex((t) => t.id === b)
    return ta - tb
  })
  const eixoPrincipal = eixos[0] ?? 'Eixo'
  const estacaFim = (id: string): number => Math.ceil(fimEixo.get(id) ?? 1)

  // ── unidades e tipos (serviços)
  const unidades = new Map<string, string>()
  for (const s of e.servicos) {
    const u = (s.unidade ?? '').trim() || 'un'
    if (!unidades.has(u)) unidades.set(u, u)
  }
  const servicosUsados = new Set(noMotor.map((t) => t.servico_id!))
  for (const m of e.marcos) for (const s of m.servicos) servicosUsados.add(s)
  for (const d of e.tiposDependencias) {
    servicosUsados.add(d.predecessor_id)
    servicosUsados.add(d.sucessor_id)
  }
  const servicos = e.servicos.filter((s) => servicosUsados.has(s.id))
  const conhecidos = new Set(servicos.map((s) => s.id))

  // ── equipes: composição × N
  const equipePorServico = new Map(e.equipes.map((q) => [q.servico_id, q]))
  const crews: Record<string, unknown>[] = []
  const recursosEquipes = new Map<string, { recurso: string; qtd: number }[]>()
  const recursosUsados = new Set<string>()
  const crewDaTarefa = new Map<string, string | null>()
  for (const t of noMotor) {
    const q = equipePorServico.get(t.servico_id!)
    const prod = Number(q?.producao_diaria) || 0
    const n = Math.max(1, Math.round(t.qtd_equipes || 1))
    if (!(prod > 0) || !(jornada > 0)) {
      crewDaTarefa.set(t.id, null)
      avisos.push(`sem_producao:${t.id}`)
      continue
    }
    const nome = nomeEquipe(t.servico_id!, n)
    crewDaTarefa.set(t.id, nome)
    if (recursosEquipes.has(nome)) continue
    const recs = (q?.recursos ?? [])
      .filter((r) => r.qtd > 0)
      .map((r) => ({ recurso: nomeRecurso(r.recurso_id), qtd: r.qtd * n }))
    for (const r of q?.recursos ?? []) recursosUsados.add(r.recurso_id)
    recursosEquipes.set(nome, recs)
    crews.push({
      name: nome,
      rates: [{ type: t.servico_id, rate: (prod / jornada) * n }],
      price_calculation: 'none'
    })
  }
  for (const m of e.marcos) for (const r of m.recursos) recursosUsados.add(r)
  for (const l of e.limites) recursosUsados.add(l.recurso_id)
  const nomesRecursos = new Map<string, string>()
  for (const q of e.equipes) for (const r of q.recursos) nomesRecursos.set(r.recurso_id, r.nome)
  const resources: Record<string, unknown>[] = [...recursosUsados].map((id) => {
    const lims = e.limites.filter(
      (l) =>
        l.recurso_id === id && (l.grupo_id === null || tarefas.get(l.grupo_id)?.tipo_no === 'grupo')
    )
    return {
      name: nomeRecurso(id),
      description: nomesRecursos.get(id) ?? '',
      ...(lims.length
        ? { limits: lims.map((l) => ({ sum_task: l.grupo_id ?? RAIZ, max: l.maximo })) }
        : {})
    }
  })
  // equipes nomeadas = recursos identificados (precisam de um recurso de base)
  const identificados = new Map<string, string[]>()
  const equipesNomeadas = new Set<string>()
  for (const t of noMotor) {
    const ids = t.equipes_ids.filter((x) => e.equipesNomeadas.some((q) => q.id === x))
    if (ids.length) {
      identificados.set(t.id, ids)
      for (const x of ids) equipesNomeadas.add(x)
    }
  }
  for (const id of equipesNomeadas) {
    resources.push({
      name: nomeEquipeNomeada(id),
      description: e.equipesNomeadas.find((q) => q.id === id)?.nome ?? ''
    })
  }

  // ── tarefas-resumo (pai antes do filho)
  const ordemGrupos: TarefaEntrada[] = []
  const visitado = new Set<string>()
  const visita = (g: TarefaEntrada): void => {
    if (visitado.has(g.id)) return
    visitado.add(g.id)
    const pai = g.parent_id ? tarefas.get(g.parent_id) : undefined
    if (pai && pai.tipo_no === 'grupo') visita(pai)
    ordemGrupos.push(g)
  }
  for (const g of [...grupos].sort((a, b) => a.ordem - b.ordem)) visita(g)
  const sumTask = (parent: string | null): string | undefined =>
    parent && tarefas.get(parent)?.tipo_no === 'grupo' ? parent : undefined

  // ── início desejado (tarefa não ASAP mantém o início do último cálculo)
  const inicioPlano = isoParaSeg(e.plano.inicio)
  // na ordem do plano (a entrada vem em pré-ordem da árvore)
  const posicao = new Map(noMotor.map((t, i) => [t.id, i]))
  const nt = (id: string): string => nomeTarefa(posicao.get(id) ?? 0, id)
  const docTarefas = noMotor.map((t) => {
    const desejado = t.inicio_em ? isoParaSeg(t.inicio_em) : inicioPlano
    const quando = segParaDoc(Math.max(desejado, inicioPlano))
    const crew = crewDaTarefa.get(t.id) ?? null
    const st = sumTask(t.parent_id)
    return {
      kind: 'task',
      name: nt(t.id),
      description: t.nome,
      type: t.servico_id,
      ...(st ? { sum_task: st } : {}),
      ...(t.calendario_id && e.calendarios.some((c) => c.id === t.calendario_id)
        ? { calendar: t.calendario_id }
        : {}),
      work_places: wps.get(t.id)!.map((w) => ({
        location: w.trecho_id ?? AREA_SEM_LOCAL,
        station_begin: w.inicio_m,
        station_end: w.fim_m,
        quantity: w.quantidade,
        start: w.inicio !== undefined ? segParaDoc(w.inicio) : quando,
        finish: w.fim !== undefined ? segParaDoc(w.fim) : quando
      })),
      crews: { other: crew },
      rate_coefficient: t.coef_producao > 0 ? t.coef_producao : 1,
      priority: Math.max(0, Math.round(t.prioridade)),
      asap: t.asap,
      start_side: t.sentido === 'decrescente' ? 'high' : 'low',
      start_at_beginning_of_day: t.inicio_dia,
      derive_predecessors_from_types: t.derivar_predecessoras,
      ...(t.restricao_inicio && t.restricao_inicio_em
        ? {
            start_constraint: {
              type: t.restricao_inicio === 'exato' ? 'exact' : 'earliest',
              date: segParaDoc(isoParaSeg(t.restricao_inicio_em))
            }
          }
        : {}),
      ...(t.restricao_fim && t.restricao_fim_em
        ? {
            finish_constraint: {
              type: t.restricao_fim === 'exato' ? 'exact' : 'latest',
              date: segParaDoc(isoParaSeg(t.restricao_fim_em))
            }
          }
        : {})
    }
  })

  // ── dependências do usuário: só entre tarefas no motor, sem ciclo, "por estacas" só se cruzam
  const noMotorIds = new Set(noMotor.map((t) => t.id))
  const proximas = new Map<string, string[]>()
  const alcanca = (de: string, ate: string): boolean => {
    const vistos = new Set<string>([de])
    const pilha = [de]
    while (pilha.length) {
      const x = pilha.pop()!
      if (x === ate) return true
      for (const y of proximas.get(x) ?? []) {
        if (vistos.has(y)) continue
        vistos.add(y)
        pilha.push(y)
      }
    }
    return false
  }
  const deps: Record<string, unknown>[] = []
  for (const d of e.dependencias) {
    if (!noMotorIds.has(d.predecessora_id) || !noMotorIds.has(d.sucessora_id)) {
      avisos.push(`dependencia_fora:${d.id}`)
      continue
    }
    if (d.predecessora_id === d.sucessora_id || alcanca(d.sucessora_id, d.predecessora_id)) {
      avisos.push(`dependencia_ciclo:${d.id}`)
      continue
    }
    if (d.tipo === 'EST' && !cruzam(wps.get(d.predecessora_id)!, wps.get(d.sucessora_id)!)) {
      avisos.push(`dependencia_sem_cruzamento:${d.id}`)
      continue
    }
    proximas.set(d.predecessora_id, [...(proximas.get(d.predecessora_id) ?? []), d.sucessora_id])
    deps.push({
      predecessor: nt(d.predecessora_id),
      successor: nt(d.sucessora_id),
      type: DEP_TIPO[d.tipo],
      min_delay_days: d.atraso_min === null ? null : Math.round(d.atraso_min),
      max_delay_days: d.atraso_max === null ? null : Math.round(d.atraso_max),
      work_days: d.dias_uteis
    })
  }

  // ── marcos
  const faixasMarcos = new Map<string, { eixo: string; inicio: number; fim: number }[]>()
  const milestones = e.marcos.map((m) => {
    if (m.filtro_estacas)
      faixasMarcos.set(
        m.id,
        m.faixas
          .filter((f) => usados.has(f.trecho_id))
          .map((f) => ({ eixo: f.trecho_id, inicio: f.inicio_m, fim: f.fim_m }))
      )
    const inc = m.incluidas.filter((x) => noMotorIds.has(x)).map(nt)
    const exc = m.excluidas.filter((x) => noMotorIds.has(x)).map(nt)
    const tipos = m.filtro_servicos ? m.servicos.filter((s) => conhecidos.has(s)) : []
    const recs = m.filtro_recursos
      ? m.recursos.filter((r) => recursosUsados.has(r)).map(nomeRecurso)
      : []
    return {
      name: m.id,
      description: m.nome,
      ...(m.inicio ? { from: segParaDoc(isoParaSeg(m.inicio)) } : {}),
      ...(m.fim ? { to: segParaDoc(isoParaSeg(m.fim)) } : {}),
      ...(inc.length ? { tasks: inc } : {}),
      ...(exc.length ? { excluded_tasks: exc } : {}),
      ...(m.filtro_servicos ? { types: tipos } : {}),
      ...(m.filtro_recursos ? { resources: recs } : {})
    }
  })

  const prazo = e.plano.prazo ? isoParaSeg(e.plano.prazo) : inicioPlano + 3653 * DIA
  const doc: Record<string, unknown> = {
    format: 'apex-obra/1',
    base: 'empty',
    project: {
      name: e.plano.nome,
      start_date: segParaDoc(inicioPlano),
      deadline: segParaDoc(Math.max(prazo, inicioPlano + DIA)),
      mode: e.plano.modo === 'controle' ? 'control' : 'schedule',
      currency: 'BRL',
      length_unit: 'm',
      default_calendar: calPadrao.id,
      main_road_line: {
        name: eixoPrincipal,
        station_begin: 0,
        station_end: estacaFim(eixoPrincipal)
      },
      root_sum_task: { name: RAIZ }
    },
    units: {
      cut: { name: '_corte' },
      fill: { name: '_aterro' },
      crush: { name: '_britagem' },
      haul: { name: '_transporte' },
      other: [...unidades.keys()].map((u) => ({ name: u }))
    },
    task_types: servicos.map((s) => ({
      name: s.id,
      description: `${s.codigo} ${s.nome}`,
      unit: (s.unidade ?? '').trim() || 'un'
    })),
    type_dependencies: e.tiposDependencias
      .filter((d) => conhecidos.has(d.predecessor_id) && conhecidos.has(d.sucessor_id))
      .map((d) => ({
        predecessor: d.predecessor_id,
        successor: d.sucessor_id,
        delay_days: Math.round(d.atraso_dias)
      })),
    calendars: [calPadrao, ...e.calendarios.filter((c) => c !== calPadrao)].map((c) =>
      calendarioParaObra(c, e.fatoresMes, c.id)
    ),
    resources,
    crews,
    road_lines: eixos
      .slice(1)
      .map((id) => ({ name: id, station_begin: 0, station_end: estacaFim(id) })),
    areas: [
      ...e.trechos.filter((x) => areasUsadas.has(x.id)).map((x) => ({ name: x.id })),
      ...(semLocal ? [{ name: AREA_SEM_LOCAL }] : [])
    ],
    sum_tasks: ordemGrupos.map((g) => ({
      name: g.id,
      description: g.nome,
      ...(sumTask(g.parent_id) ? { parent: sumTask(g.parent_id) } : {})
    })),
    tasks: docTarefas,
    dependencies: deps,
    milestones
  }
  return { doc, wps, recursosEquipes, identificados, faixasMarcos, foraDoMotor, jornada, avisos }
}
