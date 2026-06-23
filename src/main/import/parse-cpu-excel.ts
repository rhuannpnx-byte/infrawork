// Parser de CPUs da planilha TecPav v1.8 (Formulario_Planejamento).
//
// Layout fixo (drift zero entre as 29 cópias de CPU_*):
//   B3              = nome do serviço (input do usuário)
//   J3              = unidade do serviço (VLOOKUP — usa result calculado)
//   B6              = produção/dia (input)
//   rows 11..23     = bloco EQUIPAMENTO  (12-23 são slots; 11 é título)
//   rows 24..36     = bloco COMBUSTIVEL  (25-36 slots)
//   rows 37..49     = bloco MO           (38-49 slots)
//   rows 50..62     = bloco MATERIAL     (51-62 slots)
//   col F (6)       = nome do recurso
//   col G (7)       = unidade do recurso (VLOOKUP — usa result calculado)
//   col H (8)       = Nº / horas-dia
//   col I (9)       = quantidade (input em EQ/MO; CALCULADA em COMB/MAT — ignora)
//   col M (13)      = consumo combustível L/h (EQ) OU consumo material (MAT)
//   col N (14)      = índice de produtividade (EQ)
//
// Ignora a aba `CPU` (template mestre) e cópias com B3 vazio.
// Para de ler no row 62 sempre.

import ExcelJS, { type Worksheet, type Cell, type CellValue } from 'exceljs'

export type CpuItemGrupo = 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'
export type RecursoCatalogoGrupo = 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'

export interface ParsedRecursoCatalogo {
  grupo: RecursoCatalogoGrupo
  nome: string
  unidade: string | null
  custo_unitario: number | null
}

export interface ParsedCpuItem {
  grupo: CpuItemGrupo
  row_origem: number
  recurso_nome: string
  /** Unidade lida via VLOOKUP da col G (se cacheada). null se não disponível. */
  recurso_unidade: string | null
  /** Quantidade — só para EQ e MO. COMB e MAT têm quant. derivada → null. */
  quantidade: number | null
  horas_dia: number | null
  /** Consumo de combustível (L/h) — apenas EQ. */
  consumo_combustivel_lh: number | null
  /** Índice de produtividade (0..1) — apenas EQ. */
  indice_produtividade: number | null
  /** Consumo do material por unidade produzida — apenas MAT. */
  consumo_material_por_unid: number | null
}

export interface ParsedCpu {
  aba_nome: string
  servico_nome: string
  servico_unidade: string | null
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  itens: ParsedCpuItem[]
  incompleta: boolean
  warnings: string[]
}

export interface ParsedIndiretoTotal {
  /** Valor mensal total do indireto (J4 da planilha — root da hierarquia). */
  valor_mensal: number
  /** Descrição do root (D4) — usada como sugestão de nome no destino. */
  descricao_root: string | null
}

export interface ParseCpuResult {
  cpus: ParsedCpu[]
  recursos_catalogo: ParsedRecursoCatalogo[]
  /** Total mensal extraído da aba INDIRETO (null se aba ausente). */
  indireto_total: ParsedIndiretoTotal | null
  abas_ignoradas: string[]
  log: string[]
}

const RECURSO_GRUPOS_VALIDOS: Set<RecursoCatalogoGrupo> = new Set([
  'MO',
  'MVE',
  'COMBUSTIVEL',
  'MATERIAL',
  'ADM'
])

/**
 * Grupos da planilha TecPav que precisam ser remapeados porque o schema do
 * InfraWork não suporta diretamente. Ex.: TER (terceiros/subcontratados) →
 * MATERIAL, pois aparecem em CPUs no bloco MATERIAL e são cobrados por unidade.
 */
const RECURSO_GRUPO_REMAP: Record<string, RecursoCatalogoGrupo> = {
  TER: 'MATERIAL',
  // ADM aparece em CPUs como item MATERIAL (ex.: "Administração local" em
  // CPU_Administracaolocaldi). Remapeamos pra MATERIAL pra o lookup casar.
  ADM: 'MATERIAL'
}

/**
 * Parseia `Cadastro_Recursos!Tabela7` (cols A=GRUPO, B=NOME, C=UNID, D=CUSTO).
 * Tolera linhas em branco, ignora linhas com grupo inválido (cabeçalho/outras).
 * Custo pode ser fórmula `=12500/30` — lê o `result` cacheado.
 */
