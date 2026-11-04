/**
 * Controle (modo Control do ApeX): a produção lançada no acompanhamento vira os apontamentos (`OtherActual`) das
 * tarefas e o motor calcula, a partir da data de controle, o grau de execução, a taxa realizada e a previsão do saldo
 * (`ForecastCalculator`: as frentes realizadas pelos apontamentos, em ordem de data, e o restante na taxa da RN-007 —
 * a média entre a realizada e a planejada, ponderada pelo grau — com o nivelamento de recursos).
 *
 * O cronograma planejado não muda (no ApeX, os apontamentos de tarefas "outras" não travam work places): o controle é
 * uma leitura por cima do plano, e não entra na gravação dos resultados.
 *
 * Repartição da produção entre as tarefas do mesmo serviço (o lançamento é por serviço do orçamento):
 * - com equipe no lançamento e tarefas do serviço com essa equipe nomeada, só essas tarefas;
 * - em ordem de início planejado, cada tarefa recebe até a sua quantidade; o que sobra vai para a seguinte (e o excesso
 *   final fica na última).
 */
import { encode } from '@apex/model'
import type { Entity, Project, Ref } from '@apex/model'
import {
  forecast,
  implementationDegree,
  implementedTiming,
  Scheduler,
  actualProductionRate,
  setControlDate,
  type ForecastFront
} from '@apex/engine'
import type { Calendar } from '@apex/calendar'
import { AREA_SEM_LOCAL } from './obra'
import { DIA, isoParaSeg } from './tempo'
import type { PlanoEntrada } from './tipos'

export interface ProducaoLancada {
  item_orcamentario_id: string
  equipe_id: string | null
  /** "AAAA-MM-DD" */
  data: string
  quantidade: number
  /** controle por estaca: o local lançado (eixo com faixa em metros internos, ou área sem faixa) */
  trecho_id?: string | null
  inicio_m?: number | null
  fim_m?: number | null
}

export interface ControleEntrada {
  /** data de controle ("AAAA-MM-DD"): o realizado vale até o fim deste dia */
  data: string
  producoes: ProducaoLancada[]
}

export interface Apontamento {
  data: string
  quantidade: number
}

export interface LugarPrevisao {
  trecho_id: string | null
  inicio_m: number
  fim_m: number
  inicio: number
  fim: number
  quantidade: number
  realizado: boolean
}

export interface FrentePrevisao {
  crescente: boolean
  lugares: LugarPrevisao[]
}

export interface ControleTarefa {
  realizado: number
  /** grau de execução (0…1) */
  grau: number
  inicio_real: number | null
  fim_real: number | null
  /** produção realizada por dia de trabalho (unidade do serviço) */
  taxa_real: number | null
  /** término previsto pela previsão (null = sem previsão) */
  fim_previsto: number | null
  concluida: boolean
  frentes: FrentePrevisao[]
}

export interface ResultadoControle {
  data: number
  tarefas: Record<string, ControleTarefa>
}

/**
 * Reparte os lançamentos por tarefa (ver o cabeçalho). `inicio` = início planejado da tarefa (ordem de preenchimento).
 * Lançamento com local (controle por estaca): vai para as tarefas do serviço cujo local cobre a faixa lançada — mais
 * de uma, rateado pela sobreposição (área: por igual); sem nenhuma que cubra, vale a regra geral.
 */
