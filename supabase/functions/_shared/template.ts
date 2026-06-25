// Helpers do template de extração (edge). Carrega os campos da obra, casa por
// categoria (âncora) e normaliza entidades/valores. Espelha o modelo do
// renderer (types/documentacao-template.ts).

// deno-lint-ignore no-explicit-any
type Admin = any

export interface TemplateCampo {
  chave: string
  secao: string
  rotulo: string
  pergunta: string
  tipo: 'texto' | 'data' | 'moeda' | 'numero' | 'booleano' | 'entidade' | 'lista'
  cardinalidade: 'escalar' | 'incremental'
  item_schema?: Record<string, string> | null
  chave_dedup?: string[]
  doc_categorias: string[]
  alvo: 'campo_dossie' | 'evento' | 'parte' | 'responsavel_tecnico' | 'clausula'
  evento_tipo?: string
  obrigatorio: boolean
  validacoes: string[]
  formato?: string
  ordem: number
}

/** Carrega os campos do template da obra (vazio se não houver). */
export async function carregarCampos(admin: Admin, obra_id: string): Promise<TemplateCampo[]> {
  const { data } = await admin
    .from('extracao_template')
    .select('campos')
    .eq('obra_id', obra_id)
    .maybeSingle()
  const campos = (data?.campos ?? []) as TemplateCampo[]
  return Array.isArray(campos) ? campos : []
}

// ─── Grupos (taxonomia de documentos como dado) ──────────────────────────────
export interface TemplateGrupo {
  codigo: string
  nome: string
  tipo_codigo_base: string
  regras?: string
  contribuicao?: string
  campos_chaves?: string[]
  cardinalidade?: 'unico' | 'multiplo'
  criticidade?: string
  vence?: boolean
  aplicavel_se?: {
    consorcio?: boolean
    natureza?: string[]
    perfil_orgao?: string[]
  }
  aliases?: string[]
  ordem?: number
}

/**
 * Fallback compacto (20 canônicos) caso a obra/empresa ainda não tenha grupos
 * persistidos. O catálogo RICO (com extras) vive no renderer e é semeado via
 * backfill em ensureTemplate; este é só a rede de segurança do classificador.
 */
export const DEFAULT_GRUPOS_FALLBACK: TemplateGrupo[] = [
  { codigo: '01', nome: 'Edital e Anexos', tipo_codigo_base: '01', ordem: 1 },
  { codigo: '02', nome: 'Proposta (Téc./Comercial)', tipo_codigo_base: '02', ordem: 2 },
  { codigo: '03', nome: 'Contrato', tipo_codigo_base: '03', ordem: 3 },
  { codigo: '04', nome: 'Ordem de Serviço (e NPO)', tipo_codigo_base: '04', ordem: 4 },
  { codigo: '05', nome: 'ART / CAT', tipo_codigo_base: '05', ordem: 5 },
  { codigo: '06', nome: 'Segurança do Trabalho (PGR/PCMSO)', tipo_codigo_base: '06', ordem: 6 },
  { codigo: '07', nome: 'Aditivos', tipo_codigo_base: '07', ordem: 7 },
  { codigo: '08', nome: 'Reprogramação', tipo_codigo_base: '08', ordem: 8 },
  { codigo: '09', nome: 'Reajuste / Apostilamento', tipo_codigo_base: '09', ordem: 9 },
  { codigo: '10', nome: 'Licenças Ambientais (LP/LI/LO, ASV, Outorga)', tipo_codigo_base: '10', ordem: 10 },
  { codigo: '11', nome: 'CNO / CEI', tipo_codigo_base: '11', ordem: 11 },
  { codigo: '12', nome: 'Seguro Garantia', tipo_codigo_base: '12', ordem: 12 },
  { codigo: '13', nome: 'Doc. Consórcio / Contratada', tipo_codigo_base: '13', ordem: 13 },
  { codigo: '14', nome: 'Cartas e Ofícios', tipo_codigo_base: '14', ordem: 14 },
  { codigo: '15', nome: 'Tribunal de Contas (TCM/TCE)', tipo_codigo_base: '15', ordem: 15 },
  { codigo: '16', nome: 'Certidões / Matrícula / Desapropriação', tipo_codigo_base: '16', ordem: 16 },
  { codigo: '17', nome: 'Qualidade (SGQ/PGQ/PVEGQ)', tipo_codigo_base: '17', ordem: 17 },
  { codigo: '18', nome: 'Termo de Entrega/Recebimento (TRP/TRD)', tipo_codigo_base: '18', ordem: 18 },
  { codigo: '19', nome: 'Portarias / Designação de Fiscal', tipo_codigo_base: '19', ordem: 19 },
  { codigo: '20', nome: 'Outros / Diversos', tipo_codigo_base: '20', ordem: 20 }
]

