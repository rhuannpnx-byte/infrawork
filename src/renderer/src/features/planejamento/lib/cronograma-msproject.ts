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
import { buildTaskTree } from './eap'

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

      return [
        '<Task>',
        `<UID>${uid}</UID>`,
        `<ID>${uid}</ID>`,
        `<Name>${xmlEsc(nomeTarefa(t))}</Name>`,
        `<OutlineLevel>${outlineLevel}</OutlineLevel>`,
        `<WBS>${xmlEsc(t.codigo_eap ?? String(uid))}</WBS>`,
        `<OutlineNumber>${xmlEsc(t.codigo_eap ?? String(uid))}</OutlineNumber>`,
        `<Summary>${isSummary ? 1 : 0}</Summary>`,
        `<Milestone>${isMarco ? 1 : 0}</Milestone>`,
        '<PercentComplete>0</PercentComplete>',
        start ? `<Start>${start}</Start>` : '',
        finish ? `<Finish>${finish}</Finish>` : '',
        isSummary ? '' : `<Duration>${durIso(isMarco ? 0 : t.duracao_dias_uteis_calc)}</Duration>`,
        isSummary ? '' : '<DurationFormat>7</DurationFormat>',
        preds,
        ext.join(''),
        '</Task>'
      ].join('')
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Project xmlns="http://schemas.microsoft.com/project">' +
    `<Name>${xmlEsc(projectName)}</Name>` +
    '<Author>InfraWork</Author>' +
    '<ScheduleFromStart>1</ScheduleFromStart>' +
    (projStart ? `<StartDate>${projStart}</StartDate>` : '') +
    (projStart ? `<CurrentDate>${projStart}</CurrentDate>` : '') +
    '<CalendarUID>1</CalendarUID>' +
    '<DefaultTaskType>0</DefaultTaskType>' +
    '<DurationFormat>7</DurationFormat>' +
    extAttrDefsXml() +
    calendarioXml(bitmask) +
    `<Tasks>${tasksXml}</Tasks>` +
    '</Project>'
  )
}
