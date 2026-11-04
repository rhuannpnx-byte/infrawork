/**
 * Tipos do módulo de templates XLSX (modelo padrão do sistema).
 *
 * Um `TemplateSpec` descreve as abas e colunas do modelo. O mesmo spec serve
 * para GERAR o arquivo (template-builder) e para LER o arquivo preenchido
 * (parse-sheet): o cabeçalho é localizado pelos nomes das colunas.
 */

export type ColTipo = 'text' | 'number' | 'integer' | 'percent' | 'enum' | 'code'

export interface EnumSpec {
  /** Valores exibidos na lista de validação do Excel (pt-BR). */
  values: string[]
  /** `normalizeTxt(valor exibido)` → valor interno. */
  map: Record<string, string>
  /** Sinônimos aceitos na leitura (`normalizeTxt(sinônimo)` → valor interno). */
  synonyms?: Record<string, string>
}

export interface ColumnSpec<K extends string = string> {
  key: K
  header: string
  required?: boolean
  tipo: ColTipo
  width?: number
  numFmt?: string
  /** Texto da aba Instruções. */
  help: string
  /** Outros cabeçalhos aceitos na leitura (normalizados). */
  aliases?: string[]
  enum?: EnumSpec
  min?: number
  max?: number
  /**
   * Coluna calculada por fórmula (ajuda quem preenche; a importação ignora).
   * Recebe o número da linha e devolve a fórmula (sem "=").
   */
  calculada?: (row: number) => string
  /** Lista suspensa dinâmica: faixa de origem (ex.: "Agrupamentos!$A$6:$A$305"); aceita valor novo. */
  listaDinamica?: string
}

export interface SheetSpec {
  name: string
  columns: ColumnSpec[]
  /** Linhas em branco pré-formatadas (default 300). */
  blankRows?: number
  /** Grupo de colunas (keys, inclusive) que vem recolhido (botão ⊞ do Excel). */
  recolher?: { de: string; ate: string }
}

export interface TemplateSpec {
  fileName: string
  titulo: string
  /** Identificador de versão do modelo, gravado na aba Instruções. */
  versao: string
  sheets: SheetSpec[]
  instrucoes: { passos: string[]; regras: string[] }
  /** Linhas de exemplo (aba "Exemplo"; nunca importadas). */
  exemplo: Array<{ sheet: string; rows: Record<string, unknown>[] }>
  /**
   * Abas extras (ex.: visualização por fórmula), criadas depois das abas de
   * dados. `linhas` = nº de linhas de dados de cada aba.
   */
  extras?: (wb: import('exceljs').Workbook, info: { linhas: Record<string, number> }) => void
}

export interface TemplateCtx {
  empresaNome: string
  obraCodigo: string
  obraNome: string
}

export type ImportAcao = 'criar' | 'atualizar' | 'pular' | 'erro'

export interface RowError {
  sheet: string
  row: number
  col?: string
  code: string
  msg: string
  nivel: 'erro' | 'aviso'
}

export interface ParsedRow<T> {
  sheet: string
  row: number
  data: T
  acao: ImportAcao
  motivo?: string
  erros: RowError[]
  avisos: RowError[]
}

export interface ParseResult<T> {
  rows: ParsedRow<T>[]
  errosGerais: RowError[]
  resumo: Record<ImportAcao, number>
}

export interface ImportResultado {
  ok: boolean
  stats: Record<string, number>
  erros: string[]
  avisos: string[]
  duracao_ms: number
}

export const LIMITE_LINHAS = 5000

export function resumoDe<T>(rows: ParsedRow<T>[]): Record<ImportAcao, number> {
  const r: Record<ImportAcao, number> = { criar: 0, atualizar: 0, pular: 0, erro: 0 }
  for (const row of rows) r[row.acao]++
  return r
}
