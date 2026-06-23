// Tipos do módulo Documentação Oficial (repositório definitivo dos documentos
// da obra). Espelham as tabelas em supabase/migrations/20260623120000_*.sql.

/** Status descritivo do documento (rótulo, NÃO portão de aprovação). */
export type DocumentoStatus =
  | 'minuta'
  | 'em_analise'
  | 'assinado'
  | 'vigente'
  | 'substituido'
  | 'encerrado'

export const DOCUMENTO_STATUS: { value: DocumentoStatus; label: string }[] = [
  { value: 'minuta', label: 'Minuta' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'assinado', label: 'Assinado' },
  { value: 'vigente', label: 'Vigente' },
  { value: 'substituido', label: 'Substituído' },
  { value: 'encerrado', label: 'Encerrado' }
]

export type NaturezaContrato = 'publico' | 'privado'
export type OrigemIngestao = 'directory' | 'drag_drop' | 'onedrive' | 'email' | 'scanner'

/** Obrigatoriedade da categoria canônica. */
export type Obrigatoriedade =
  | 'essencial'
  | 'recomendado'
  | 'condicional'
  | 'operacional'
  | 'final'
  | 'apoio'

export interface TipoDocumento {
  codigo: string
  nome: string
  obrigatoriedade: Obrigatoriedade
  ordem: number
}

/**
 * Taxonomia canônica de 20 categorias (espelha a tabela de referência
 * `tipo_documento`). Mantida aqui para preencher selects sem round-trip; a
 * verdade é a do banco (a página também pode buscá-la via useTiposDocumento).
 */
export const TAXONOMIA_CANONICA: TipoDocumento[] = [
  { codigo: '01', nome: 'Edital e Anexos', obrigatoriedade: 'essencial', ordem: 1 },
  { codigo: '02', nome: 'Proposta (Téc./Comercial)', obrigatoriedade: 'recomendado', ordem: 2 },
  { codigo: '03', nome: 'Contrato', obrigatoriedade: 'essencial', ordem: 3 },
  { codigo: '04', nome: 'Ordem de Serviço (e NPO)', obrigatoriedade: 'essencial', ordem: 4 },
  { codigo: '05', nome: 'ART / CAT', obrigatoriedade: 'essencial', ordem: 5 },
  {
    codigo: '06',
    nome: 'Segurança do Trabalho (PGR/PCMSO)',
    obrigatoriedade: 'essencial',
    ordem: 6
  },
  { codigo: '07', nome: 'Aditivos', obrigatoriedade: 'condicional', ordem: 7 },
  { codigo: '08', nome: 'Reprogramação', obrigatoriedade: 'condicional', ordem: 8 },
  { codigo: '09', nome: 'Reajuste / Apostilamento', obrigatoriedade: 'condicional', ordem: 9 },
  {
    codigo: '10',
    nome: 'Licenças Ambientais (LP/LI/LO, ASV, Outorga)',
    obrigatoriedade: 'essencial',
    ordem: 10
  },
  { codigo: '11', nome: 'CNO / CEI', obrigatoriedade: 'essencial', ordem: 11 },
  { codigo: '12', nome: 'Seguro Garantia', obrigatoriedade: 'condicional', ordem: 12 },
  { codigo: '13', nome: 'Doc. Consórcio / Contratada', obrigatoriedade: 'recomendado', ordem: 13 },
  { codigo: '14', nome: 'Cartas e Ofícios', obrigatoriedade: 'operacional', ordem: 14 },
  { codigo: '15', nome: 'Tribunal de Contas (TCM/TCE)', obrigatoriedade: 'condicional', ordem: 15 },
  {
    codigo: '16',
    nome: 'Certidões / Matrícula / Desapropriação',
    obrigatoriedade: 'condicional',
    ordem: 16
  },
  { codigo: '17', nome: 'Qualidade (SGQ/PGQ/PVEGQ)', obrigatoriedade: 'recomendado', ordem: 17 },
  {
    codigo: '18',
    nome: 'Termo de Entrega/Recebimento (TRP/TRD)',
    obrigatoriedade: 'final',
    ordem: 18
  },
  {
    codigo: '19',
    nome: 'Portarias / Designação de Fiscal',
    obrigatoriedade: 'operacional',
    ordem: 19
  },
  { codigo: '20', nome: 'Outros / Diversos', obrigatoriedade: 'apoio', ordem: 20 }
]

