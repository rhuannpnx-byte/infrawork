import { ElectronAPI } from '@electron-toolkit/preload'

export interface OrcamentoParsedItem {
  idx: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  is_folha: boolean
}

export interface OrcamentoParsedIndireto {
  idx: number
  codigo: string | null
  descricao: string
  tipo: 'mobilizacao' | 'desmob' | 'admin_local' | 'outros'
  valor_total: number
}

export interface OrcamentoParseResult {
  itens: OrcamentoParsedItem[]
  indireto: OrcamentoParsedIndireto[]
  abas_encontradas: string[]
  aba_usada: string | null
  linhas_cabecalho_usadas: number
  colunas_detectadas: Record<string, string>
  log: string[]
}

export type OrcamentoCpuItemGrupo = 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'

export interface OrcamentoParsedCpuItem {
  grupo: OrcamentoCpuItemGrupo
  row_origem: number
  recurso_nome: string
  recurso_unidade: string | null
  quantidade: number | null
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number | null
  consumo_material_por_unid: number | null
}

export interface OrcamentoParsedCpu {
  aba_nome: string
  servico_nome: string
  servico_unidade: string | null
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  itens: OrcamentoParsedCpuItem[]
  incompleta: boolean
  warnings: string[]
}

export interface OrcamentoParsedRecursoCatalogo {
  grupo: 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'
  nome: string
  unidade: string | null
  custo_unitario: number | null
}

export interface OrcamentoParsedIndiretoTotal {
  valor_mensal: number
  descricao_root: string | null
}

export interface OrcamentoParseCpuResult {
  cpus: OrcamentoParsedCpu[]
  recursos_catalogo: OrcamentoParsedRecursoCatalogo[]
  indireto_total: OrcamentoParsedIndiretoTotal | null
  abas_ignoradas: string[]
  log: string[]
}

export interface OrcamentoParseMapping {
  formato: 'xlsx'
  aba_plan_orc?: {
    nome: string
    linhas_cabecalho: number
    colunas: {
      codigo: string
      descricao: string
      unidade?: string
      quantidade?: string
      venda_unitaria?: string
    }
  }
  aba_indireto?: {
    nome: string
    linhas_cabecalho: number
    colunas: {
      codigo: string
      descricao: string
      tipo?: string
      valor_total?: string
    }
  }
}

interface InfraworkAPI {
  window: {
    openNew: (route: string) => Promise<void>
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  settings: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
  orcamento: {
    escolherArquivo: () => Promise<{
      canceled: boolean
      path?: string
      name?: string
      size?: number
    }>
    parseExcel: (params: {
      path: string
      mapping: OrcamentoParseMapping
    }) => Promise<{ ok: true; result: OrcamentoParseResult } | { ok: false; error: string }>
    parseCpuExcel: (params: {
      path: string
    }) => Promise<{ ok: true; result: OrcamentoParseCpuResult } | { ok: false; error: string }>
    lerArquivoBytes: (path: string) => Promise<{ bytes: number[]; name: string; size: number }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    infrawork: InfraworkAPI
  }
}