function parsearCadastroRecursos(ws: Worksheet): ParsedRecursoCatalogo[] {
  const out: ParsedRecursoCatalogo[] = []
  const seen = new Set<string>()
  const limite = Math.max(ws.actualRowCount ?? 200, 200)
  for (let r = 2; r <= limite; r++) {
    const grupoRaw = readStr(ws.getCell(r, 1))
    const nome = readStr(ws.getCell(r, 2))
    if (!grupoRaw || !nome) continue
    const grupoUp = grupoRaw.toUpperCase()
    const grupoFinal = (RECURSO_GRUPO_REMAP[grupoUp] ?? grupoUp) as RecursoCatalogoGrupo
    if (!RECURSO_GRUPOS_VALIDOS.has(grupoFinal)) continue
    const key = `${grupoFinal}|${nome.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      grupo: grupoFinal,
      nome,
      unidade: readStr(ws.getCell(r, 3)),
      custo_unitario: readNum(ws.getCell(r, 4))
    })
  }
  return out
}

const REGEX_ABA_CPU = /^CPU(_.+)?$/i

const BLOCOS: { grupo: CpuItemGrupo; row_titulo: number; row_ini: number; row_fim: number }[] = [
  { grupo: 'EQUIPAMENTO', row_titulo: 11, row_ini: 12, row_fim: 23 },
  { grupo: 'COMBUSTIVEL', row_titulo: 24, row_ini: 25, row_fim: 36 },
  { grupo: 'MO', row_titulo: 37, row_ini: 38, row_fim: 49 },
  { grupo: 'MATERIAL', row_titulo: 50, row_ini: 51, row_fim: 62 }
]

const COL_F = 6
const COL_G = 7
const COL_H = 8
const COL_I = 9
const COL_M = 13
const COL_N = 14

/** Resolve o valor "real" de uma célula — usa result de fórmula quando presente. */
function readNum(cell: Cell): number | null {
  const v = cell.value as CellValue | { result?: unknown; formula?: string } | null | undefined
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const trimmed = v.trim().replace(',', '.')
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'object' && 'result' in v) {
    const r = (v as { result?: unknown }).result
    if (typeof r === 'number') return r
    if (typeof r === 'string') {
      const n = Number(r.replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

function readStr(cell: Cell): string | null {
  const v = cell.value as CellValue | { result?: unknown } | null | undefined
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const s = v.trim()
    return s === '' ? null : s
  }
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result
    if (typeof r === 'string') {
      const s = r.trim()
      return s === '' ? null : s
    }
    if (typeof r === 'number') return String(r)
  }
  return null
}

function parsearCpu(aba_nome: string, ws: Worksheet): ParsedCpu | null {
  const warnings: string[] = []

  const servico_nome = readStr(ws.getCell('B3'))
  if (!servico_nome) return null // template ou cópia abandonada

  const servico_unidade = readStr(ws.getCell('J3'))
  const producao_raw = readNum(ws.getCell('B6'))
  const producao_diaria_qtde = producao_raw && producao_raw > 0 ? producao_raw : 0
  if (producao_diaria_qtde <= 0) {
    warnings.push('Produção/dia (B6) vazia ou inválida — CPU será criada com 0 e precisa ajuste.')
  }

  const itens: ParsedCpuItem[] = []

  for (const bloco of BLOCOS) {
    // Validação leve do título do bloco
    const titulo = readStr(ws.getCell(bloco.row_titulo, 2))
    if (titulo && titulo.toUpperCase() !== bloco.grupo) {
      warnings.push(
        `Título do bloco ${bloco.grupo} (row ${bloco.row_titulo}) inesperado: "${titulo}".`
      )
    }

    for (let r = bloco.row_ini; r <= bloco.row_fim; r++) {
      const nome = readStr(ws.getCell(r, COL_F))
      if (!nome) continue

      const item: ParsedCpuItem = {
        grupo: bloco.grupo,
        row_origem: r,
        recurso_nome: nome,
        recurso_unidade: readStr(ws.getCell(r, COL_G)),
        quantidade: null,
        horas_dia: null,
        consumo_combustivel_lh: null,
        indice_produtividade: null,
        consumo_material_por_unid: null
      }

      if (bloco.grupo === 'EQUIPAMENTO') {
        item.horas_dia = readNum(ws.getCell(r, COL_H))
        item.quantidade = readNum(ws.getCell(r, COL_I))
        item.consumo_combustivel_lh = readNum(ws.getCell(r, COL_M))
        // Col N é "% Produtivo" — fração 0..1 usada como multiplicador no custo
        // de combustível. Algumas planilhas reaproveitam essa coluna para o
        // ÍNDICE DE PRODUTIVIDADE de produção (valor grande, ex.: 50/100/250),
        // que não é fração e estouraria indice_produtividade numeric(5,4). Nesses
        // casos assumimos % produtivo = 100% (1.0). Frações válidas são mantidas.
        const idx = readNum(ws.getCell(r, COL_N))
        item.indice_produtividade = idx != null && idx >= 0 && idx <= 1 ? idx : 1
      } else if (bloco.grupo === 'MO') {
        item.horas_dia = readNum(ws.getCell(r, COL_H))
        item.quantidade = readNum(ws.getCell(r, COL_I))
      } else if (bloco.grupo === 'COMBUSTIVEL') {
        // Quantidade (col I) é DERIVADA por fórmula customizada da planilha.
        // CPUs com 1 só combustível: I = SUMPRODUCT dos EQ.
        // CPUs com múltiplos combustíveis (ex.: diesel + gasolina em Conserva):
        // cada COMB tem fórmula específica que aloca litros para o combustível
        // certo. Importamos o valor calculado para preservar precisão; a
        // trigger usa quantidade > 0 como override do SUMPRODUCT.
        item.quantidade = readNum(ws.getCell(r, COL_I))
      } else if (bloco.grupo === 'MATERIAL') {
        item.consumo_material_por_unid = readNum(ws.getCell(r, COL_M))
        // quantidade derivada (M × B6) — NÃO importar
      }

      itens.push(item)
    }
  }

  if (itens.length === 0) {
    warnings.push('Nenhum item preenchido nos 4 blocos.')
  }

  const temEq = itens.some((i) => i.grupo === 'EQUIPAMENTO')
  const temMat = itens.some((i) => i.grupo === 'MATERIAL')
  const incompleta = !temEq && !temMat

  return {
    aba_nome,
    servico_nome,
    servico_unidade,
    producao_diaria_qtde,
    // A produção/dia (B6) é expressa na unidade dimensional do serviço (J3),
    // ex.: "100 m³/dia". O campo NÃO é "DIA": o sistema (NewCpuVersionDialog)
    // rejeita "DIA" e a promoção em serviço usa esta unidade. Fallback "DIA"
    // só quando J3 vem vazio (CPU incompleta, a ser ajustada manualmente).
    producao_diaria_unidade: servico_unidade ?? 'DIA',
    itens,
    incompleta,
    warnings
  }
}

/**
 * Parseia a aba `INDIRETO` da planilha TecPav v1.8 e devolve só o TOTAL
 * MENSAL (root J4).
 *
 * Layout: row 4 contém o root da hierarquia ("APOIO À PRODUÇÃO" no exemplo),
 * com J4 = soma de todos os custos indiretos. A planilha trata isso como
 * valor mensal (o calendário está distribuído nas colunas M-X dos próximos
 * meses, mas a J é o totalizador mensal).
 *
 * NÃO importa a hierarquia completa — o usuário define quantos meses esse
 * custo equivale no momento da importação no destino.
 */
function parsearIndiretoTotal(ws: Worksheet): ParsedIndiretoTotal | null {
  const valor = readNum(ws.getCell(4, 10)) // J4
  if (valor === null || valor <= 0) return null
  return {
    valor_mensal: valor,
    descricao_root: readStr(ws.getCell(4, 4)) // D4
  }
}

export async function parseCpuExcelFile(path: string): Promise<ParseCpuResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  const cpus: ParsedCpu[] = []
  const abas_ignoradas: string[] = []
  const log: string[] = []
  let recursos_catalogo: ParsedRecursoCatalogo[] = []
  let indireto_total: ParsedIndiretoTotal | null = null

  for (const ws of wb.worksheets) {
    const nome = ws.name
    if (nome === 'Cadastro_Recursos') {
      recursos_catalogo = parsearCadastroRecursos(ws)
      log.push(`Cadastro_Recursos → ${recursos_catalogo.length} recurso(s) com preço.`)
      continue
    }
    if (nome === 'INDIRETO') {
      indireto_total = parsearIndiretoTotal(ws)
      log.push(
        indireto_total
          ? `INDIRETO → total mensal R$ ${indireto_total.valor_mensal.toFixed(2)}.`
          : `INDIRETO → não foi possível extrair total (J4 vazio).`
      )
      continue
    }
    if (!REGEX_ABA_CPU.test(nome)) continue
    if (nome.toUpperCase() === 'CPU') {
      abas_ignoradas.push(`${nome} (template)`)
      continue
    }
    const parsed = parsearCpu(nome, ws)
    if (!parsed) {
      abas_ignoradas.push(`${nome} (B3 vazio)`)
      continue
    }
    cpus.push(parsed)
    log.push(
      `${nome} → "${parsed.servico_nome}" (${parsed.itens.length} itens${
        parsed.incompleta ? ', incompleta' : ''
      })`
    )
  }

  return { cpus, recursos_catalogo, indireto_total, abas_ignoradas, log }
}
