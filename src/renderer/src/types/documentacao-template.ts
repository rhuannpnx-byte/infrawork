// Template de extração — estrutura FIXA de campos/perguntas que dita o que a IA
// extrai dos documentos (nada além do template). Editável e copiável entre obras.
// Este DEFAULT é a "base global" de origem; cada obra recebe uma cópia editável.

import { z } from 'zod'

export type CampoTipo = 'texto' | 'data' | 'moeda' | 'numero' | 'booleano' | 'entidade' | 'lista'
export type CampoCardinalidade = 'escalar' | 'incremental'
export type CampoAlvo = 'campo_dossie' | 'evento' | 'parte' | 'responsavel_tecnico' | 'clausula'

export interface TemplateCampo {
  /** Caminho canônico (escalar → campo_dossie.caminho) ou id lógico (incremental). */
  chave: string
  secao: string
  rotulo: string
  /** A PERGUNTA que buscamos responder nos documentos (núcleo do template). */
  pergunta: string
  tipo: CampoTipo
  cardinalidade: CampoCardinalidade
  /** Para `lista`/incremental: forma de cada entrada (campo → tipo). */
  item_schema?: Record<string, CampoTipo> | null
  /** Para incremental: chave natural de dedup entre documentos. */
  chave_dedup?: string[]
  /** Âncora: categorias de documento (códigos 01..20) que alimentam o campo. */
  doc_categorias: string[]
  alvo: CampoAlvo
  /** Para alvo=evento: tipo do evento gerado (apostilamento/aditivo/licenca/...). */
  evento_tipo?: string
  obrigatorio: boolean
  /** Ids das regras do validador (R-XX) aplicáveis. */
  validacoes: string[]
  /** Dica de formatação na apresentação (dd/mm/aaaa, R$, %). */
  formato?: string
  ordem: number
}

export const TemplateCampoSchema = z.object({
  chave: z.string(),
  secao: z.string(),
  rotulo: z.string(),
  pergunta: z.string(),
  tipo: z
    .enum(['texto', 'data', 'moeda', 'numero', 'booleano', 'entidade', 'lista'])
    .catch('texto'),
  cardinalidade: z.enum(['escalar', 'incremental']).catch('escalar'),
  item_schema: z.record(z.string(), z.string()).nullish(),
  chave_dedup: z.array(z.string()).default([]),
  doc_categorias: z.array(z.string()).default([]),
  alvo: z
    .enum(['campo_dossie', 'evento', 'parte', 'responsavel_tecnico', 'clausula'])
    .catch('campo_dossie'),
  evento_tipo: z.string().nullish(),
  obrigatorio: z.boolean().default(false),
  validacoes: z.array(z.string()).default([]),
  formato: z.string().nullish(),
  ordem: z.number().default(0)
}) as z.ZodType<TemplateCampo>

// ─────────────────────────────────────────────────────────────────────────
// GRUPOS — taxonomia de documentos como DADO (editável/copiável por obra).
// Cada grupo dita as REGRAS do que pertence a ele e O QUE contribui para o
// contexto do contrato (quais campos[].chave alimenta). codigo = slug estável;
// tipo_codigo_base ∈ 01..20 mantém a FK documento.tipo_codigo + gap/vence.
// ─────────────────────────────────────────────────────────────────────────
export type GrupoCardinalidade = 'unico' | 'multiplo'
export type GrupoCriticidade =
  | 'essencial'
  | 'recomendado'
  | 'condicional'
  | 'operacional'
  | 'final'
  | 'apoio'

/** Condições de aplicabilidade do grupo à obra ({} = sempre aplicável). */
export interface GrupoAplicavelSe {
  consorcio?: boolean
  natureza?: ('publico' | 'privado')[]
  perfil_orgao?: string[]
}

export interface GrupoTemplate {
  /** Slug estável (ex.: "03", "consorcio", "empenhos"). */
  codigo: string
  nome: string
  /** Código canônico 01..20 (FK documento.tipo_codigo + gap engine / vence). */
  tipo_codigo_base: string
  /** Regras: o que pertence a este grupo (alimenta o prompt do classificador). */
  regras: string
  /** O que o grupo contribui para o contexto do contrato. */
  contribuicao: string
  /** Campos (chave) que este grupo alimenta — derivado de campos[].doc_categorias (UI). */
  campos_chaves: string[]
  cardinalidade: GrupoCardinalidade
  criticidade: GrupoCriticidade
  vence: boolean
  aplicavel_se: GrupoAplicavelSe
  /** Dicas (nomes de pasta/arquivo) para o classificador. */
  aliases: string[]
  ordem: number
}

