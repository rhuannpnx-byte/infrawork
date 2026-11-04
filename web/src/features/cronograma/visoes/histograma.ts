/**
 * Histograma planejado de recursos por semana — a apresentação do InfraWork desktop sobre o cálculo do web:
 *  - Mão de obra e equipamentos: o uso que o motor calculou (`resultado.recursos`, unidades simultâneas no tempo,
 *    já com nivelamento e calendário). "Recursos" = pico simultâneo na semana; "Horas" = Σ unidades × horas de
 *    trabalho do calendário na semana; "Dias" = horas ÷ jornada de referência.
 *  - Material: quantidade da tarefa na semana (perfil semanal) × consumo por unidade da composição (com o fator e a
 *    operação do vínculo serviço → CPU), como no desktop.
 *  - Combustível: litros/dia dos equipamentos da composição (quantidade × l/h × horas/dia × índice) × equipes ×
 *    dias com produção da tarefa na semana.
 */
import type { Calendar } from '@apex/calendar'
import type { ResultadoCalculo } from '../motor/calculo'
import { DIA, segundaDaSemana, segParaData } from '../motor/tempo'
import type { PlanoEntrada } from '../motor/tipos'
import type { UnidadeComposicao } from '../hooks/composicoes'
import type { RecursoGrupo } from '@/types/orcamento'

export type UnidadeTempo = 'recursos' | 'dias' | 'horas'

export interface RecursoHistograma {
  recurso_id: string
  nome: string
  unidade: string
  grupo: RecursoGrupo
  metrica: 'tempo' | 'quantidade'
  /** semana ("AAAA-MM-DD" da segunda) → valor */
  porSemana: Record<string, number>
  total: number
  pico: number
}

export interface HistogramaResultado {
  semanas: string[]
  recursos: RecursoHistograma[]
}

export const GRUPO_LABEL: Record<RecursoGrupo, string> = {
  MO: 'Mão de obra',
  MVE: 'Equipamentos',
  COMBUSTIVEL: 'Combustível',
  MATERIAL: 'Material',
  ADM: 'Administrativo'
}
export const ORDEM_GRUPOS: RecursoGrupo[] = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM']

export function unidadeEfetiva(r: RecursoHistograma, u: UnidadeTempo): string {
  if (r.metrica === 'tempo') return u === 'horas' ? 'h' : u === 'dias' ? 'dia' : 'un'
  return r.unidade
}

const aplicarFator = (v: number, fator: number, operacao: 'dividir' | 'multiplicar'): number => {
  const f = Number(fator) || 1
  return operacao === 'multiplicar' ? v * f : v / f
}