/** Carrega os grupos do template da obra; cai p/ base da empresa; senão fallback. */
export async function carregarGrupos(admin: Admin, obra_id: string): Promise<TemplateGrupo[]> {
  const { data: obra } = await admin
    .from('extracao_template')
    .select('grupos')
    .eq('obra_id', obra_id)
    .maybeSingle()
  let grupos = (obra?.grupos ?? []) as TemplateGrupo[]
  if (!Array.isArray(grupos) || !grupos.length) {
    const { data: o } = await admin.from('obras').select('empresa_id').eq('id', obra_id).maybeSingle()
    if (o?.empresa_id) {
      const { data: base } = await admin
        .from('extracao_template')
        .select('grupos')
        .is('obra_id', null)
        .eq('empresa_id', o.empresa_id)
        .maybeSingle()
      grupos = (base?.grupos ?? []) as TemplateGrupo[]
    }
  }
  return Array.isArray(grupos) && grupos.length ? grupos : DEFAULT_GRUPOS_FALLBACK
}

/** Filtra grupos aplicáveis ao perfil da obra (consórcio / natureza / órgão). */
export function gruposAplicaveis(
  grupos: TemplateGrupo[],
  ctx: { natureza?: string | null; perfil_orgao?: string | null; consorcio?: boolean | null }
): TemplateGrupo[] {
  return grupos.filter((g) => {
    const a = g.aplicavel_se ?? {}
    if (a.consorcio === true && ctx.consorcio !== true) return false
    if (a.natureza?.length && ctx.natureza && !a.natureza.includes(ctx.natureza)) return false
    if (a.perfil_orgao?.length && ctx.perfil_orgao && !a.perfil_orgao.includes(ctx.perfil_orgao))
      return false
    return true
  })
}

/** Mapa codigo→tipo_codigo_base (01..20) para casar com a FK documento.tipo_codigo. */
export function mapaGrupoBase(grupos: TemplateGrupo[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const g of grupos) m[g.codigo] = g.tipo_codigo_base || '20'
  return m
}

/**
 * Relação semântica HUB do grupo → contrato (por código base 01..20). Define o
 * verbo da aresta no grafo radial (ex.: aditivo MODIFICA, apostilamento REAJUSTA).
 */
export const GRUPO_REL: Record<string, string> = {
  '01': 'ORIGINA',
  '02': 'ORIGINA',
  '03': 'É_O_CONTRATO',
  '04': 'INICIA',
  '05': 'RESPONSABILIZA',
  '06': 'CONDICIONA',
  '07': 'MODIFICA',
  '08': 'REPROGRAMA',
  '09': 'REAJUSTA',
  '10': 'AUTORIZA',
  '11': 'REGISTRA',
  '12': 'GARANTE',
  '13': 'COMPÕE',
  '14': 'COMUNICA',
  '15': 'CONTROLA',
  '16': 'REGULARIZA',
  '17': 'QUALIDADE',
  '18': 'ENCERRA',
  '19': 'DESIGNA',
  '20': 'ANEXA'
}

export function relParaBase(base: string | null | undefined): string {
  return GRUPO_REL[String(base ?? '')] ?? 'RELACIONA'
}

/** Código de categoria (ex.: "03 Contrato" → "03"; "03" → "03"). */
export function categoriaCodigo(cat: string | null | undefined): string {
  const m = /^(\d{2})/.exec((cat ?? '').trim())
  return m ? m[1] : '20'
}

/** Campos cuja âncora de categoria casa com o documento (vazio = todas). */
export function camposParaCategoria(campos: TemplateCampo[], codigo: string): TemplateCampo[] {
  return campos.filter(
    (c) => !c.doc_categorias?.length || c.doc_categorias.includes(codigo)
  )
}

