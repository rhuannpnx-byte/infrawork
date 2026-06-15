// Parser de MS Project XML (Project Data Interchange) → estrutura normalizada
// consumida pelo wizard de importação de cronograma. Roda no processo main.

import { readFile } from 'node:fs/promises'
import { XMLParser } from 'fast-xml-parser'

const HORAS_DIA = 8

// FieldIDs canônicos dos custom fields (espelha cronograma-msproject.ts).
const FIELD = {
  text1: 188743731, // InfraWork ID
  text2: 188743734, // Código item
  text3: 188743737, // Trecho
  text4: 188743740, // Equipes
  text5: 188743743, // Unidade
  number1: 188743767, // Quantidade
  number2: 188743770, // Posição início
  number3: 188743773 // Posição fim
}

export interface MspPredecessor {
  predUid: number
  /** Código MS Project: 0=FF,1=FS,2=SF,3=SS (SF/SS fora da ordem intuitiva). */
  mspType: number
  lagDias: number
}

export interface MspTask {
  uid: number
  id: number
  name: string
  outlineLevel: number
  summary: boolean
  milestone: boolean
  startISO: string | null
  finishISO: string | null
  durationDias: number | null
  wbs: string | null
  predecessors: MspPredecessor[]
  /** Constraint InfraWork (snet/snlt/fnet/fnlt/mso/mfo) ou null. */
  constraintType: string | null
  constraintDate: string | null
  ext: {
    infraworkId?: string
    itemCodigo?: string
    trecho?: string
    equipes?: string
    unidade?: string
    quantidade?: number
    posIni?: number
    posFim?: number
  }
}

export interface MsProjectParse {
  projectName: string
  tasks: MspTask[]
}

function arr<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}
function str(x: unknown): string | null {
  if (x == null) return null
  const s = String(x).trim()
  return s === '' ? null : s
}
function num(x: unknown): number | null {
  const s = str(x)
  if (s == null) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function dateOnly(x: unknown): string | null {
  const s = str(x)
  return s ? s.slice(0, 10) : null
}
function durationToDias(x: unknown): number | null {
  const s = str(x)
  if (!s) return null
  // ISO8601 tipo "PT40H0M0S".
  const m = /P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+)M)?/.exec(s)
  if (!m) return null
  const dias = m[1] ? Number(m[1]) : 0
  const horas = m[2] ? Number(m[2]) : 0
  const min = m[3] ? Number(m[3]) : 0
  const totalHoras = dias * HORAS_DIA + horas + min / 60
  return totalHoras > 0 ? totalHoras / HORAS_DIA : 0
}

const MSP_CONSTRAINT: Record<string, string | null> = {
  '0': null, // ASAP
  '1': null, // ALAP
  '2': 'mso',
  '3': 'mfo',
  '4': 'snet',
  '5': 'snlt',
  '6': 'fnet',
  '7': 'fnlt'
}

export async function parseMsProjectXml(path: string): Promise<MsProjectParse> {
  const xml = await readFile(path, 'utf8')
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true
  })
  const doc = parser.parse(xml) as Record<string, unknown>
  const project = (doc.Project ?? doc.project) as Record<string, unknown> | undefined
  if (!project) throw new Error('Arquivo não parece ser um MS Project XML (sem <Project>).')

  const projectName = str(project.Name) ?? 'Cronograma importado'
  const tasksRaw = arr((project.Tasks as Record<string, unknown> | undefined)?.Task as unknown)

  const tasks: MspTask[] = []
  for (const tr of tasksRaw as Array<Record<string, unknown>>) {
    const uid = num(tr.UID) ?? num(tr.ID) ?? 0
    if (uid === 0 && str(tr.Name) == null) continue // linha de projeto/raiz vazia

    // Custom fields.
    const ext: MspTask['ext'] = {}
    for (const ea of arr(tr.ExtendedAttribute as unknown) as Array<Record<string, unknown>>) {
      const fid = num(ea.FieldID)
      const val = ea.Value
      if (fid === FIELD.text1) ext.infraworkId = str(val) ?? undefined
      else if (fid === FIELD.text2) ext.itemCodigo = str(val) ?? undefined
      else if (fid === FIELD.text3) ext.trecho = str(val) ?? undefined
      else if (fid === FIELD.text4) ext.equipes = str(val) ?? undefined
      else if (fid === FIELD.text5) ext.unidade = str(val) ?? undefined
      else if (fid === FIELD.number1) ext.quantidade = num(val) ?? undefined
      else if (fid === FIELD.number2) ext.posIni = num(val) ?? undefined
      else if (fid === FIELD.number3) ext.posFim = num(val) ?? undefined
    }

    // Predecessores.
    const predecessors: MspPredecessor[] = []
    for (const pl of arr(tr.PredecessorLink as unknown) as Array<Record<string, unknown>>) {
      const predUid = num(pl.PredecessorUID)
      if (predUid == null) continue
      const lagTenths = num(pl.LinkLag) ?? 0
      predecessors.push({
        predUid,
        mspType: num(pl.Type) ?? 1,
        lagDias: lagTenths / (HORAS_DIA * 60 * 10)
      })
    }

    const ct = str(tr.ConstraintType)
    tasks.push({
      uid,
      id: num(tr.ID) ?? uid,
      name: str(tr.Name) ?? `Tarefa ${uid}`,
      outlineLevel: num(tr.OutlineLevel) ?? 1,
      summary: str(tr.Summary) === '1',
      milestone: str(tr.Milestone) === '1',
      startISO: dateOnly(tr.Start),
      finishISO: dateOnly(tr.Finish),
      durationDias: durationToDias(tr.Duration),
      wbs: str(tr.WBS) ?? str(tr.OutlineNumber),
      predecessors,
      constraintType: ct ? (MSP_CONSTRAINT[ct] ?? null) : null,
      constraintDate: dateOnly(tr.ConstraintDate),
      ext
    })
  }

  return { projectName, tasks }
}