export const GrupoTemplateSchema = z.object({
  codigo: z.string(),
  nome: z.string(),
  tipo_codigo_base: z.string().default('20'),
  regras: z.string().default(''),
  contribuicao: z.string().default(''),
  campos_chaves: z.array(z.string()).default([]),
  cardinalidade: z.enum(['unico', 'multiplo']).catch('multiplo'),
  criticidade: z
    .enum(['essencial', 'recomendado', 'condicional', 'operacional', 'final', 'apoio'])
    .catch('apoio'),
  vence: z.boolean().default(false),
  aplicavel_se: z
    .object({
      consorcio: z.boolean().optional(),
      natureza: z.array(z.enum(['publico', 'privado'])).optional(),
      perfil_orgao: z.array(z.string()).optional()
    })
    .default({}),
  aliases: z.array(z.string()).default([]),
  ordem: z.number().default(0)
}) as z.ZodType<GrupoTemplate>

export const TemplateSchema = z.object({
  id: z.string(),
  obra_id: z.string().nullable(),
  empresa_id: z.string(),
  nome: z.string(),
  descricao: z.string().nullish(),
  campos: z.array(TemplateCampoSchema).default([]),
  grupos: z.array(GrupoTemplateSchema).default([]),
  versao: z.number().default(1),
  atualizado_em: z.string().nullish()
})
export type Template = z.infer<typeof TemplateSchema>

const C = (
  c: Partial<TemplateCampo> & Pick<TemplateCampo, 'chave' | 'rotulo' | 'pergunta'>
): TemplateCampo => ({
  secao: 'Outros',
  tipo: 'texto',
  cardinalidade: 'escalar',
  doc_categorias: [],
  alvo: 'campo_dossie',
  obrigatorio: false,
  validacoes: [],
  ordem: 0,
  ...c
})

/**
 * Template BASE (global). Cobre os campos do Raio-X / TAP, com perguntas
 * ancoradas na categoria certa e regras do validador. Campos `incremental`
 * (aditivos, reajustes, licenças, RTs, cláusulas) ACUMULAM entre documentos.
 */