/**
 * Campos que um GRUPO alimenta (grupo dita os campos). Fonte da verdade =
 * grupo.campos_chaves. Se o grupo existe, devolve exatamente os campos listados
 * (mesmo que vazio → grupo não alimenta nada). Só cai para a âncora por código
 * base quando o grupo_codigo não está no template (classificação fora do catálogo).
 */
export function camposParaGrupo(
  campos: TemplateCampo[],
  grupos: TemplateGrupo[],
  grupo_codigo: string | null | undefined,
  fallbackCodigo: string
): TemplateCampo[] {
  const g = grupos.find((x) => x.codigo === grupo_codigo)
  if (g) {
    const chaves = new Set(g.campos_chaves ?? [])
    return campos.filter((c) => chaves.has(c.chave))
  }
  return camposParaCategoria(campos, fallbackCodigo)
}

// ─── Normalização ──────────────────────────────────────────────────────────
export function desescaparHtml(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
}

export function normalizarTexto(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = desescaparHtml(s).replace(/\s+/g, ' ').trim()
  return t || null
}

function stripAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Chave de identidade de uma empresa: CNPJ (14 díg) ou nome normalizado. */
export function chaveEntidade(nome: string | null, cnpj?: string | null): string {
  const d = (cnpj ?? '').replace(/\D/g, '')
  if (d.length === 14) return d
  return stripAcentos(nome ?? '')
    .toUpperCase()
    .replace(/&AMP;/g, '&')
    .replace(/\bBR-?30\b/g, 'BR-030')
    .replace(/\b(LTDA|EIRELI|S\.?A\.?|ME|EPP)\.?\b/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Validação de CNPJ (dígitos verificadores). */
export function cnpjValido(cnpj: string | null | undefined): boolean {
  const c = (cnpj ?? '').replace(/\D/g, '')
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (base: string, pesos: number[]): number => {
    const soma = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(c.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return c.slice(12) === `${d1}${d2}`
}

/** Chave de dedup para entradas incrementais, a partir de chave_dedup. */
export function chaveDedup(item: Record<string, unknown>, chaves: string[] | undefined): string {
  const ks = chaves?.length ? chaves : Object.keys(item)
  return ks
    .map((k) => {
      const v = item[k]
      if (typeof v === 'number') return String(v)
      return stripAcentos(String(v ?? '')).toUpperCase().replace(/\s+/g, ' ').trim()
    })
    .join('|')
}

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[^\d.-]/g, '')))
      ? Number(v.replace(/[^\d.-]/g, ''))
      : null

export const dateOnly = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** Soma `dias` a uma data ISO (AAAA-MM-DD) → nova data ISO. Null se inválida. */
export function addDiasIso(iso: string | null | undefined, dias: number): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + Math.round(dias))
  return d.toISOString().slice(0, 10)
}

/** Dias entre duas datas ISO (b − a). Null se alguma inválida. */
export function diasEntreIso(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const da = new Date(String(a).slice(0, 10) + 'T00:00:00Z').getTime()
  const db = new Date(String(b).slice(0, 10) + 'T00:00:00Z').getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.round((db - da) / 86400000)
}

/**
 * Normaliza data parcial preservando a PRECISÃO: aceita AAAA-MM-DD, AAAA-MM e
 * AAAA. Completa com 01 o que faltar (para ordenar), mas registra a precisão
 * (dia|mes|ano) — a timeline mostra ano-só como faixa, não ponto.
 */
export function normalizarDataParcial(v: unknown): { iso: string | null; precisao: string | null } {
  const s = typeof v === 'string' ? v.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { iso: s.slice(0, 10), precisao: 'dia' }
  if (/^\d{4}-\d{2}$/.test(s)) return { iso: `${s}-01`, precisao: 'mes' }
  if (/^\d{4}$/.test(s)) return { iso: `${s}-01-01`, precisao: 'ano' }
  return { iso: null, precisao: null }
}

/**
 * Vocabulário CONTROLADO de tipo de evento (slug). Normaliza o texto livre da IA
 * e sinônimos para chaves estáveis usadas em lanes/cores/dedup. Evita
 * "publicação"≠"publicacao" e "Ordem de Serviço"≠"início" virarem tipos distintos.
 */
