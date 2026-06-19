// Serializa o cronograma InfraWork em MS Project XML (Project Data Interchange).
// O usuário abre o .xml no MS Project via Arquivo → Abrir.
//
// Mapeamentos:
//   nivel            → OutlineLevel
//   codigo_eap       → WBS / OutlineNumber
//   tipo_no grupo    → Summary=1; marco → Milestone=1
//   data_inicio/fim  → Start/Finish (YYYY-MM-DDThh:mm:ss)
//   duracao_dias     → Duration ISO (PT{h}H..), h = dias úteis × jornada 8h
//   dependências     → PredecessorLink (Type 0=FF/1=FS/2=SF/3=SS, LinkLag em dias)
// Campos sem equivalente nativo vão em ExtendedAttributes (custom fields):
//   Text1=infrawork_id (UUID, reconciliação round-trip), Text2=código item,
//   Text3=trecho, Text4=equipes, Text5=unidade, Number1=quantidade,
//   Number2/3=posição início/fim (m).

import type {
  DependenciaTipo,
  PlanejamentoDependencia,
  PlanejamentoTarefaCompleta
} from '@/types/planejamento'
import type { CpuSnapshot } from '@/types/orcamento'
import { buildTaskTree } from './eap'
import { expandirRecursosPorTarefa } from './histograma-recursos'

const HORAS_DIA = 8

/** FieldIDs canônicos dos custom fields do MS Project (estáveis). */
export const MSP_FIELD = {
  text1: 188743731, // InfraWork ID
  text2: 188743734, // Código item
  text3: 188743737, // Trecho
  text4: 188743740, // Equipes
  text5: 188743743, // Unidade
  number1: 188743767, // Quantidade
  number2: 188743770, // Posição início (m)
  number3: 188743773 // Posição fim (m)
} as const

const FIELD_DEFS: Array<{ id: number; nome: string }> = [
  { id: MSP_FIELD.text1, nome: 'InfraWork ID' },
  { id: MSP_FIELD.text2, nome: 'Código item' },
  { id: MSP_FIELD.text3, nome: 'Trecho' },
  { id: MSP_FIELD.text4, nome: 'Equipes' },
  { id: MSP_FIELD.text5, nome: 'Unidade' },
  { id: MSP_FIELD.number1, nome: 'Quantidade' },
  { id: MSP_FIELD.number2, nome: 'Posição início (m)' },
  { id: MSP_FIELD.number3, nome: 'Posição fim (m)' }
]

/**
 * Tipo de dependência InfraWork → código MS Project (PredecessorLink.Type).
 * Atenção: a tabela oficial do MSP é 0=FF, 1=FS, **2=SF, 3=SS** (SF e SS NÃO
 * seguem a ordem intuitiva). Inverter aqui faz SS virar "Início-Término".
 */
const TIPO_TO_MSP: Record<DependenciaTipo, number> = { FF: 0, FS: 1, SF: 2, SS: 3 }

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dt(iso: string | null, fim = false): string | null {
  if (!iso) return null
  return `${iso}T${fim ? '17:00:00' : '08:00:00'}`
}

function durIso(diasUteis: number | null): string {
  const h = Math.max(0, Math.round((diasUteis ?? 0) * HORAS_DIA))
  return `PT${h}H0M0S`
}

function lagTenths(lagDias: number): number {
  // MS Project LinkLag em décimos de minuto; 1 dia útil = 8h = 4800 décimos.
  return Math.round(lagDias * HORAS_DIA * 60 * 10)
}

export interface BuildMsProjectInput {
  projectName: string
  /** Tarefas na ordem de exibição (já ordenadas por `ordem`/EAP). */
  tarefas: PlanejamentoTarefaCompleta[]
  dependencias: PlanejamentoDependencia[]
  /** bitmask de dias úteis (bit0=seg..bit6=dom). Default 31 (seg-sex). */
  bitmask?: number
  /**
   * cpu_snapshot por id. Quando presente, emite <Resources>/<Assignments> p/ que
   * o gráfico de recursos do Project reproduza o Histograma planejado.
   */
  snapshotsById?: Map<string, CpuSnapshot>
}