export const DEFAULT_TEMPLATE_CAMPOS: TemplateCampo[] = [
  // 1 · Identificação contratual
  C({
    chave: 'contrato.numero',
    secao: 'Identificação contratual',
    rotulo: 'Nº do contrato',
    tipo: 'texto',
    doc_categorias: ['03', '04'],
    obrigatorio: true,
    validacoes: ['R-01', 'R-34'],
    ordem: 1,
    pergunta:
      'Qual o número/identificador do contrato, COM o prefixo do órgão (ex.: TT-392/2024)? Preserve o prefixo e a máscara exatamente.'
  }),
  C({
    chave: 'contrato.contratante',
    secao: 'Identificação contratual',
    rotulo: 'Cliente / Órgão',
    tipo: 'texto',
    doc_categorias: ['03'],
    obrigatorio: true,
    validacoes: ['R-02'],
    ordem: 2,
    pergunta: 'Qual o órgão/ente CONTRATANTE (cliente)? Nome oficial.'
  }),
  C({
    chave: 'contrato.objeto',
    secao: 'Identificação contratual',
    rotulo: 'Objeto',
    tipo: 'texto',
    doc_categorias: ['03'],
    obrigatorio: true,
    validacoes: ['R-03'],
    ordem: 3,
    pergunta: 'Qual o objeto do contrato (cláusula 1ª)?'
  }),
  C({
    chave: 'contrato.processo',
    secao: 'Identificação contratual',
    rotulo: 'Processo (do contrato)',
    tipo: 'texto',
    doc_categorias: ['03'],
    validacoes: ['R-35'],
    ordem: 4,
    pergunta:
      'Qual o nº do PROCESSO administrativo DO CONTRATO? Não confunda com o processo do edital/licitação.'
  }),
  C({
    chave: 'contrato.sei',
    secao: 'Identificação contratual',
    rotulo: 'SEI',
    tipo: 'texto',
    doc_categorias: ['03'],
    ordem: 5,
    pergunta: 'Qual o nº SEI do contrato?'
  }),
  C({
    chave: 'contrato.edital',
    secao: 'Identificação contratual',
    rotulo: 'Edital',
    tipo: 'texto',
    doc_categorias: ['01', '03'],
    ordem: 6,
    pergunta: 'Qual o nº do edital/licitação que originou o contrato?'
  }),
  C({
    chave: 'contrato.lei',
    secao: 'Identificação contratual',
    rotulo: 'Lei / Regime legal',
    tipo: 'texto',
    doc_categorias: ['01', '03'],
    validacoes: ['R-40', 'R-41'],
    ordem: 7,
    pergunta:
      'Qual a LEI de regência, EXATAMENTE como escrita no documento (ex.: 8.666/1993, 14.133/2021, 12.462/2011)? NÃO infira nem use a lei mais recente; se não constar literalmente, deixe vazio.'
  }),
  C({
    chave: 'contrato.regime',
    secao: 'Identificação contratual',
    rotulo: 'Regime de contratação',
    tipo: 'texto',
    doc_categorias: ['01', '03'],
    validacoes: ['R-41'],
    ordem: 8,
    pergunta: 'Qual o regime de contratação/execução (ex.: RDC, empreitada por preço unitário)?'
  }),
  C({
    chave: 'contrato.cnae',
    secao: 'Identificação contratual',
    rotulo: 'CNAE',
    tipo: 'texto',
    doc_categorias: ['03', '13'],
    ordem: 9,
    pergunta: 'Qual o CNAE da contratada/consórcio (consta do CNPJ)?'
  }),
  C({
    chave: 'contrato.fiscal',
    secao: 'Identificação contratual',
    rotulo: 'Fiscal',
    tipo: 'texto',
    doc_categorias: ['03', '19'],
    ordem: 10,
    pergunta: 'Quem é o fiscal/gestor do contrato designado?'
  }),

  // 2 · Valores
  C({
    chave: 'contrato.valor_p0',
    secao: 'Valores',
    rotulo: 'Valor original (P0)',
    tipo: 'moeda',
    doc_categorias: ['03'],
    obrigatorio: true,
    validacoes: ['R-04'],
    ordem: 20,
    formato: 'R$',
    pergunta: 'Qual o valor ORIGINAL do contrato (P0), antes de qualquer reajuste/aditivo? R$ puro.'
  }),
  C({
    chave: 'contrato.data_base',
    secao: 'Valores',
    rotulo: 'Data-base',
    tipo: 'texto',
    doc_categorias: ['01', '03'],
    validacoes: ['R-08', 'R-11', 'R-15'],
    ordem: 21,
    pergunta:
      'Qual a DATA-BASE de preços do contrato (AAAA-MM)? Governa a elegibilidade de reajuste.'
  }),
  C({
    chave: 'contrato.indice_reajuste',
    secao: 'Valores',
    rotulo: 'Índice / Fórmula de reajuste',
    tipo: 'texto',
    doc_categorias: ['01', '03'],
    ordem: 22,
    pergunta:
      'Qual o índice ou fórmula de reajuste previsto (ex.: item 3.3, IPCA, data-base 01/2023)?'
  }),
  C({
    chave: 'contrato.assinatura',
    secao: 'Valores',
    rotulo: 'Data de assinatura',
    tipo: 'data',
    doc_categorias: ['03'],
    obrigatorio: true,
    validacoes: ['R-05', 'R-10'],
    ordem: 23,
    formato: 'dd/mm/aaaa',
    pergunta:
      'Em que data o CONTRATO foi assinado (cláusula de assinatura / ficha contratual)? NÃO use datas de apostilamentos, aditivos ou publicação.'
  }),
  C({
    chave: 'contrato.publicacao',
    secao: 'Valores',
    rotulo: 'Publicação',
    tipo: 'data',
    doc_categorias: ['03'],
    validacoes: ['R-13'],
    ordem: 24,
    formato: 'dd/mm/aaaa',
    pergunta: 'Qual a data de publicação do extrato do contrato?'
  }),

  // 3 · Prazos
  C({
    chave: 'contrato.prazo_exec_dias',
    secao: 'Prazos',
    rotulo: 'Prazo de execução (dias)',
    tipo: 'numero',
    doc_categorias: ['03', '04'],
    obrigatorio: true,
    validacoes: ['R-06', 'R-12'],
    ordem: 30,
    pergunta: 'Qual o prazo de EXECUÇÃO em dias?'
  }),
  C({
    chave: 'contrato.prazo_vig_dias',
    secao: 'Prazos',
    rotulo: 'Prazo de vigência (dias)',
    tipo: 'numero',
    doc_categorias: ['03'],
    obrigatorio: true,
    validacoes: ['R-06'],
    ordem: 31,
    pergunta: 'Qual o prazo de VIGÊNCIA em dias?'
  }),
  C({
    chave: 'contrato.inicio_exec',
    secao: 'Prazos',
    rotulo: 'Início (OS de serviço)',
    tipo: 'data',
    doc_categorias: ['04'],
    validacoes: ['R-12', 'R-16'],
    ordem: 32,
    formato: 'dd/mm/aaaa',
    pergunta:
      'Qual a data de INÍCIO dos serviços (Ordem de Serviço)? Se houver divergência entre OS e ficha, prefira a OS e registre a outra.'
  }),
  C({
    chave: 'contrato.termino_exec',
    secao: 'Prazos',
    rotulo: 'Término de execução',
    tipo: 'data',
    doc_categorias: ['03', '04'],
    validacoes: ['R-12', 'R-14'],
    ordem: 33,
    formato: 'dd/mm/aaaa',
    pergunta: 'Qual a data de término da EXECUÇÃO?'
  }),
  C({
    chave: 'contrato.termino_vig',
    secao: 'Prazos',
    rotulo: 'Término de vigência',
    tipo: 'data',
    doc_categorias: ['03'],
    validacoes: ['R-14'],
    ordem: 34,
    formato: 'dd/mm/aaaa',
    pergunta: 'Qual a data de término da VIGÊNCIA?'
  }),

  // 4 · Partes & Responsáveis (incremental)
  C({
    chave: 'partes.consorcio',
    secao: 'Partes & Responsáveis',
    rotulo: 'Consórcio / Contratada',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'parte',
    doc_categorias: ['03', '13'],
    item_schema: { papel: 'texto', nome: 'texto', cnpj: 'texto' },
    chave_dedup: ['cnpj'],
    validacoes: ['R-30', 'R-31', 'R-32', 'R-33', 'R-36'],
    ordem: 40,
    pergunta:
      'Liste as PESSOAS JURÍDICAS contratadas/consorciadas: papel (líder/consorciada), nome e CNPJ. NÃO inclua pessoas físicas/representantes. Não duplique a mesma empresa.'
  }),
  C({
    chave: 'responsaveis_tecnicos',
    secao: 'Partes & Responsáveis',
    rotulo: 'Responsáveis técnicos (ART/CAT)',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'responsavel_tecnico',
    doc_categorias: ['05'],
    item_schema: { nome: 'texto', crea: 'texto', papel: 'texto', art: 'texto' },
    chave_dedup: ['nome'],
    ordem: 41,
    pergunta: 'Liste os responsáveis técnicos (ART/CAT): nome, CREA, papel e nº da ART.'
  }),

  // 5 · Eventos (incremental → timeline/financeiro)
  C({
    chave: 'eventos.reajustes',
    secao: 'Eventos',
    rotulo: 'Reajustes / Apostilamentos',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'evento',
    evento_tipo: 'apostilamento',
    doc_categorias: ['09'],
    item_schema: { data: 'data', delta: 'moeda', valor_resultante: 'moeda', rotulo: 'texto' },
    chave_dedup: ['data', 'delta'],
    validacoes: ['R-21', 'R-23'],
    ordem: 50,
    pergunta:
      'Liste cada REAJUSTE/APOSTILAMENTO: data, valor do reajuste (delta) e valor resultante. Reajuste NÃO é aditivo de valor.'
  }),
  C({
    chave: 'eventos.aditivos',
    secao: 'Eventos',
    rotulo: 'Aditivos de valor/quantidade',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'evento',
    evento_tipo: 'aditivo',
    doc_categorias: ['07'],
    item_schema: { data: 'data', delta: 'moeda', rotulo: 'texto', objeto: 'texto' },
    chave_dedup: ['data', 'delta'],
    validacoes: ['R-24'],
    ordem: 51,
    pergunta:
      'Liste cada TERMO ADITIVO de valor/quantidade (NÃO reajuste): data, valor (delta) e objeto.'
  }),
  C({
    chave: 'eventos.os_atos',
    secao: 'Eventos',
    rotulo: 'Ordens de Serviço / Paralisação / Reinício',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'evento',
    doc_categorias: ['04'],
    item_schema: { ato: 'texto', data: 'data', motivo: 'texto' },
    chave_dedup: ['ato', 'data'],
    ordem: 51.5,
    pergunta:
      'Liste cada ATO de ordem: "ato" = inicio | paralisacao | reinicio; "data" (da ordem, NÃO a do carimbo de assinatura eletrônica); "motivo" quando houver. O prazo de execução congela durante a paralisação e volta a contar no reinício.'
  }),
  C({
    chave: 'eventos.arts',
    secao: 'Eventos',
    rotulo: 'ARTs / CAT (emissões)',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'evento',
    evento_tipo: 'art',
    doc_categorias: ['05'],
    item_schema: { data: 'data', numero: 'texto', profissional: 'texto', papel: 'texto' },
    chave_dedup: ['numero'],
    ordem: 52,
    pergunta:
      'Liste cada ART/CAT do documento: data de emissão/registro, número da ART, nome do profissional e papel (projeto/execução/fiscalização). Uma entrada por ART. NÃO use a data do carimbo de assinatura eletrônica.'
  }),
  C({
    chave: 'licencas',
    secao: 'Eventos',
    rotulo: 'Licenças ambientais',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'evento',
    evento_tipo: 'licenca',
    doc_categorias: ['10'],
    item_schema: { rotulo: 'texto', data: 'data', validade: 'data' },
    chave_dedup: ['rotulo'],
    ordem: 53,
    pergunta: 'Liste licenças ambientais (LP/LI/LO, ASV, Outorga) com data de emissão e validade.'
  }),

  // 6 · Cláusulas & Risco (incremental)
  C({
    chave: 'clausulas',
    secao: 'Cláusulas & Risco',
    rotulo: 'Cláusulas do contrato',
    tipo: 'lista',
    cardinalidade: 'incremental',
    alvo: 'clausula',
    doc_categorias: ['03', '07'],
    item_schema: {
      numero: 'texto',
      titulo: 'texto',
      categoria: 'texto',
      texto: 'texto'
    },
    chave_dedup: ['numero', 'titulo'],
    ordem: 60,
    pergunta:
      'Liste TODAS as cláusulas do contrato, em ordem: número/identificador da cláusula (ex.: "Cláusula Primeira", "5.2"), título, categoria temática (objeto, valor, prazo, garantia, reajuste, rescisão, penalidades, obrigações, fiscalização, foro…) e o TEXTO COMPLETO da cláusula (transcreva integralmente, não resuma). Uma entrada por cláusula. Não classifique risco aqui — isso é feito depois.'
  })
]