export function slugEventoTipo(t: unknown): string {
  const s = stripAcentos(String(t ?? '')).toLowerCase().trim()
  if (!s) return 'evento'
  if (/assinatura|assinad/.test(s)) return 'assinatura'
  if (/public/.test(s)) return 'publicacao'
  if (/paralis/.test(s)) return 'paralisacao'
  if (/reinicio|reinício|retomad/.test(s)) return 'reinicio'
  if (/(ordem.*servic|^os\b|inicio)/.test(s)) return 'ordem_servico'
  if (/apostil|reajust/.test(s)) return 'apostilamento'
  if (/aditiv/.test(s)) return 'aditivo'
  if (/licen|asv|outorga|dui/.test(s)) return 'licenca'
  if (/\bart\b|\bcat\b|responsab/.test(s)) return 'art'
  if (/termino.*exec|conclus/.test(s)) return 'termino_exec'
  if (/termino.*vig|vigenc/.test(s)) return 'termino_vig'
  return s.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'evento'
}

/**
 * Dedup de eventos. `comRotulo=true` (timeline) só colapsa quando tipo+data+
 * delta+resultante E o rótulo coincidem — preserva eventos distintos no mesmo
 * dia. `comRotulo=false` (financeiro) é estrito (sem rótulo) — evita
 * dupla-contagem de um mesmo apostilamento citado em vários documentos.
 */
export function dedupEventos<T extends Record<string, unknown>>(eventos: T[], comRotulo = true): T[] {
  const chave = (e: T): string => {
    const rot = comRotulo ? `|${normalizarTexto(e.rotulo)?.toLowerCase() ?? ''}` : ''
    return `${e.tipo}|${e.data_norm ?? ''}|${e.delta ?? ''}|${e.valor_resultante ?? ''}${rot}`
  }
  const map = new Map<string, T>()
  for (const e of eventos) {
    const k = chave(e)
    const cur = map.get(k)
    if (!cur || ((e.confianca as number) ?? 0) > ((cur.confianca as number) ?? 0)) map.set(k, e)
  }
  return Array.from(map.values())
}

/**
 * Chave de CONSENSO p/ agrupar variações de superfície do MESMO valor sem
 * assumir formato/prefixo (antifrágil): minúsculas, sem acento, HTML decodificado,
 * separadores colapsados. Ex.: "TT-392/2024", "TT 392.2024" → "tt 392 2024";
 * "00 00392/2024" (ruído OCR) → "00 00392 2024" (grupo distinto, perde no consenso).
 */
export function chaveConsenso(v: unknown): string {
  return stripAcentos(String(v ?? ''))
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Financeiro derivado da cadeia de apostilamentos via DELTAS (confiáveis), sem
 * confiar num valor_p0 solto: P0 = resultante₁ − delta₁ (quando há resultante);
 * vigente = P0 + Σ reajustes + Σ aditivos. Antifrágil a resultante faltante.
 */
export function derivarFinanceiro(
  apost: Array<{ data_norm?: string | null; delta?: number | null; valor_resultante?: number | null }>,
  adit: Array<{ delta?: number | null }>,
  extractedP0: number | null
): { p0: number | null; vigente: number | null; pctReajuste: number; pctAditado: number } {
  const ordenado = [...apost].sort((a, b) => {
    const da = String(a.data_norm ?? '')
    const dbb = String(b.data_norm ?? '')
    if (da && dbb && da !== dbb) return da.localeCompare(dbb)
    return (num(a.valor_resultante) ?? num(a.delta) ?? 0) - (num(b.valor_resultante) ?? num(b.delta) ?? 0)
  })
  const comRes = ordenado.filter((e) => num(e.valor_resultante) != null)
  let p0 = extractedP0
  if (comRes.length) {
    const primeiro = comRes[0]
    const r = num(primeiro.valor_resultante) as number
    const d = num(primeiro.delta)
    if (d != null) p0 = r - d
    else if (p0 == null) p0 = r
  }
  const somaReaj = apost.reduce((s, e) => s + (num(e.delta) ?? 0), 0)
  const somaAdit = adit.reduce((s, e) => s + (num(e.delta) ?? 0), 0)
  const vigente = p0 != null ? p0 + somaReaj + somaAdit : null
  return {
    p0,
    vigente,
    pctReajuste: p0 ? (somaReaj / p0) * 100 : 0,
    pctAditado: p0 ? somaAdit / p0 : 0
  }
}