export function repartirProducao(
  e: PlanoEntrada,
  c: ControleEntrada,
  inicio: (tarefaId: string) => number
): Map<string, Apontamento[]> {
  const fim = c.data
  const porItem = new Map<
    string,
    {
      id: string
      qtd: number
      equipes: string[]
      locais: PlanoEntrada['tarefas'][number]['locais']
    }[]
  >()
  for (const t of e.tarefas) {
    if (t.tipo_no !== 'tarefa' || t.is_indireto || !t.item_orcamentario_id) continue
    const l = porItem.get(t.item_orcamentario_id) ?? []
    l.push({ id: t.id, qtd: Math.max(0, t.quantidade), equipes: t.equipes_ids, locais: t.locais })
    porItem.set(t.item_orcamentario_id, l)
  }
  for (const l of porItem.values())
    l.sort((a, b) => inicio(a.id) - inicio(b.id) || a.id.localeCompare(b.id))
  const recebido = new Map<string, number>()
  const out = new Map<string, Apontamento[]>()
  const apontar = (tarefaId: string, data: string, q: number): void => {
    recebido.set(tarefaId, (recebido.get(tarefaId) ?? 0) + q)
    const l = out.get(tarefaId) ?? []
    const ult = l[l.length - 1]
    if (ult && ult.data === data) ult.quantidade += q
    else l.push({ data, quantidade: q })
    out.set(tarefaId, l)
  }
  /** quanto do local lançado a tarefa cobre (metros de sobreposição; área: 1) */
  const cobertura = (
    locais: PlanoEntrada['tarefas'][number]['locais'],
    p: ProducaoLancada
  ): number => {
    let s = 0
    for (const l of locais) {
      if (l.trecho_id !== p.trecho_id) continue
      if (p.inicio_m == null || p.fim_m == null || l.inicio_m === null || l.fim_m === null) s += 1
      else if (p.fim_m - p.inicio_m < 1e-6)
        // estaca pontual (ex.: descarga de uma viagem): conta para o local que a contém
        s += p.inicio_m >= l.inicio_m - 1e-6 && p.inicio_m <= l.fim_m + 1e-6 ? 1 : 0
      else s += Math.max(0, Math.min(l.fim_m, p.fim_m) - Math.max(l.inicio_m, p.inicio_m))
    }
    return s
  }
  const lancamentos = c.producoes
    .filter((p) => p.data <= fim && p.quantidade > 0)
    .sort((a, b) => a.data.localeCompare(b.data))
  for (const p of lancamentos) {
    const todas = porItem.get(p.item_orcamentario_id)
    if (!todas?.length) continue
    if (p.trecho_id) {
      const cobrem = todas
        .map((t) => ({ t, peso: cobertura(t.locais, p) }))
        .filter((x) => x.peso > 1e-9)
      if (cobrem.length) {
        const total = cobrem.reduce((s, x) => s + x.peso, 0)
        for (const x of cobrem) apontar(x.t.id, p.data, (p.quantidade * x.peso) / total)
        continue
      }
    }
    const daEquipe = p.equipe_id ? todas.filter((t) => t.equipes.includes(p.equipe_id!)) : []
    const cand = daEquipe.length ? daEquipe : todas
    let resta = p.quantidade
    for (let i = 0; i < cand.length && resta > 1e-9; i++) {
      const t = cand[i]!
      const ja = recebido.get(t.id) ?? 0
      const cabe = i === cand.length - 1 ? resta : Math.max(0, t.qtd - ja)
      const q = Math.min(resta, cabe)
      if (!(q > 1e-9)) continue
      apontar(t.id, p.data, q)
      resta -= q
    }
  }
  return out
}

const pairs = (v: unknown): [unknown, unknown][] =>
  Array.isArray(v) ? (v as [unknown, unknown][]) : []

/** Expediente do dia no calendário da tarefa (sem expediente: o dia corrido). */
function periodoDoDia(cal: Calendar, dia: number): [number, number] {
  const ps = cal.workPeriods(dia, dia + DIA)
  return ps.length ? [ps[0]![0], ps[ps.length - 1]![1]] : [dia, dia + DIA]
}

/**
 * Grava os apontamentos e a data de controle no projeto e lê o controle de cada tarefa (grau, taxa realizada e as
 * frentes do `ForecastCalculator`).
 */
