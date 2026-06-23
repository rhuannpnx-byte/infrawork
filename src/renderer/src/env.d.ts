/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string
  readonly VITE_API_URL?: string
  readonly VITE_USE_SUPABASE?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface OrcamentoImportItem {
  idx: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  is_folha: boolean
}

interface OrcamentoImportIndireto {
  idx: number
  codigo: string | null
  descricao: string
  tipo: 'mobilizacao' | 'desmob' | 'admin_local' | 'outros'
  valor_total: number
}

interface OrcamentoImportParseResult {
  itens: OrcamentoImportItem[]
  indireto: OrcamentoImportIndireto[]
  abas_encontradas: string[]
  aba_usada: string | null
  linhas_cabecalho_usadas: number
  colunas_detectadas: Record<string, string>
  log: string[]
}

type OrcamentoCpuItemGrupo = 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'

interface OrcamentoParsedCpuItem {
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

interface OrcamentoParsedCpu {
  aba_nome: string
  servico_nome: string
  servico_unidade: string | null
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  itens: OrcamentoParsedCpuItem[]
  incompleta: boolean
  warnings: string[]
}

interface OrcamentoParsedRecursoCatalogo {
  grupo: 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'
  nome: string
  unidade: string | null
  custo_unitario: number | null
}

interface OrcamentoParsedIndiretoTotal {
  valor_mensal: number
  descricao_root: string | null
}

interface OrcamentoParseCpuResult {
  cpus: OrcamentoParsedCpu[]
  recursos_catalogo: OrcamentoParsedRecursoCatalogo[]
  indireto_total: OrcamentoParsedIndiretoTotal | null
  abas_ignoradas: string[]
  log: string[]
}

interface OrcamentoImportParseMapping {
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

interface MspPredecessor {
  predUid: number
  mspType: number
  lagDias: number
}
interface MspTask {
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
interface MsProjectParse {
  projectName: string
  tasks: MspTask[]
}

interface InfraworkBridge {
  platform: string
  window: {
    openNew: (route: string) => Promise<void>
    minimize: () => void
    maximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (v: boolean) => void) => () => void
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
      mapping: OrcamentoImportParseMapping
    }) => Promise<{ ok: true; result: OrcamentoImportParseResult } | { ok: false; error: string }>
    parseCpuExcel: (params: {
      path: string
    }) => Promise<{ ok: true; result: OrcamentoParseCpuResult } | { ok: false; error: string }>
    lerArquivoBytes: (path: string) => Promise<{ bytes: number[]; name: string; size: number }>
  }
  documentacao: {
    escolherPasta: () => Promise<{ canceled: boolean; path?: string }>
    varrerPasta: (path: string) => Promise<
      | {
          ok: true
          result: {
            arquivos: Array<{
              path: string
              nome: string
              tamanho: number
              mtime: number
              online_only: boolean
            }>
            total: number
            online_only: number
          }
        }
      | { ok: false; error: string }
    >
    lerArquivoBytes: (path: string) => Promise<{ bytes: number[]; name: string; size: number }>
  }
  medicao: {
    exportXlsx: (payload: {
      obraNome: string
      periodoLabel: string
      periodoArquivo: string
      medicao: Array<{
        tipo: 'servico' | 'indireto'
        grupo_codigo: string
        grupo_descricao: string
        item_codigo: string
        item_descricao: string
        unidade: string
        qtd_contratual: number
        pct_avanco: number
        medicao_qtd: number
        venda_unitaria: number
        medicao_valor: number
      }>
      memorias: Array<{
        codigo: string
        descricao: string
        unidade: string
        agregadorCodigo: string
        agregadorDescricao: string
        agregadorUnidade: string
        qtdContratual: number
        vendaUnitaria: number
        dias: Array<{
          data: string
          aggQtd: number
          pct: number
          qtd: number
          valor: number
          estaca: string
          material: string
          observacao: string
          contexto: string
        }>
      }>
      fotos: Array<{
        base64: string
        extension: 'jpeg' | 'png'
        data: string
        servico: string
        frente: string
        obs: string
      }>
    }) => Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }>
  }
  tabela: {
    exportXlsx: (payload: {
      obraNome: string
      titulo: string
      filenameBase: string
      colunas: Array<{ header: string; numFmt?: string }>
      linhas: Array<Array<string | number | null>>
      servicos: Array<{
        codigo: string
        descricao: string
        unidade: string
        mediaNec: number | null
        semanas: Array<{ prev: number; real: number; media: number | null; range: string }>
      }>
    }) => Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }>
  }
  relatorio: {
    exportPdf: (payload: {
      html: string
      filenameBase: string
    }) => Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }>
  }
  cronograma: {
    escolherArquivo: () => Promise<{ canceled: boolean; path?: string; name?: string }>
    parseMsProject: (params: { path: string }) => Promise<
      | { ok: true; result: MsProjectParse }
      | { ok: false; error: string }
    >
    exportXml: (payload: {
      xml: string
      filenameBase: string
    }) => Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }>
  }
  updater: {
    check: () => Promise<{ ok: true; version: string | null } | { ok: false; error: string }>
    quitAndInstall: () => void
    onAvailable: (cb: (info: { version: string }) => void) => () => void
    onDownloaded: (cb: (info: { version: string }) => void) => () => void
  }
}

interface Window {
  engapp?: InfraworkBridge
  infrawork: InfraworkBridge
}