function calendarioXml(bitmask: number): string {
  // DayType MSP: 1=Dom,2=Seg,...,7=Sáb. ourBit: dom=6, seg=0..sex=4, sáb=5.
  const dias: string[] = []
  for (let dayType = 1; dayType <= 7; dayType++) {
    const ourBit = dayType === 1 ? 6 : dayType - 2
    const working = (bitmask >> ourBit) & 1 ? 1 : 0
    const wt = working
      ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>' +
        '<WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
      : ''
    dias.push(`<WeekDay><DayType>${dayType}</DayType><DayWorking>${working}</DayWorking>${wt}</WeekDay>`)
  }
  return `<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar>` +
    `<WeekDays>${dias.join('')}</WeekDays></Calendar></Calendars>`
}

function extAttrDefsXml(): string {
  const defs = FIELD_DEFS.map(
    (f) => `<ExtendedAttribute><FieldID>${f.id}</FieldID><FieldName>${xmlEsc(f.nome)}</FieldName><Alias>${xmlEsc(f.nome)}</Alias></ExtendedAttribute>`
  ).join('')
  return `<ExtendedAttributes>${defs}</ExtendedAttributes>`
}

function nomeTarefa(t: PlanejamentoTarefaCompleta): string {
  return (
    t.nome_custom ||
    t.servico_grupo_descricao ||
    t.servico_nome ||
    (t.tipo_no === 'marco' ? 'Marco' : t.tipo_no === 'grupo' ? 'Grupo' : 'Tarefa')
  )
}