// ─────────────────────────────────────────────────────────────────────────
// Seed dos GRUPOS (base global). 20 canônicos + extras recorrentes das obras
// reais (consórcio, atas, notificações, pleitos, desapropriação, empenhos,
// orçamentos, compliance, NPO). Cópia editável por obra; adapta-se via
// aplicavel_se (consórcio / natureza público|privado / perfil de órgão).
// ─────────────────────────────────────────────────────────────────────────
const G = (
  g: Partial<GrupoTemplate> & Pick<GrupoTemplate, 'codigo' | 'nome' | 'tipo_codigo_base' | 'ordem'>
): GrupoTemplate => ({
  regras: '',
  contribuicao: '',
  campos_chaves: [],
  cardinalidade: 'multiplo',
  criticidade: 'apoio',
  vence: false,
  aplicavel_se: {},
  aliases: [],
  ...g
})

const GRUPOS_SEED: GrupoTemplate[] = [
  G({
    codigo: '01',
    nome: 'Edital e Anexos',
    tipo_codigo_base: '01',
    criticidade: 'essencial',
    cardinalidade: 'unico',
    ordem: 1,
    regras:
      'Edital de licitação e seus anexos (termo de referência, projeto básico/executivo, planilhas). Documento que ORIGINA a contratação.',
    contribuicao: 'Edital, lei/regime de regência, data-base e índice de reajuste.',
    campos_chaves: [
      'contrato.edital',
      'contrato.lei',
      'contrato.regime',
      'contrato.data_base',
      'contrato.indice_reajuste'
    ],
    aliases: ['edital', 'termo de referência', 'projeto básico', 'anexo', 'licitação']
  }),
  G({
    codigo: '02',
    nome: 'Proposta (Téc./Comercial)',
    tipo_codigo_base: '02',
    criticidade: 'recomendado',
    ordem: 2,
    regras: 'Proposta técnica e/ou comercial apresentada pela contratada na licitação.',
    contribuicao: 'Valores e premissas da proposta vencedora.',
    aliases: ['proposta', 'proposta comercial', 'proposta técnica']
  }),
  G({
    codigo: '03',
    nome: 'Contrato',
    tipo_codigo_base: '03',
    criticidade: 'essencial',
    cardinalidade: 'unico',
    ordem: 3,
    regras:
      'Instrumento contratual assinado, ficha/resumo do contrato e termo de referência anexo. NÚCLEO do dossiê.',
    contribuicao:
      'Número, contratante, objeto, processo, valor original (P0), prazos, assinatura e partes.',
    campos_chaves: [
      'contrato.numero',
      'contrato.contratante',
      'contrato.objeto',
      'contrato.processo',
      'contrato.sei',
      'contrato.lei',
      'contrato.regime',
      'contrato.cnae',
      'contrato.fiscal',
      'contrato.valor_p0',
      'contrato.data_base',
      'contrato.assinatura',
      'contrato.publicacao',
      'contrato.prazo_exec_dias',
      'contrato.prazo_vig_dias',
      'contrato.termino_exec',
      'contrato.termino_vig',
      'partes.consorcio',
      'eventos.marcos',
      'clausulas'
    ],
    aliases: ['contrato', 'CNT', 'ficha do contrato', 'resumo do contrato']
  }),
  G({
    codigo: '04',
    nome: 'Ordem de Serviço (e NPO)',
    tipo_codigo_base: '04',
    criticidade: 'essencial',
    ordem: 4,
    regras: 'Ordem de Serviço (início/paralisação/reinício) e Nota de Pré-Ordem. Define o INÍCIO.',
    contribuicao: 'Data de início dos serviços e marcos de execução.',
    campos_chaves: ['contrato.inicio_exec', 'contrato.termino_exec', 'eventos.marcos'],
    aliases: ['ordem de serviço', 'OS', 'ordem de início', 'paralisação', 'reinício']
  }),
  G({
    codigo: '05',
    nome: 'ART / CAT',
    tipo_codigo_base: '05',
    criticidade: 'essencial',
    vence: true,
    ordem: 5,
    regras: 'Anotações de Responsabilidade Técnica (ART) e Certidões de Acervo Técnico (CAT).',
    contribuicao: 'Responsáveis técnicos: nome, CREA, papel e nº da ART.',
    campos_chaves: ['responsaveis_tecnicos'],
    aliases: ['ART', 'CAT', 'responsabilidade técnica', 'CREA']
  }),
  G({
    codigo: '06',
    nome: 'Segurança do Trabalho (PGR/PCMSO)',
    tipo_codigo_base: '06',
    criticidade: 'essencial',
    vence: true,
    ordem: 6,
    regras: 'PGR, PCMSO, PCMAT, comunicação prévia e demais documentos de SST.',
    contribuicao: 'Conformidade de segurança e saúde ocupacional da obra.',
    aliases: ['PGR', 'PCMSO', 'PCMAT', 'segurança', 'comunicação prévia']
  }),
  G({
    codigo: '07',
    nome: 'Aditivos',
    tipo_codigo_base: '07',
    criticidade: 'condicional',
    ordem: 7,
    regras:
      'Termos aditivos de valor, quantidade, prazo ou rerratificação. NÃO confundir com reajuste/apostilamento.',
    contribuicao: 'Eventos de aditivo (delta de valor/prazo) e cláusulas alteradas.',
    campos_chaves: ['eventos.aditivos', 'clausulas'],
    aliases: ['aditivo', 'termo aditivo', 'TA', 'rerratificação', 'prorrogação']
  }),
  G({
    codigo: '08',
    nome: 'Reprogramação',
    tipo_codigo_base: '08',
    criticidade: 'condicional',
    ordem: 8,
    regras: 'Reprogramações de cronograma físico-financeiro aprovadas.',
    contribuicao: 'Replanejamento de prazos/cronograma.',
    aliases: ['reprogramação', 'cronograma', 'replanejamento']
  }),
  G({
    codigo: '09',
    nome: 'Reajuste / Apostilamento',
    tipo_codigo_base: '09',
    criticidade: 'condicional',
    ordem: 9,
    regras:
      'Apostilas de reajuste de preços (aplicação de índice/data-base). NÃO é aditivo de valor.',
    contribuicao: 'Eventos de reajuste (delta e valor resultante) — base do financeiro vigente.',
    campos_chaves: ['eventos.reajustes'],
    aliases: ['apostila', 'apostilamento', 'reajuste', 'reajustamento']
  }),
  G({
    codigo: '10',
    nome: 'Licenças Ambientais (LP/LI/LO, ASV, Outorga)',
    tipo_codigo_base: '10',
    criticidade: 'essencial',
    vence: true,
    ordem: 10,
    regras:
      'Licenças ambientais (LP/LI/LO), ASV, outorga/DUI de recursos hídricos, RCA e protocolos. Inclui pacotes .zip.',
    contribuicao: 'Eventos de licença com emissão e validade (controle de vencimento).',
    campos_chaves: ['licencas'],
    aliases: ['licença', 'LI', 'LP', 'LO', 'ASV', 'outorga', 'DUI', 'RCA', 'ambiental']
  }),
  G({
    codigo: '11',
    nome: 'CNO / CEI',
    tipo_codigo_base: '11',
    criticidade: 'essencial',
    cardinalidade: 'unico',
    ordem: 11,
    regras: 'Cadastro Nacional de Obras (CNO) / Cadastro Específico do INSS (CEI).',
    contribuicao: 'Registro fiscal da obra.',
    aliases: ['CNO', 'CEI', 'cadastro nacional de obras']
  }),
  G({
    codigo: '12',
    nome: 'Seguro Garantia',
    tipo_codigo_base: '12',
    criticidade: 'condicional',
    vence: true,
    ordem: 12,
    regras: 'Apólices de seguro garantia e seus endossos.',
    contribuicao: 'Garantia contratual vigente (controle de vencimento).',
    aliases: ['seguro garantia', 'apólice', 'endosso']
  }),
  G({
    codigo: '13',
    nome: 'Doc. Consórcio / Contratada',
    tipo_codigo_base: '13',
    criticidade: 'recomendado',
    ordem: 13,
    regras:
      'Documentos da contratada/consórcio: atos constitutivos, CNPJ, inscrições, percentuais de participação.',
    contribuicao: 'Identifica consorciadas, líder e percentuais; alimenta partes/consórcio e CNAE.',
    campos_chaves: ['partes.consorcio', 'contrato.cnae'],
    aplicavel_se: { consorcio: true },
    aliases: ['consórcio', 'constituição', 'CNPJ', 'inscrição estadual']
  }),
  G({
    codigo: '14',
    nome: 'Cartas e Ofícios',
    tipo_codigo_base: '14',
    criticidade: 'operacional',
    ordem: 14,
    regras: 'Ofícios e cartas recebidos/protocolados, comunicações oficiais e notas técnicas.',
    contribuicao: 'Comunicação oficial entre as partes (trilha de eventos).',
    aliases: ['ofício', 'carta', 'comunicação', 'nota técnica', 'protocolo']
  }),
  G({
    codigo: '15',
    nome: 'Tribunal de Contas (TCM/TCE)',
    tipo_codigo_base: '15',
    criticidade: 'condicional',
    ordem: 15,
    regras: 'Documentos de Tribunal de Contas (TCE/TCM): acórdãos, determinações, diligências.',
    contribuicao: 'Determinações de controle externo.',
    aliases: ['TCE', 'TCM', 'tribunal de contas', 'acórdão']
  }),
  G({
    codigo: '16',
    nome: 'Certidões / Matrícula / Desapropriação',
    tipo_codigo_base: '16',
    criticidade: 'condicional',
    ordem: 16,
    regras: 'Certidões, matrículas de imóveis e documentos de desapropriação/aquisição de área.',
    contribuicao: 'Regularidade fundiária e certidões.',
    aliases: ['certidão', 'matrícula', 'desapropriação', 'imóvel']
  }),
  G({
    codigo: '17',
    nome: 'Qualidade (SGQ/PGQ/PVEGQ)',
    tipo_codigo_base: '17',
    criticidade: 'recomendado',
    ordem: 17,
    regras: 'Planos e registros de qualidade: SGQ, PGQ, PVEGQ.',
    contribuicao: 'Gestão da qualidade da obra.',
    aliases: ['qualidade', 'SGQ', 'PGQ', 'PVEGQ']
  }),
  G({
    codigo: '18',
    nome: 'Termo de Entrega/Recebimento (TRP/TRD)',
    tipo_codigo_base: '18',
    criticidade: 'final',
    ordem: 18,
    regras: 'Termos de recebimento provisório (TRP) e definitivo (TRD); relatórios de recebimento.',
    contribuicao: 'Marco de ENCERRAMENTO da obra.',
    aliases: ['recebimento', 'TRP', 'TRD', 'entrega', 'provisório', 'definitivo']
  }),
  G({
    codigo: '19',
    nome: 'Portarias / Designação de Fiscal',
    tipo_codigo_base: '19',
    criticidade: 'operacional',
    ordem: 19,
    regras: 'Portarias de designação de fiscal/gestor e demais portarias do órgão.',
    contribuicao: 'Fiscal/gestor do contrato designado.',
    campos_chaves: ['contrato.fiscal'],
    aliases: ['portaria', 'designação', 'fiscal', 'gestor']
  }),
  G({
    codigo: '20',
    nome: 'Outros / Diversos',
    tipo_codigo_base: '20',
    criticidade: 'apoio',
    ordem: 20,
    regras: 'Documentos que não se enquadram nos demais grupos (arquivamento geral).',
    contribuicao: 'Arquivo de apoio.',
    aliases: ['outros', 'diversos']
  }),
  // ── Extras recorrentes (grupos próprios) ──────────────────────────────────
  G({
    codigo: 'empenhos',
    nome: 'Extratos de Empenho',
    tipo_codigo_base: '20',
    criticidade: 'operacional',
    aplicavel_se: { natureza: ['publico'] },
    ordem: 21,
    regras: 'Notas e extratos de empenho, situação/saldo de empenhos (execução orçamentária).',
    contribuicao: 'Execução orçamentária e disponibilidade financeira.',
    aliases: ['empenho', 'nota de empenho', 'saldo de empenho', 'execução orçamentária']
  }),
  G({
    codigo: 'orcamentos',
    nome: 'Orçamentos / Planilhas',
    tipo_codigo_base: '20',
    criticidade: 'recomendado',
    ordem: 22,
    regras: 'Orçamentos, planilhas orçamentárias e cronogramas físico-financeiros.',
    contribuicao: 'Composição de custos e cronograma.',
    aliases: ['orçamento', 'planilha', 'cronograma físico-financeiro', 'composição']
  }),
  G({
    codigo: 'atas',
    nome: 'Atas de Reunião',
    tipo_codigo_base: '14',
    criticidade: 'operacional',
    ordem: 23,
    regras: 'Atas de reunião entre as partes.',
    contribuicao: 'Decisões e compromissos registrados em reunião.',
    aliases: ['ata', 'reunião', 'ata de reunião']
  }),
  G({
    codigo: 'notificacoes_supervisora',
    nome: 'Notificações da Supervisora',
    tipo_codigo_base: '14',
    criticidade: 'operacional',
    ordem: 24,
    regras: 'Notificações e notas de conformidade (NC) emitidas pela supervisora.',
    contribuicao: 'Apontamentos da supervisão de obra.',
    aliases: ['notificação', 'NC', 'supervisora', 'nota de conformidade']
  }),
  G({
    codigo: 'pleitos',
    nome: 'Pleitos / Reequilíbrio',
    tipo_codigo_base: '14',
    criticidade: 'condicional',
    ordem: 25,
    regras: 'Pleitos, reivindicações e pedidos de reequilíbrio econômico-financeiro.',
    contribuicao: 'Reivindicações da contratada e seus desfechos.',
    aliases: ['pleito', 'reivindicação', 'reequilíbrio', 'recomposição']
  }),
  G({
    codigo: 'desapropriacao',
    nome: 'Desapropriação / Aquisição de Área',
    tipo_codigo_base: '16',
    criticidade: 'condicional',
    ordem: 26,
    regras: 'Processos de desapropriação e aquisição de áreas (canteiro, compensação, faixa).',
    contribuicao: 'Áreas adquiridas/desapropriadas para a obra.',
    aliases: ['desapropriação', 'aquisição de área', 'indenização', 'fazenda', 'canteiro']
  }),
  G({
    codigo: 'compliance',
    nome: 'Compliance',
    tipo_codigo_base: '13',
    criticidade: 'apoio',
    ordem: 27,
    regras: 'Documentos de compliance/integridade da contratada.',
    contribuicao: 'Integridade e due diligence da contratada.',
    aliases: ['compliance', 'integridade', 'due diligence']
  }),
  G({
    codigo: 'npo',
    nome: 'Nota de Pré-Ordem (NPO)',
    tipo_codigo_base: '04',
    criticidade: 'operacional',
    ordem: 28,
    regras: 'Notas de Pré-Ordem de Serviço (NPO), anteriores à OS definitiva.',
    contribuicao: 'Antecipação/condicionantes do início dos serviços.',
    aliases: ['NPO', 'nota de pré-ordem', 'pré-ordem']
  })
]

