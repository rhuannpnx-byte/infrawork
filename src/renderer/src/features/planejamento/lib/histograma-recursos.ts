// ─── Histograma planejado de recursos ──────────────────────────────────────
// Cruza o cronograma (perfil_semanas, em unidades de serviço) com as composições
// congeladas (cpu_snapshot.payload) para distribuir, por semana, a demanda física
// de cada recurso.
//
// Modelo (validado nos dados reais — agregador CBUQ, Rev 11):
//   Na composição, por item de MO/Equipamento, `horas_dia` carrega a CONTAGEM (efetivo
//   de pessoas / frota de equipamentos) e `quantidade` carrega as horas/dia. Ex.: op.
//   espargidor q=10,h=1 ⇒ 1 operador × 10h; vibro acabadora q=9.09,h=1 ⇒ 1 máquina. A
//   linha com horas_dia=0 (lado CBUQ do espargidor) zera sozinha e não duplica.
//
//   • MO / EQUIPAMENTO (soma por tarefa/CPU ativa = × N tarefas concorrentes):
//       contagem  = Σ_CPUs horas_dia
//       'recursos' = contagem                 (efetivo/frota concorrente; NÃO usa dias úteis)
//       'dias'     = contagem × diasUteisAtivos (homem-dia)
//       'horas'    = Σ (quantidade × horas_dia) × diasUteisAtivos (homem-hora)
//   • COMBUSTÍVEL → litros/dia do item COMBUSTÍVEL (× dias úteis); fallback: derivar dos
//       equipamentos (Σ equip×consumo_lh×horas×indice) quando não houver item.
//   • MATERIAL → consumo_material_por_unid × cpuUnits, cpuUnits = apply(fator, Qₛ).
//       Só o material recebe o fator do serviço (varia com a produção).
//
// Dias úteis vêm do calendário da obra (dias_uteis_bitmask).

import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import type {
  CpuSnapshot,
  CpuSnapshotPayloadCpuItem,
  RecursoGrupo,
  ServicoCpuOperacao
} from '@/types/orcamento'

/** Métrica de MO/Equipamento: efetivo ativo, recurso-dias ou recurso-horas. */
export type UnidadeTempo = 'recursos' | 'dias' | 'horas'

/** Bitmask de dias úteis default (63 = Seg–Sáb). */
const BITMASK_DEFAULT = 63

export interface HistogramaOpts {
  unidadeTempo?: UnidadeTempo
  /** dias_uteis_bitmask da obra (bit0=Seg…bit6=Dom). Default 63 (Seg–Sáb). */
  bitmask?: number
}

export type HistogramaMetrica = 'tempo' | 'quantidade'

export interface RecursoHistograma {
  recurso_id: string
  nome: string
  unidade: string
  grupo: RecursoGrupo
  metrica: HistogramaMetrica
  /** semana ISO (segunda) → valor. */
  porSemana: Record<string, number>
  /** Soma das semanas (útil p/ material/combustível; efetivo não soma fisicamente). */
  total: number
  /** Maior valor semanal (pico — relevante p/ efetivo). */
  pico: number
}

export interface HistogramaResult {
  /** Eixo X: semanas ISO (segunda) ordenadas. */
  semanas: string[]
  recursos: RecursoHistograma[]
  /** Tarefas diretas com físico mas sem composição utilizável (puladas). */
  tarefasIgnoradas: number
}

interface UnidadeCpu {
  fator: number
  operacao: ServicoCpuOperacao
  /** Produção diária da CPU (unidade da CPU) — fallback p/ material por dia. */
  pCpu: number
  itens: CpuSnapshotPayloadCpuItem[]
}