export function buildMsProjectXml(input: BuildMsProjectInput): string {
  const { projectName, dependencias } = input
  const bitmask = input.bitmask ?? 31

  // O MS Project deriva a hierarquia (tarefa-resumo/pai) da ORDEM do documento
  // + OutlineLevel, não do flag <Summary>. Por isso precisamos emitir em ordem
  // DFS (pai imediatamente antes dos filhos) com OutlineLevel = profundidade+1
  // e Summary=1 só para nós que de fato têm filhos. Caso contrário, uma folha
  // ou marco que precede tarefas de nível maior vira "pai" e qualquer link
  // entre eles é lido como referência circular. `buildTaskTree.flat` já entrega
  // essa ordem com `depth` e `children`.
  const { flat } = buildTaskTree(input.tarefas)

  // UID sequencial estável (ordem DFS); mapa tarefaId → uid p/ predecessores.
  const uidById = new Map<string, number>()
  flat.forEach((t, i) => uidById.set(t.id, i + 1))

  // Conjunto de ancestrais por id (para descartar links pai↔descendente, que o
  // MS Project rejeita como referência circular).
  const ancestors = new Map<string, Set<string>>()
  for (const t of flat) {
    const set = new Set<string>()
    let p = t.parent_id
    const guard = new Set<string>()
    while (p && !guard.has(p)) {
      set.add(p)
      guard.add(p)
      p = flat.find((x) => x.id === p)?.parent_id ?? null
    }
    ancestors.set(t.id, set)
  }
  const isAncestorRelated = (a: string, b: string): boolean =>
    (ancestors.get(a)?.has(b) ?? false) || (ancestors.get(b)?.has(a) ?? false)

  // Nós-resumo (têm filhos) não recebem datas/dependências próprias — o MSP
  // calcula o rollup. Guardamos quais ids são resumo para filtrar links.
  const isSummaryId = new Set<string>()
  for (const t of flat) if (t.children.length > 0) isSummaryId.add(t.id)

  // Predecessores por sucessora.
  const predsBySucc = new Map<string, PlanejamentoDependencia[]>()
  for (const d of dependencias) {
    const arr = predsBySucc.get(d.sucessora_id) ?? []
    arr.push(d)
    predsBySucc.set(d.sucessora_id, arr)
  }

  // Início do projeto = menor data_inicio entre as folhas/marcos. Sem isso o
  // MS Project assume a data atual como início e avisa que tarefas anteriores
  // a ela "começam antes do projeto".
  let minStart: string | null = null
  for (const t of flat) {
    if (t.children.length > 0 || !t.data_inicio) continue
    if (!minStart || t.data_inicio < minStart) minStart = t.data_inicio
  }
  const projStart = dt(minStart)

  const tasksXml = flat
    .map((t, i) => {
      const uid = i + 1
      const isSummary = t.children.length > 0
      const isMarco = t.tipo_no === 'marco' && !isSummary
      const outlineLevel = t.depth + 1
      const start = isSummary ? null : dt(t.data_inicio)
      const finish = isSummary ? null : dt(isMarco ? t.data_inicio : t.data_fim, true)
      const ext: string[] = []
      const pushText = (id: number, v: string | null | undefined): void => {
        if (v != null && v !== '') ext.push(`<ExtendedAttribute><FieldID>${id}</FieldID><Value>${xmlEsc(String(v))}</Value></ExtendedAttribute>`)
      }
      const pushNum = (id: number, v: number | null | undefined): void => {
        if (v != null) ext.push(`<ExtendedAttribute><FieldID>${id}</FieldID><Value>${v}</Value></ExtendedAttribute>`)
      }
      pushText(MSP_FIELD.text1, t.id)
      pushText(MSP_FIELD.text2, t.servico_grupo_codigo)
      pushText(MSP_FIELD.text3, t.trecho_nome)
      pushText(MSP_FIELD.text4, (t.equipes ?? []).map((e) => e.nome).join(', ') || null)
      pushText(MSP_FIELD.text5, t.unidade_servico)
      pushNum(MSP_FIELD.number1, t.quantidade_alocada)
      pushNum(MSP_FIELD.number2, t.posicao_inicio_m)
      pushNum(MSP_FIELD.number3, t.posicao_fim_m)

      // Nós-resumo não carregam dependências próprias no MSP (o rollup cuida).
      // Filtramos links inválidos: predecessor inexistente, auto-loop, link
      // com nó-resumo, ou link pai↔descendente — todos viram "referência
      // circular" ao abrir no Project.
      const preds = isSummary
        ? ''
        : (predsBySucc.get(t.id) ?? [])
            .map((d) => {
              const puid = uidById.get(d.predecessora_id)
              if (!puid) return ''
              if (d.predecessora_id === t.id) return ''
              if (isSummaryId.has(d.predecessora_id)) return ''
              if (isAncestorRelated(d.predecessora_id, t.id)) return ''
              return `<PredecessorLink><PredecessorUID>${puid}</PredecessorUID><Type>${TIPO_TO_MSP[d.tipo]}</Type><LinkLag>${lagTenths(d.lag_dias)}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`
            })
            .join('')

      // Ordem dos elementos conforme o esquema MSPDI (mspdi_pj12.xsd). Manter a
      // sequência canônica é essencial p/ que campos como ConstraintType sejam
      // aceitos (fora de ordem, o Project os descarta).
      //
      // Datas: tarefas-folha/marco saem como DURAÇÃO FIXA (Type=1) e NÃO
      // effort-driven, p/ que o Project não recalcule a duração a partir do
      // Trabalho dos recursos; e com restrição "Não iniciar antes de" (SNET=4) na
      // data planejada, p/ ancorar o início (sem isso o Project agenda ASAP e puxa
      // tudo p/ o começo do projeto). SNET é flexível → sem diálogo de conflito.
      const isLeaf = !isSummary
      return [
        '<Task>',
        `<UID>${uid}</UID>`,
        `<ID>${uid}</ID>`,
        `<Name>${xmlEsc(nomeTarefa(t))}</Name>`,
        isLeaf ? '<Type>1</Type>' : '', // 1 = Duração Fixa
        `<WBS>${xmlEsc(t.codigo_eap ?? String(uid))}</WBS>`,
        `<OutlineNumber>${xmlEsc(t.codigo_eap ?? String(uid))}</OutlineNumber>`,
        `<OutlineLevel>${outlineLevel}</OutlineLevel>`,
        start ? `<Start>${start}</Start>` : '',
        finish ? `<Finish>${finish}</Finish>` : '',
        isLeaf ? `<Duration>${durIso(isMarco ? 0 : t.duracao_dias_uteis_calc)}</Duration>` : '',
        isLeaf ? '<DurationFormat>7</DurationFormat>' : '',
        isLeaf ? '<EffortDriven>0</EffortDriven>' : '',
        `<Milestone>${isMarco ? 1 : 0}</Milestone>`,
        `<Summary>${isSummary ? 1 : 0}</Summary>`,
        '<PercentComplete>0</PercentComplete>',
        isLeaf && start ? `<ConstraintType>4</ConstraintType>` : '', // 4 = Não iniciar antes de
        isLeaf && start ? `<ConstraintDate>${start}</ConstraintDate>` : '',
        preds,
        ext.join(''),
        '</Task>'
      ].join('')
    })
    .join('')

  // ─── Recursos e atribuições (opcional) ──────────────────────────────────
  // Quando há snapshots, expandimos as composições em recursos individuais e
  // atribuições por tarefa-folha. O MS Project espalha cada total (Work em horas
  // p/ Trabalho; quantidade p/ Material) pela duração da tarefa, reproduzindo o
  // Histograma planejado. A ordem dos elementos no MSPDI é rígida (fora de ordem
  // = descartado): Resource = UID,ID,Name,Type,IsNull,MaterialLabel,MaxUnits;
  // Assignment = UID,TaskUID,ResourceUID,FixedMaterial,Units,Work.
  let resourcesXml = ''
  let assignmentsXml = ''
  if (input.snapshotsById && input.snapshotsById.size > 0) {
    const { recursos, assignments } = expandirRecursosPorTarefa(input.tarefas, input.snapshotsById)

    const resUidById = new Map<string, number>()
    recursos.forEach((r, i) => resUidById.set(r.recurso_id, i + 1))

    // MaxUnits folgado = pico de unidades em paralelo do recurso (mín. 1), p/
    // evitar superalocação em vermelho no Project.
    const maxUnitsById = new Map<string, number>()
    for (const a of assignments) {
      if (a.type !== 1) continue
      maxUnitsById.set(a.recurso_id, Math.max(maxUnitsById.get(a.recurso_id) ?? 0, a.units))
    }

    if (recursos.length > 0) {
      const recXml = recursos
        .map((r, i) => {
          const uid = i + 1
          const parts = [
            '<Resource>',
            `<UID>${uid}</UID>`,
            `<ID>${uid}</ID>`,
            `<Name>${xmlEsc(r.nome)}</Name>`,
            `<Type>${r.type}</Type>`,
            '<IsNull>0</IsNull>'
          ]
          if (r.type === 0) {
            parts.push(`<MaterialLabel>${xmlEsc(materialLabel(r.materialLabel))}</MaterialLabel>`)
          } else {
            const max = Math.max(1, Math.ceil(maxUnitsById.get(r.recurso_id) ?? 1))
            parts.push(`<MaxUnits>${max}</MaxUnits>`)
          }
          parts.push('</Resource>')
          return parts.join('')
        })
        .join('')
      resourcesXml = `<Resources>${recXml}</Resources>`

      let aUid = 0
      const assXml = assignments
        .map((a) => {
          const taskUid = uidById.get(a.tarefaId)
          const resUid = resUidById.get(a.recurso_id)
          if (!taskUid || !resUid) return ''
          if (isSummaryId.has(a.tarefaId)) return '' // defensivo: só folhas
          aUid++
          const parts = [
            '<Assignment>',
            `<UID>${aUid}</UID>`,
            `<TaskUID>${taskUid}</TaskUID>`,
            `<ResourceUID>${resUid}</ResourceUID>`
          ]
          if (a.type === 0) {
            // Material: consumo rateado pela duração (FixedMaterial=0) → barras
            // semanais. No MSPDI o "Work" de material é o nº de unidades consumidas
            // codificado no formato de duração (a unidade vem do MaterialLabel).
            const qtd = Math.max(0, Math.round(a.quantidade ?? 0))
            parts.push('<FixedMaterial>0</FixedMaterial>')
            parts.push(`<Units>${roundNum(a.units)}</Units>`)
            parts.push(`<Work>PT${qtd}H0M0S</Work>`)
          } else {
            // Trabalho: tripulação em paralelo (Units) e esforço total em horas.
            parts.push(`<Units>${roundNum(a.units)}</Units>`)
            parts.push(`<Work>PT${Math.max(0, Math.round(a.workHoras ?? 0))}H0M0S</Work>`)
          }
          parts.push('</Assignment>')
          return parts.join('')
        })
        .join('')
      assignmentsXml = `<Assignments>${assXml}</Assignments>`
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Project xmlns="http://schemas.microsoft.com/project">' +
    `<Name>${xmlEsc(projectName)}</Name>` +
    '<Author>InfraWork</Author>' +
    '<ScheduleFromStart>1</ScheduleFromStart>' +
    (projStart ? `<StartDate>${projStart}</StartDate>` : '') +
    (projStart ? `<CurrentDate>${projStart}</CurrentDate>` : '') +
    '<CalendarUID>1</CalendarUID>' +
    // Com recursos, fixamos a DURAÇÃO (tipo 1) p/ que o Project não recalcule as
    // datas a partir de Trabalho/Unidades ao abrir — o cronograma do app manda.
    `<DefaultTaskType>${assignmentsXml ? 1 : 0}</DefaultTaskType>` +
    '<DurationFormat>7</DurationFormat>' +
    extAttrDefsXml() +
    calendarioXml(bitmask) +
    `<Tasks>${tasksXml}</Tasks>` +
    resourcesXml +
    assignmentsXml +
    '</Project>'
  )
}

/** Número com até 4 casas (units fracionários de material/trabalho). */
function roundNum(v: number): number {
  return Math.round(v * 10000) / 10000
}

// Unidades de tempo/duração reservadas do MS Project — não podem ser usadas como
// rótulo de material. Inclui os tokens pt-BR (min/h/d/sem/mês/ano) E os de inglês
// (m=min, w=week, mo=month, y=year), pois o Project reconhece ambos: "M"/"m"
// (metro) colide com "minuto". O próprio Project sugere acrescentar um ponto
// (ex.: "min." em vez de "min").
const UNIDADES_RESERVADAS = new Set([
  'min',
  'minuto',
  'minutos',
  'm',
  'h',
  'hr',
  'hrs',
  'hora',
  'horas',
  'd',
  'dia',
  'dias',
  'w',
  'sem',
  'semana',
  'semanas',
  'mo',
  'mes',
  'mês',
  'meses',
  'y',
  'ano',
  'anos'
])

/**
 * Saneia o rótulo de material para o MS Project: remove colchetes e separadores
 * de lista, evita unidades de tempo reservadas (acrescenta ponto), limita a 32
 * caracteres e cai em "un" se vazio.
 */
function materialLabel(unidade: string | undefined): string {
  let s = (unidade ?? '').replace(/[[\],;]/g, ' ').replace(/\s+/g, ' ').trim()
  if (UNIDADES_RESERVADAS.has(s.toLowerCase())) s = `${s}.`
  if (!s) s = 'un'
  if (s.length > 32) s = s.slice(0, 32)
  return s
}