export function calcularControle(
  p: Project,
  e: PlanoEntrada,
  c: ControleEntrada,
  entidades: Map<string, Entity>,
  inicio: (tarefaId: string) => number
): ResultadoControle {
  const reparto = repartirProducao(e, c, inicio)
  const s0 = new Scheduler(p)
  const dataControle = isoParaSeg(c.data) + DIA
  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  p.edit('InfraWork: realizados', () => {
    const im = p.resolve(p.root()!.get('m_pImplManager') as Ref)!
    const lista: [unknown, unknown][] = [...pairs(im.get('m_otherActuals'))]
    for (const [id, aps] of reparto) {
      const ws = entidades.get(id)
      if (!ws) continue
      const cal = s0.calendarOf(ws)
      const crescente = porId.get(id)?.sentido !== 'decrescente'
      for (const a of aps) {
        const [b, f] = periodoDoDia(cal, isoParaSeg(a.data))
        const x = p.create('OtherActual')
        x.set('m_strName', '')
        x.set('m_strLongName', '')
        x.set('m_pUIInfo', null)
        x.set('m_pImplManager', im.oid)
        x.set('m_pWorkSite', ws.oid)
        x.set('m_dateBegin', BigInt(b))
        x.set('m_dateEnd', BigInt(f))
        x.set('m_bLow', crescente)
        x.set('m_dAmount', a.quantidade)
        lista.push([ws.oid, x.oid])
      }
      // tarefa concluída: o realizado cobre a quantidade planejada
      const total = aps.reduce((s, a) => s + a.quantidade, 0)
      const plan = porId.get(id)?.quantidade ?? 0
      if (plan > 0 && total >= plan * 0.999) ws.set('m_bFinished', true)
    }
    im.setRaw('m_otherActuals', {
      kind: 'map',
      type: 0x15,
      keyType: lista.length ? 0x18 : null,
      valueType: lista.length ? 0x18 : null,
      entries: lista.map(([k, v]) => [encode(0x18, k as bigint), encode(0x18, v as bigint)])
    })
  })
  setControlDate(p, dataControle)

  // O `ForecastCalculator` agenda o saldo a partir do início desejado (data de controle ou fim do último realizado),
  // mas o Scheduler põe as tarefas ASAP no início do projeto: a previsão cairia no passado. Durante a previsão todas as
  // tarefas usam o início desejado (DECISOES D-07); depois o projeto volta como estava.
  const asap = [...entidades.values()].filter((ws) => ws.get('m_bASAP') === true)
  let frentes = new Map<bigint, ForecastFront[]>()
  if (asap.length)
    p.edit('InfraWork: previsão', () => asap.forEach((ws) => ws.set('m_bASAP', false)))
  try {
    frentes = forecast(p)
  } catch {
    frentes = new Map()
  } finally {
    if (asap.length)
      p.edit('InfraWork: previsão (fim)', () => asap.forEach((ws) => ws.set('m_bASAP', true)))
  }
  const sched = new Scheduler(p)
  const out: ResultadoControle = { data: dataControle, tarefas: {} }
  const trechoDoLugar = (ws: Entity, st0: number, st1: number): string | null => {
    // o lugar da previsão fica dentro de um work place da tarefa: o trecho é o do eixo desse work place
    for (const o of (ws.get('m_vpWorkPlaces') as unknown[] | undefined) ?? []) {
      const w = p.get(o as bigint)
      const loc = p.resolve(w?.get('m_pLocation') as Ref)
      const sb = Number(loc?.get('m_dStationBegin') ?? 0),
        se = Number(loc?.get('m_dStationEnd') ?? 0)
      if (st0 >= sb - 1e-6 && st1 <= se + 1e-6) {
        const eixo = p.resolve(loc?.get('m_pRoadLine') as Ref)
        return eixo?.className === 'Area'
          ? eixo.name === AREA_SEM_LOCAL
            ? null
            : eixo.name
          : (eixo?.name ?? null)
      }
    }
    return null
  }
  for (const [id, ws] of entidades) {
    const site = sched.sites.get(ws.oid)
    if (!site) continue
    const aps = reparto.get(id) ?? []
    const realizado = aps.reduce((s, a) => s + a.quantidade, 0)
    const fr = frentes.get(ws.oid) ?? []
    const lugares = fr.flatMap((f) => f.places)
    const temPrevisao = lugares.some((l) => !l.actual)
    const [ib, ie] = aps.length ? implementedTiming(p, ws) : [null, null]
    const taxaH = aps.length ? actualProductionRate(p, ws, site.calendar, true, true) : 0
    // horas de um dia cheio do calendário da tarefa (a taxa por dia de trabalho)
    const dia = isoParaSeg(c.data)
    const horasDia = Math.max(
      ...[0, 1, 2, 3, 4, 5, 6].map(
        (k) =>
          (site.calendar.AS2WS(dia + (k + 1) * DIA) - site.calendar.AS2WS(dia + k * DIA)) / 3600
      )
    )
    out.tarefas[id] = {
      realizado,
      grau: Math.max(0, Math.min(1, implementationDegree(p, ws, true))),
      inicio_real: ib,
      fim_real: ie,
      taxa_real: taxaH > 0 ? taxaH * (horasDia || 8) : null,
      fim_previsto: lugares.length ? Math.max(...lugares.map((l) => l.end)) : null,
      concluida: ws.get('m_bFinished') === true,
      frentes: fr.map((f) => ({
        crescente: f.low,
        lugares: f.places.map((l) => ({
          trecho_id: trechoDoLugar(ws, l.stationBegin, l.stationEnd),
          inicio_m: l.stationBegin,
          fim_m: l.stationEnd,
          inicio: l.begin,
          fim: l.end,
          quantidade: l.amount,
          realizado: l.actual
        }))
      }))
    }
    if (!temPrevisao && !aps.length) out.tarefas[id]!.fim_previsto = null
  }
  return out
}