/** Normaliza o snapshot (legado | agregador) em P_serviço + lista de unidades-CPU. */
function unidadesCpuDoSnapshot(snap: CpuSnapshot): { pServ: number; unidades: UnidadeCpu[] } {
  const pServ = Number(snap.producao_diaria_qtde) || 0
  const p = snap.payload
  if (p?.modo === 'agregador' && Array.isArray(p.cpus)) {
    return {
      pServ,
      unidades: p.cpus.map((c) => ({
        fator: Number(c.fator) || 1,
        operacao: c.operacao ?? 'dividir',
        pCpu: Number(c.cpu?.producao_diaria_qtde) || pServ || 1,
        itens: c.itens ?? []
      }))
    }
  }
  // Legado: 1 CPU única, sem fator.
  return {
    pServ,
    unidades: [
      {
        fator: 1,
        operacao: 'dividir',
        pCpu: Number(p?.cpu?.producao_diaria_qtde) || pServ || 1,
        itens: p?.itens ?? []
      }
    ]
  }
}

function aplicarFator(v: number, fator: number, operacao: ServicoCpuOperacao): number {
  const f = Number(fator) || 1
  if (!isFinite(f) || f === 0) return 0
  return operacao === 'multiplicar' ? v * f : v / f
}

/**
 * Dias úteis da semana ISO que estão no calendário da obra (bitmask) E dentro de
 * [inicio, fim] da tarefa. i: 0=Seg…6=Dom (mesma convenção de diasToBitmask).
 */
