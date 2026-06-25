// Tipos do módulo Documentação Oficial v2 (Raio-X da Obra / ObraDossier).
// O contrato de dados central é o ObraDossier: 1 JSON por obra, montado pela
// edge function documentacao-montar-dossie a partir das tabelas granulares.
// Validado por Zod no front (defensivo contra schema drift).

import { z } from 'zod'

export type NaturezaContrato = 'publico' | 'privado'
export type OrigemIngestao = 'directory' | 'drag_drop' | 'onedrive' | 'email' | 'scanner'
export type PerfilOrgao = 'DNIT' | 'GOINFRA' | 'PREFEITURA' | 'SANEAGO' | 'PRIVADO'

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
  vence?: boolean
}

/** Taxonomia canônica de 20 categorias (espelha tipo_documento). */
export const TAXONOMIA_CANONICA: TipoDocumento[] = [
  { codigo: '01', nome: 'Edital e Anexos', obrigatoriedade: 'essencial', ordem: 1 },
  { codigo: '02', nome: 'Proposta (Téc./Comercial)', obrigatoriedade: 'recomendado', ordem: 2 },
  { codigo: '03', nome: 'Contrato', obrigatoriedade: 'essencial', ordem: 3 },
  { codigo: '04', nome: 'Ordem de Serviço (e NPO)', obrigatoriedade: 'essencial', ordem: 4 },
  { codigo: '05', nome: 'ART / CAT', obrigatoriedade: 'essencial', ordem: 5, vence: true },
  {
    codigo: '06',
    nome: 'Segurança do Trabalho (PGR/PCMSO)',
    obrigatoriedade: 'essencial',
    ordem: 6,
    vence: true
  },
  { codigo: '07', nome: 'Aditivos', obrigatoriedade: 'condicional', ordem: 7 },
  { codigo: '08', nome: 'Reprogramação', obrigatoriedade: 'condicional', ordem: 8 },
  { codigo: '09', nome: 'Reajuste / Apostilamento', obrigatoriedade: 'condicional', ordem: 9 },
  {
    codigo: '10',
    nome: 'Licenças Ambientais (LP/LI/LO, ASV, Outorga)',
    obrigatoriedade: 'essencial',
    ordem: 10,
    vence: true
  },
  { codigo: '11', nome: 'CNO / CEI', obrigatoriedade: 'essencial', ordem: 11 },
  { codigo: '12', nome: 'Seguro Garantia', obrigatoriedade: 'condicional', ordem: 12, vence: true },
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

export const CATEGORIAS_ESSENCIAIS = TAXONOMIA_CANONICA.filter(
  (t) => t.obrigatoriedade === 'essencial'
).map((t) => t.codigo)

/**
 * Nome de exibição de um grupo/categoria. Aceita um catálogo dinâmico (grupos do
 * template/dossiê: {codigo, nome}); cai para a taxonomia canônica e, por fim, o
 * próprio código. Permite que grupos editáveis por obra apareçam corretamente.
 */
export function nomeCategoria(
  codigo: string | null | undefined,
  catalogo?: ReadonlyArray<{ codigo: string; nome: string }>
): string {
  return (
    catalogo?.find((g) => g.codigo === codigo)?.nome ??
    TAXONOMIA_CANONICA.find((t) => t.codigo === codigo)?.nome ??
    codigo ??
    '—'
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ObraDossier — contrato de dados central (Zod + tipos inferidos)
// ─────────────────────────────────────────────────────────────────────────
const ns = z.string().nullish()
const nn = z.number().nullish()

export const DossieObraSchema = z.object({
  obra_id: z.string(),
  codigo: ns,
  nome: ns,
  orgao: ns,
  perfil_orgao: ns,
  natureza: ns,
  regime: ns
})

export const DossieContratoSchema = z
  .object({
    numero: ns,
    contratante: ns,
    processo: ns,
    sei: ns,
    edital: ns,
    lei: ns,
    objeto: ns,
    natureza: ns,
    regime: ns,
    cnae: ns,
    indice_reajuste: ns,
    valor_p0: nn,
    valor_vigente: nn,
    pct_aditado: nn,
    pct_reajuste: nn,
    data_base: ns,
    assinatura: ns,
    publicacao: ns,
    prazo_exec_dias: nn,
    prazo_vig_dias: nn,
    inicio_exec: ns,
    termino_exec: ns,
    termino_vig: ns,
    fiscal: ns,
    consorcio: z.unknown().nullish()
  })
  .nullable()

export const DossieParteSchema = z.object({
  papel: z.string(),
  nome: z.string(),
  cnpj: ns,
  doc_id: ns
})

export const DossieRTSchema = z.object({
  nome: z.string(),
  crea: ns,
  papel: ns,
  art: ns,
  doc_id: ns
})

export const DossieEventoSchema = z.object({
  tipo: z.string(),
  data_norm: ns,
  data_precisao: ns,
  data_rotulo: ns,
  rotulo: z.string(),
  descricao: ns,
  valor: nn,
  delta: nn,
  valor_resultante: nn,
  doc_id: ns
})

export const ClausulaAnaliseSchema = z.object({
  resumo: ns,
  risco: z.enum(['alto', 'medio', 'baixo']).nullish(),
  implicacoes: z.array(z.string()).default([]),
  referencias: z.array(z.string()).default([]),
  pontos_atencao: z.array(z.string()).default([])
})
export type ClausulaAnalise = z.infer<typeof ClausulaAnaliseSchema>

export const DossieClausulaSchema = z.object({
  id: ns,
  numero: ns,
  titulo: z.string(),
  categoria: ns,
  texto: ns,
  risco: z.enum(['alto', 'medio', 'baixo']).nullish(),
  observacao: ns,
  analise: ClausulaAnaliseSchema.nullish(),
  doc_id: ns,
  pagina: nn
})

export const DossieDocumentoSchema = z.object({
  doc_id: z.string(),
  tipo_codigo: z.string(),
  categoria: ns,
  grupo_codigo: ns,
  aderencia_score: nn,
  aderencia_grupo_sugerido: ns,
  tipo_nome: ns,
  especie: ns,
  nome: ns,
  titulo: ns,
  assinado: z.boolean().nullish(),
  vigente: z.boolean().nullish(),
  validade: ns,
  version_cluster: ns,
  storage_bucket: ns,
  storage_key: ns,
  mime: ns,
  texto_layer: z.boolean().nullish(),
  ocr: z.boolean().nullish()
})

export const DossieLacunaSchema = z.object({
  categoria: ns,
  severidade: z.enum(['alta', 'media', 'baixa']).catch('media'),
  tipo: z.enum(['ausente', 'vencimento', 'teto', 'assinatura']).catch('ausente'),
  mensagem: z.string(),
  data_limite: ns,
  doc_id: ns
})

export const DossieGrafoSchema = z.object({
  nos: z
    .array(
      z.object({
        no_id: z.string(),
        tipo: z.string(),
        label: z.string(),
        sub: ns,
        grupo_codigo: ns,
        peso: nn,
        doc_id: ns
      })
    )
    .default([]),
  arestas: z.array(z.object({ de: z.string(), para: z.string(), rel: z.string() })).default([])
})

export const ProvenienciaSchema = z.record(
  z.string(),
  z.object({ doc_id: ns, pagina: nn, confianca: nn })
)

export const DossieFindingSchema = z.object({
  regra_id: z.string(),
  severidade: z.enum(['BLOCKER', 'WARN', 'INFO']).catch('WARN'),
  campo: ns,
  mensagem: z.string(),
  esperado: ns,
  encontrado: ns,
  fonte: z.unknown().nullish()
})
export type DossieFinding = z.infer<typeof DossieFindingSchema>

export const ObraDossierSchema = z.object({
  obra: DossieObraSchema,
  contrato: DossieContratoSchema,
  partes: z.array(DossieParteSchema).default([]),
  responsaveis_tecnicos: z.array(DossieRTSchema).default([]),
  eventos: z.array(DossieEventoSchema).default([]),
  financeiro: z.object({ p0: nn, valor_total: nn, pct_aditado: nn, pct_reajuste: nn }).nullable(),
  clausulas: z.array(DossieClausulaSchema).default([]),
  grafo: DossieGrafoSchema.default({ nos: [], arestas: [] }),
  documentos: z.array(DossieDocumentoSchema).default([]),
  lacunas: z.array(DossieLacunaSchema).default([]),
  findings: z.array(DossieFindingSchema).default([]),
  proveniencia: ProvenienciaSchema.default({}),
  meta: z
    .object({
      schema_version: z.number().default(2),
      gerado_em: ns,
      cobertura_essencial_pct: nn
    })
    .default({ schema_version: 2 })
})

export type ObraDossier = z.infer<typeof ObraDossierSchema>
export type DossieContrato = z.infer<typeof DossieContratoSchema>
export type DossieEvento = z.infer<typeof DossieEventoSchema>
export type DossieClausula = z.infer<typeof DossieClausulaSchema>
export type DossieDocumento = z.infer<typeof DossieDocumentoSchema>
export type DossieLacuna = z.infer<typeof DossieLacunaSchema>
export type DossieParte = z.infer<typeof DossieParteSchema>

// ─── Respostas das edge functions ─────────────────────────────────────────
export interface ClassificarResposta {
  /** Grupo do template (slug; ex.: "03", "consorcio"). */
  grupo_codigo: string
  /** Categoria canônica 01..20 (FK documento.tipo_codigo). */
  tipo_codigo: string
  especie: string | null
  titulo_sugerido: string | null
  confianca: number
  justificativa: string
  sinais: { assinado: boolean; minuta: boolean }
}

export interface ExtrairRespostaEscalar {
  chave: string
  valor: unknown
  pagina: number | null
  confianca: number
}
export interface ExtrairEntradaIncremental {
  chave: string
  item: Record<string, unknown>
  pagina: number | null
  confianca: number
}
export interface ExtrairResposta {
  respostas: ExtrairRespostaEscalar[]
  entradas: ExtrairEntradaIncremental[]
  confianca: number
  avisos: string[]
  fila_humana?: boolean
}

export interface ValidarResposta {
  findings: DossieFinding[]
  pode_emitir_definitivo: boolean
  blockers: number
  warns: number
}

export interface OcrTextoResposta {
  texto: string
  paginas: Array<{ n: number; texto: string }>
  texto_layer: boolean
  ocr: boolean
  confianca: number
}

export interface FonteAgente {
  n: number
  documento_id: string
  pagina: number | null
  titulo: string | null
  tipo_codigo: string | null
  similaridade: number
}

export interface PerguntarResposta {
  resposta: string
  fontes: FonteAgente[]
}

export interface ReavaliarLacunasResposta {
  lacunas: DossieLacuna[]
  cobertura_essencial_pct: number
}

/** Arquivo varrido de uma pasta local (resultado do main process). */
export interface ArquivoVarrido {
  path: string
  nome: string
  tamanho: number
  mtime: number
  online_only: boolean
}

export interface VarreduraResultado {
  arquivos: ArquivoVarrido[]
  total: number
  online_only: number
}