// ─────────────────────────────────────────────────────────────────────────
// Vínculo GRUPO → CAMPOS (o grupo dita os campos).
// `grupo.campos_chaves` é a FONTE DA VERDADE. O seed deriva esse mapa do
// `tipo_codigo_base` × `doc_categorias` dos campos (consistente e completo); a
// extração usa campos_chaves (granularidade por grupo). `doc_categorias` no
// campo é DERIVADO de volta (âncora por código base) para o resolver/consolidador
// continuarem funcionando em sincronia — ver derivarDocCategorias.
// ─────────────────────────────────────────────────────────────────────────
function comCamposChaves(grupos: GrupoTemplate[], campos: TemplateCampo[]): GrupoTemplate[] {
  return grupos.map((g) => ({
    ...g,
    campos_chaves: campos
      .filter((c) => c.doc_categorias.includes(g.tipo_codigo_base))
      .map((c) => c.chave)
  }))
}

/** Seed dos grupos (base global), com campos_chaves consistente com os campos. */
export const DEFAULT_TEMPLATE_GRUPOS: GrupoTemplate[] = comCamposChaves(
  GRUPOS_SEED,
  DEFAULT_TEMPLATE_CAMPOS
)

/**
 * Deriva `doc_categorias` de cada campo a partir dos grupos que o alimentam
 * (`campos_chaves`). Mantém a âncora por código base (01..20) — usada pelo
 * resolver/consolidador — em sincronia com a fonte da verdade (grupo → campos).
 * Campo sem nenhum grupo mantém suas categorias atuais (não é zerado).
 */
export function derivarDocCategorias(
  campos: TemplateCampo[],
  grupos: GrupoTemplate[]
): TemplateCampo[] {
  return campos.map((c) => {
    const bases = new Set<string>()
    for (const g of grupos)
      if ((g.campos_chaves ?? []).includes(c.chave)) bases.add(g.tipo_codigo_base)
    const doc_categorias = [...bases].sort()
    return doc_categorias.length ? { ...c, doc_categorias } : c
  })
}