function diasUteisAtivos(
  semanaSegundaIso: string,
  inicioIso: string | null,
  fimIso: string | null,
  bitmask: number
): number {
  const segunda = new Date(`${semanaSegundaIso}T00:00:00Z`)
  let n = 0
  for (let i = 0; i < 7; i++) {
    if (!((bitmask >> i) & 1)) continue
    const d = new Date(segunda)
    d.setUTCDate(segunda.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    if (!inicioIso || !fimIso || (iso >= inicioIso && iso <= fimIso)) n++
  }
  return n
}

const ORDEM_GRUPO: Record<RecursoGrupo, number> = {
  MO: 0,
  MVE: 1,
  COMBUSTIVEL: 2,
  MATERIAL: 3,
  ADM: 4
}

export function calcularHistogramaRecursos(
  tarefas: PlanejamentoTarefaCompleta[],
  snapshotsById: Map<string, CpuSnapshot>,
  opts: HistogramaOpts = {}
): HistogramaResult {
  const unidadeTempo = opts.unidadeTempo ?? 'recursos'
  const bitmask = opts.bitmask && opts.bitmask > 0 ? opts.bitmask : BITMASK_DEFAULT
  const acc = new Map<string, RecursoHistograma>()
  let tarefasIgnoradas = 0

  const empurrar = (
    rec: CpuSnapshotPayloadCpuItem['recurso'],
    metrica: HistogramaMetrica,
    semana: string,
    valor: number
  ): void => {
    if (!valor) return
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
    h.porSemana[semana] = (h.porSemana[semana] ?? 0) + valor
  }

  for (const t of tarefas) {
    if (t.tipo_no !== 'tarefa') continue // só folhas
    if (t.is_indireto) continue // indiretas não têm recursos físicos
    const semanas = t.perfil_semanas ?? []
    if (semanas.length === 0) continue

    const snap = t.cpu_snapshot_id ? snapshotsById.get(t.cpu_snapshot_id) : undefined
    if (!snap) {
      tarefasIgnoradas++
      continue
    }
    const { unidades } = unidadesCpuDoSnapshot(snap)
    if (!unidades.some((u) => u.itens.length > 0)) {
      tarefasIgnoradas++
      continue
    }

    for (const u of unidades) {
      const pCpuSafe = u.pCpu > 0 ? u.pCpu : 1
      // Combustível: litros/dia = quantidade do(s) item(ns) COMBUSTÍVEL. Fallback:
      // derivar dos equipamentos (Σ equip×consumo_lh×horas×indice) se o item não trouxer.
      const combItens = u.itens.filter((it) => it.grupo === 'COMBUSTIVEL')
      let litrosDia = combItens.reduce((a, it) => a + Number(it.quantidade || 0), 0)
      if (litrosDia <= 0) {
        let litrosDiaEq = 0
        for (const it of u.itens) {
          if (it.grupo === 'EQUIPAMENTO') {
            litrosDiaEq +=
              Number(it.quantidade || 0) *
              Number(it.consumo_combustivel_lh || 0) *
              Number(it.horas_dia || 0) *
              (Number(it.indice_produtividade) || 1)
          }
        }
        litrosDia = litrosDiaEq
      }
      const combRecurso = combItens[0]?.recurso

      for (const s of semanas) {
        const qs = Number(s.quantidade_planejada || 0)
        if (qs <= 0) continue
        // Material: unidades-da-CPU p/ produzir Qₛ unid. de serviço (fator converte).
        const cpuUnits = aplicarFator(qs, u.fator, u.operacao)
        // Dias úteis em que a tarefa está ativa nesta semana (calendário da obra).
        const dW = diasUteisAtivos(s.semana_segunda, t.data_inicio, t.data_fim, bitmask)

        for (const it of u.itens) {
          if (it.grupo === 'MO' || it.grupo === 'EQUIPAMENTO') {
            // horas_dia = CONTAGEM (efetivo/frota); quantidade = horas/dia.
            const count = Number(it.horas_dia || 0)
            if (count <= 0) continue
            const valor =
              unidadeTempo === 'horas'
                ? Number(it.quantidade || 0) * count * dW // homem-hora
                : unidadeTempo === 'dias'
                  ? count * dW // homem-dia
                  : count // 'recursos' = contagem concorrente
            empurrar(it.recurso, 'tempo', s.semana_segunda, valor)
          } else if (it.grupo === 'MATERIAL') {
            // Quantidade consumida = consumo por unidade-CPU × unidades-CPU (com fator).
            const base =
              it.consumo_material_por_unid != null
                ? Number(it.consumo_material_por_unid)
                : Number(it.quantidade || 0) / pCpuSafe
            empurrar(it.recurso, 'quantidade', s.semana_segunda, base * cpuUnits)
          }
          // COMBUSTIVEL item: tratado abaixo (litros × dias úteis).
        }

        if (combRecurso && litrosDia > 0) {
          empurrar(combRecurso, 'quantidade', s.semana_segunda, litrosDia * dW)
        }
      }
    }
  }

  const semanasSet = new Set<string>()
  for (const h of acc.values()) for (const k of Object.keys(h.porSemana)) semanasSet.add(k)
  const semanas = Array.from(semanasSet).sort()

  const recursos = Array.from(acc.values()).map((h) => {
    const vals = semanas.map((s) => h.porSemana[s] ?? 0)
    return {
      ...h,
      total: vals.reduce((a, b) => a + b, 0),
      pico: vals.reduce((a, b) => Math.max(a, b), 0)
    }
  })
  recursos.sort(
    (a, b) =>
      (ORDEM_GRUPO[a.grupo] ?? 9) - (ORDEM_GRUPO[b.grupo] ?? 9) ||
      a.nome.localeCompare(b.nome, 'pt-BR')
  )

  return { semanas, recursos, tarefasIgnoradas }
}

// ─── Expansão por tarefa (export MS Project) ────────────────────────────────
// Reaproveita a MESMA mecânica do histograma (unidadesCpuDoSnapshot/aplicarFator +
// a leitura horas_dia = CONTAGEM e quantidade = horas/dia) para gerar, por tarefa-
// folha, os recursos e atribuições do MS Project. As tarefas saem com agendamento
// manual, então o Project distribui cada atribuição uniformemente (contorno flat)
// pela duração da tarefa:
//   • MO / Equipamento → recurso de Trabalho. Units = CONTAGEM concorrente
//     (Σ horas_dia), exatamente como a "visão de recursos". Work = contagem ×
//     jornada × dias úteis, de modo que o pico de unidades no gráfico = a contagem.
//   • Material / Combustível → recurso de Material. Units = consumo por DIA útil
//     (= base × aplicarFator(produção diária); combustível já é litros/dia), e o
//     total = taxa × dias úteis com FixedMaterial=0; o Project distribui o total
//     pela duração e reproduz o consumo/dia do histograma.

/** Jornada (h/dia) assumida pelo calendário padrão do MS Project. */
const JORNADA_MSP = 8

/** Recurso único do projeto (UID é atribuído pelo serializer, não aqui). */
export interface MspResourceDef {
  recurso_id: string
  nome: string
  /** 0 = Material (MATERIAL/COMBUSTIVEL), 1 = Trabalho (MO/Equipamento). */
  type: 0 | 1
  /** Unidade do recurso (MaterialLabel) — só p/ Type 0. */
  materialLabel?: string
  grupo: RecursoGrupo
  codigo: string | null
}

/** Atribuição (tarefa × recurso) com os valores da tarefa. */
export interface MspAssignmentDef {
  tarefaId: string
  recurso_id: string
  type: 0 | 1
  /**
   * Trabalho (Type 1): CONTAGEM concorrente de recursos (= "visão de recursos").
   * Material (Type 0): consumo por dia útil (produção diária × consumo unitário).
   */
  units: number
  /** Horas de trabalho totais (Type 1) = contagem × jornada × dias úteis. */
  workHoras?: number
  /** Quantidade total consumida (Type 0) = consumo/dia × dias úteis. */
  quantidade?: number
}

export interface ExpandirRecursosResult {
  recursos: MspResourceDef[]
  assignments: MspAssignmentDef[]
  /** Tarefas diretas com físico mas sem composição utilizável (puladas). */
  tarefasIgnoradas: number
}

/** Acumulador por (tarefa, recurso). */
interface AcumTarefaRecurso {
  /** Contagem concorrente (Σ horas_dia) — recursos de Trabalho. */
  count: number
  /** Consumo por dia útil (produção diária) — recursos de Material. */
  ratePerDay: number
}

export function expandirRecursosPorTarefa(
  tarefas: PlanejamentoTarefaCompleta[],
  snapshotsById: Map<string, CpuSnapshot>
): ExpandirRecursosResult {
  const recursos = new Map<string, MspResourceDef>()
  // tarefaId → (recurso_id → acumulador) e tarefaId → dias úteis.
  const perTask = new Map<string, Map<string, AcumTarefaRecurso>>()
  const perTaskDuration = new Map<string, number>()
  let tarefasIgnoradas = 0

  const registrar = (rec: CpuSnapshotPayloadCpuItem['recurso']): void => {
    if (recursos.has(rec.id)) return
    // Type pelo grupo do RECURSO (MVE = equipamento → Trabalho); MATERIAL/COMBUSTIVEL → Material.
    const type: 0 | 1 = rec.grupo === 'MATERIAL' || rec.grupo === 'COMBUSTIVEL' ? 0 : 1
    recursos.set(rec.id, {
      recurso_id: rec.id,
      nome: rec.nome,
      type,
      materialLabel: type === 0 ? rec.unidade : undefined,
      grupo: rec.grupo,
      codigo: rec.codigo
    })
  }

  const acumular = (tarefaId: string, recursoId: string): AcumTarefaRecurso => {
    let m = perTask.get(tarefaId)
    if (!m) {
      m = new Map()
      perTask.set(tarefaId, m)
    }
    let a = m.get(recursoId)
    if (!a) {
      a = { count: 0, ratePerDay: 0 }
      m.set(recursoId, a)
    }
    return a
  }

  for (const t of tarefas) {
    if (t.tipo_no !== 'tarefa') continue
    if (t.is_indireto) continue
    const semanas = t.perfil_semanas ?? []
    if (semanas.length === 0) continue

    const snap = t.cpu_snapshot_id ? snapshotsById.get(t.cpu_snapshot_id) : undefined
    if (!snap) {
      tarefasIgnoradas++
      continue
    }
    const { pServ, unidades } = unidadesCpuDoSnapshot(snap)
    if (!unidades.some((u) => u.itens.length > 0)) {
      tarefasIgnoradas++
      continue
    }
    const totalQs = semanas.reduce((acc, s) => acc + Number(s.quantidade_planejada || 0), 0)
    // Dias úteis = a duração que o Project usa (agendamento manual). Fallback: dias
    // de operação (Qₛ / produção) se a duração não veio calculada.
    const pServSafe = pServ > 0 ? pServ : 1
    const durationDays =
      Number(t.duracao_dias_uteis_calc) > 0
        ? Number(t.duracao_dias_uteis_calc)
        : Math.max(1, totalQs / pServSafe)
    perTaskDuration.set(t.id, durationDays)

    for (const u of unidades) {
      const pCpuSafe = u.pCpu > 0 ? u.pCpu : 1
      // Combustível: litros/dia = Σ quantidade dos itens COMBUSTÍVEL; fallback:
      // derivar dos equipamentos (Σ contagem × horas/dia × consumo_lh × índice).
      const combItens = u.itens.filter((it) => it.grupo === 'COMBUSTIVEL')
      let litrosDia = combItens.reduce((acc, it) => acc + Number(it.quantidade || 0), 0)
      if (litrosDia <= 0) {
        let litrosDiaEq = 0
        for (const it of u.itens) {
          if (it.grupo === 'EQUIPAMENTO') {
            litrosDiaEq +=
              Number(it.quantidade || 0) *
              Number(it.consumo_combustivel_lh || 0) *
              Number(it.horas_dia || 0) *
              (Number(it.indice_produtividade) || 1)
          }
        }
        litrosDia = litrosDiaEq
      }
      const combRecurso = combItens[0]?.recurso

      for (const it of u.itens) {
        if (it.grupo === 'MO' || it.grupo === 'EQUIPAMENTO') {
          // horas_dia = CONTAGEM (efetivo/frota). Item com contagem 0 é ignorado.
          const count = Number(it.horas_dia || 0)
          if (count <= 0) continue
          registrar(it.recurso)
          acumular(t.id, it.recurso.id).count += count
        } else if (it.grupo === 'MATERIAL') {
          // Consumo/dia = consumo por unidade-CPU × unidades-CPU/dia, onde
          // unidades-CPU/dia = aplicarFator(produção diária do serviço). Igual ao
          // por-dia do histograma (Qₛ/dia ≈ pServ), independente da quantidade total.
          const base =
            it.consumo_material_por_unid != null
              ? Number(it.consumo_material_por_unid)
              : Number(it.quantidade || 0) / pCpuSafe
          registrar(it.recurso)
          acumular(t.id, it.recurso.id).ratePerDay += base * aplicarFator(pServ, u.fator, u.operacao)
        }
      }

      if (combRecurso && litrosDia > 0) {
        // Combustível já é litros/DIA.
        registrar(combRecurso)
        acumular(t.id, combRecurso.id).ratePerDay += litrosDia
      }
    }
  }

  const assignments: MspAssignmentDef[] = []
  for (const [tarefaId, m] of perTask) {
    const D = perTaskDuration.get(tarefaId) ?? 1
    for (const [recursoId, a] of m) {
      const def = recursos.get(recursoId)
      if (!def) continue
      if (def.type === 1) {
        if (a.count <= 0) continue
        // Units = contagem concorrente (visão de recursos). Work coerente p/ que o
        // pico de unidades no gráfico do Project seja exatamente a contagem.
        assignments.push({
          tarefaId,
          recurso_id: recursoId,
          type: 1,
          units: a.count,
          workHoras: a.count * JORNADA_MSP * D
        })
      } else {
        if (a.ratePerDay <= 0) continue
        // Material/combustível: Units = consumo por dia útil (produção diária);
        // total = taxa × dias úteis. Com FixedMaterial=0 o Project distribui o
        // total pela duração, reproduzindo o consumo/dia do histograma.
        assignments.push({
          tarefaId,
          recurso_id: recursoId,
          type: 0,
          units: a.ratePerDay,
          quantidade: a.ratePerDay * D
        })
      }
    }
  }

  return { recursos: Array.from(recursos.values()), assignments, tarefasIgnoradas }
}

/** Unidade exibida do recurso conforme a métrica/tempo escolhido. */
export function unidadeEfetiva(rec: RecursoHistograma, unidadeTempo: UnidadeTempo): string {
  if (rec.metrica === 'tempo') {
    if (unidadeTempo === 'horas') return 'h'
    if (unidadeTempo === 'dias') return 'dia'
    return 'un' // 'recursos' (efetivo ativo)
  }
  return rec.unidade
}

export const RECURSO_GRUPO_LABEL: Record<RecursoGrupo, string> = {
  MO: 'Mão de obra',
  MVE: 'Equipamentos',
  COMBUSTIVEL: 'Combustível',
  MATERIAL: 'Material',
  ADM: 'Administrativo'
}