/** Categorias essenciais — usadas para apurar "lacunas" / saúde documental. */
export const CATEGORIAS_ESSENCIAIS = TAXONOMIA_CANONICA.filter(
  (t) => t.obrigatoriedade === 'essencial'
).map((t) => t.codigo)

export interface ConsorcioInfo {
  is?: boolean
  composicao?: string[]
}

export interface Contrato {
  id: string
  empresa_id: string
  obra_id: string
  numero: string
  processo_sei: string | null
  contratante: string | null
  natureza: NaturezaContrato
  consorcio: ConsorcioInfo
  objeto: string | null
  modalidade_regime: string | null
  lei: string | null
  vigencia_inicio: string | null
  vigencia_fim: string | null
  prazo_vigencia_meses: number | null
  execucao_inicio: string | null
  execucao_fim: string | null
  valor_original: number | null
  valor_atual: number | null
  pct_aditado: number
  fiscal_responsavel: string | null
  reajuste_indice: string | null
  reajuste_periodicidade_meses: number | null
  reajuste_data_base: string | null
  reajuste_elegivel_em: string | null
  status: string
  created_by: string | null
  created_at: string
}

export interface DocumentoVersao {
  id: string
  documento_id: string
  versao: number
  vigente: boolean
  storage_bucket: string
  storage_key: string
  hash_sha256: string | null
  nome_original: string
  mime: string | null
  tamanho_bytes: number | null
  observacao: string | null
  created_by: string | null
  created_at: string
}

export interface Documento {
  id: string
  empresa_id: string
  obra_id: string
  contrato_id: string
  tipo_codigo: string
  titulo: string
  status: DocumentoStatus
  origem: OrigemIngestao
  classificacao_confianca: number | null
  classificacao_origem: 'manual' | 'ia'
  created_by: string | null
  created_at: string
}

/** Documento + sua versão vigente (join usado nas listagens do repositório). */
export interface DocumentoComVigente extends Documento {
  versao_vigente: DocumentoVersao | null
  contrato_numero: string | null
  tipo_nome: string | null
}

/** Entidades do contrato extraídas por IA de um documento (edge function). */
export interface ContratoExtraido {
  numero: string | null
  contratante: string | null
  processo_sei: string | null
  natureza: NaturezaContrato
  lei: string | null
  objeto: string | null
  modalidade_regime: string | null
  vigencia_inicio: string | null
  prazo_vigencia_meses: number | null
  vigencia_fim: string | null
  execucao_inicio: string | null
  execucao_fim: string | null
  valor_original: number | null
  fiscal_responsavel: string | null
  reajuste_indice: string | null
  reajuste_periodicidade_meses: number | null
  reajuste_data_base: string | null
  reajuste_elegivel_em: string | null
  consorcio: { is: boolean; composicao: string[] }
}

export interface ExtrairContratoResposta {
  extraido: ContratoExtraido
  confianca: number
  avisos: string[]
  _meta?: { modelo: string; engine: string; duracao_ms: number }
}

/** Resposta da classificação inteligente (conteúdo + pasta → categoria). */
export interface ClassificarResposta {
  tipo_codigo: string
  titulo_sugerido: string
  confianca: number
  justificativa: string
}

/** Fonte citada pelo agente documental. */
export interface FonteAgente {
  n: number
  documento_id: string
  titulo: string | null
  tipo_codigo: string | null
  similaridade: number
}

/** Resposta do agente (RAG sobre o acervo). */
export interface PerguntarResposta {
  resposta: string
  fontes: FonteAgente[]
}

/** Arquivo varrido de uma pasta local (resultado do main process). */
export interface ArquivoVarrido {
  path: string
  nome: string
  tamanho: number
  mtime: number
  online_only: boolean
}

/** Resultado da varredura recursiva de pasta. */
export interface VarreduraResultado {
  arquivos: ArquivoVarrido[]
  total: number
  online_only: number
}