export function montarHistograma(
  e: PlanoEntrada,
  r: ResultadoCalculo,
  composicoes: ReadonlyMap<string, UnidadeComposicao[]>,
  o: { unidadeTempo: UnidadeTempo; calendario: Calendar; jornada: number }
): HistogramaResultado {
  const acc = new Map<string, RecursoHistograma>()
  const somar = (
    rec: { id: string; nome: string; unidade: string; grupo: RecursoGrupo },
    metrica: 'tempo' | 'quantidade',
    semana: string,
    valor: number,
    pico = false
  ): void => {
    if (!(valor > 0)) return
    let h = acc.get(rec.id)
    if (!h) {
      h = {
        recurso_id: rec.id,
        nome: rec.nome,
        unidade: rec.unidade,
        grupo: rec.grupo,
        metrica,
        porSemana: {},
        total: 0,
        pico: 0
      }
      acc.set(rec.id, h)
    }
    h.porSemana[semana] = pico
      ? Math.max(h.porSemana[semana] ?? 0, valor)
      : (h.porSemana[semana] ?? 0) + valor
  }

  // ── mão de obra e equipamentos: o uso calculado pelo motor
  const infoRecurso = new Map<string, { nome: string; grupo: RecursoGrupo }>()
  for (const q of e.equipes)
    for (const x of q.recursos)
      infoRecurso.set(x.recurso_id, {
        nome: x.nome,
        grupo: (x.grupo === 'EQUIPAMENTO' ? 'MVE' : (x.grupo ?? 'MVE')) as RecursoGrupo
      })
  const cal = o.calendario
  for (const u of r.recursos) {
    const info = infoRecurso.get(u.recurso_id)
    if (!info) continue
    const rec = { id: u.recurso_id, nome: info.nome, unidade: 'un', grupo: info.grupo }
    for (const [a, b, unid] of u.spans) {
      if (!(unid > 0) || !(b > a)) continue
      for (let w = segundaDaSemana(a); w < b; w += 7 * DIA) {
        const lo = Math.max(a, w),
          hi = Math.min(b, w + 7 * DIA)
        const horas = (cal.AS2WS(hi) - cal.AS2WS(lo)) / 3600
        if (!(horas > 1e-9)) continue
        const semana = segParaData(w)
        if (o.unidadeTempo === 'recursos') somar(rec, 'tempo', semana, unid, true)
        else if (o.unidadeTempo === 'horas') somar(rec, 'tempo', semana, unid * horas)
        else somar(rec, 'tempo', semana, (unid * horas) / (o.jornada || 8))
      }
    }
  }

  // ── material e combustível: as composições do serviço sobre o perfil da tarefa
  for (const t of e.tarefas) {
    if (t.tipo_no !== 'tarefa' || t.is_indireto || !t.servico_id) continue
    const unidades = composicoes.get(t.servico_id)
    const semanal = r.perfilSemana.get(t.id)
    if (!unidades?.length || !semanal) continue
    const diasComProducao = new Map<string, number>()
    for (const [dia, q] of r.perfilDia.get(t.id) ?? []) {
      if (!(q > 0)) continue
      const s = segParaData(segundaDaSemana(Date.parse(dia + 'T00:00:00Z') / 1000))
      diasComProducao.set(s, (diasComProducao.get(s) ?? 0) + 1)
    }
    const equipes = Math.max(1, Math.round(t.qtd_equipes || 1))
    for (const un of unidades) {
      const pCpu = un.producao > 0 ? un.producao : 1
      const litrosDia = un.itens
        .filter((it) => it.grupo === 'EQUIPAMENTO')
        .reduce(
          (s, it) =>
            s +
            it.quantidade *
              it.consumo_combustivel_lh *
              it.horas_dia *
              (it.indice_produtividade || 1),
          0
        )
      const comb = un.itens.find((it) => it.grupo === 'COMBUSTIVEL')?.recurso
      for (const [semana, q] of semanal) {
        if (!(q > 0)) continue
        const cpuUnidades = aplicarFator(q, un.fator, un.operacao)
        for (const it of un.itens) {
          if (it.grupo !== 'MATERIAL') continue
          const porUnidade =
            it.consumo_material_por_unid !== null
              ? it.consumo_material_por_unid
              : it.quantidade / pCpu
          somar(
            { ...it.recurso, grupo: 'MATERIAL' },
            'quantidade',
            semana,
            porUnidade * cpuUnidades
          )
        }
        if (comb && litrosDia > 0)
          somar(
            { ...comb, grupo: 'COMBUSTIVEL', unidade: comb.unidade || 'l' },
            'quantidade',
            semana,
            litrosDia * equipes * (diasComProducao.get(semana) ?? 0)
          )
      }
    }
  }

  // semanas contínuas do primeiro ao último uso
  const chaves = [...acc.values()].flatMap((h) => Object.keys(h.porSemana)).sort()
  const semanas: string[] = []
  if (chaves.length) {
    const ultimo = chaves[chaves.length - 1]!
    for (
      let w = Date.parse(chaves[0]! + 'T00:00:00Z') / 1000;
      segParaData(w) <= ultimo;
      w += 7 * DIA
    )
      semanas.push(segParaData(w))
  }
  const ordem = new Map(ORDEM_GRUPOS.map((g, i) => [g, i]))
  const recursos = [...acc.values()]
    .map((h) => {
      const vals = semanas.map((s) => h.porSemana[s] ?? 0)
      return { ...h, total: vals.reduce((a, b) => a + b, 0), pico: Math.max(0, ...vals) }
    })
    .sort(
      (a, b) =>
        (ordem.get(a.grupo) ?? 9) - (ordem.get(b.grupo) ?? 9) ||
        a.nome.localeCompare(b.nome, 'pt-BR')
    )
  return { semanas, recursos }
}
