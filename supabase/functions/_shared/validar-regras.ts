// Regras testáveis do validador de TAP (R-XX). Funções PURAS (sem DB) p/ permitir
// fixtures de regressão. Derivadas da crítica ao TAP real da BR-030 (TT-392/2024).
// Severidades: BLOCKER (não emite definitivo) · WARN ("a conferir") · INFO.

export type Severidade = 'BLOCKER' | 'WARN' | 'INFO'

export interface Finding {
  regra_id: string
  severidade: Severidade
  campo?: string | null
  mensagem: string
  esperado?: string | null
  encontrado?: string | null
}

export interface VParte {
  papel: string
  nome: string
  cnpj?: string | null
}
export interface VEvento {
  tipo: string
  data_norm?: string | null
  delta?: number | null
  valor_resultante?: number | null
  rotulo?: string | null
}
export interface VContrato {
  numero?: string | null
  contratante?: string | null
  objeto?: string | null
  processo?: string | null
  edital?: string | null
  lei?: string | null
  regime?: string | null
  cnae?: string | null
  indice_reajuste?: string | null
  valor_p0?: number | null
  valor_vigente?: number | null
  data_base?: string | null
  assinatura?: string | null
  publicacao?: string | null
  prazo_exec_dias?: number | null
  prazo_vig_dias?: number | null
  inicio_exec?: string | null
  termino_exec?: string | null
  termino_vig?: string | null
}
export interface VDado {
  contrato: VContrato
  partes: VParte[]
  eventos: VEvento[]
  textos: string[]
  proveniencia: Record<string, { doc_id?: string | null; pagina?: number | null; confianca?: number | null }>
  hoje: string // AAAA-MM-DD
}

// ─── helpers de data ────────────────────────────────────────────────────────
const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)
const mes = (s: unknown): string | null => {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}` : null
}
function addDays(iso: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function diffDays(a: string, b: string): number {
  const pa = Date.parse(a.slice(0, 10))
  const pb = Date.parse(b.slice(0, 10))
  return Math.round((pa - pb) / 86400000)
}

function stripAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function chaveEmpresa(nome: string, cnpj?: string | null): string {
  const d = (cnpj ?? '').replace(/\D/g, '')
  if (d.length === 14) return d
  return stripAcentos(nome).toUpperCase().replace(/&AMP;/g, '&').replace(/\bBR-?30\b/g, 'BR-030')
    .replace(/\b(LTDA|EIRELI|S\.?A\.?|ME|EPP)\.?\b/g, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
}
function cnpjValido(cnpj?: string | null): boolean {
  const c = (cnpj ?? '').replace(/\D/g, '')
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (base: string, pesos: number[]): number => {
    const soma = base.split('').reduce((s, dg, i) => s + +dg * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(c.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return c.slice(12) === `${d1}${d2}`
}
const PALAVRAS_PJ = /(CONSORCIO|CONSÓRCIO|CONSTRU|ENGENHARIA|ENGENHARIA|PAVIMENT|LTDA|EIRELI|S\.?A|EMPRESA|COMERCIO|COMÉRCIO|SERVICOS|SERVIÇOS|TECNOLOGIA|INFRA|TERRAPLAN|ME\b|EPP\b|CIA\b)/i

const f = (regra_id: string, severidade: Severidade, campo: string | null, mensagem: string, extra?: { esperado?: string; encontrado?: string }): Finding =>
  ({ regra_id, severidade, campo, mensagem, esperado: extra?.esperado, encontrado: extra?.encontrado })

// ─── Regras ───────────────────────────────────────────────────────────────
type Regra = (d: VDado) => Finding[]

const REGRAS: Regra[] = [
  // 1 · Presença
  (d) => (!d.contrato.numero ? [f('R-01', 'BLOCKER', 'contrato.numero', 'Sem número de contrato.')] : []),
  (d) => (!d.contrato.contratante ? [f('R-02', 'BLOCKER', 'contrato.contratante', 'Sem contratante/órgão.')] : []),
  (d) => (!d.contrato.objeto ? [f('R-03', 'BLOCKER', 'contrato.objeto', 'Sem objeto.')] : []),
  (d) => (!(typeof d.contrato.valor_p0 === 'number' && d.contrato.valor_p0 > 0) ? [f('R-04', 'BLOCKER', 'contrato.valor_p0', 'Valor original (P0) ausente ou ≤ 0.')] : []),
  (d) => (!isISO(d.contrato.assinatura) ? [f('R-05', 'BLOCKER', 'contrato.assinatura', 'Data de assinatura ausente/ inválida.')] : []),
  (d) => (!((d.contrato.prazo_exec_dias ?? 0) > 0 && (d.contrato.prazo_vig_dias ?? 0) > 0) ? [f('R-06', 'BLOCKER', 'prazos', 'Prazo de execução e/ou vigência ausente.')] : []),
  (d) => (!d.contrato.data_base ? [f('R-08', 'WARN', 'contrato.data_base', 'Data-base ausente (necessária p/ reajuste).')] : []),
  (d) => {
    const out: Finding[] = []
    if (!d.contrato.cnae) out.push(f('R-09', 'WARN', 'contrato.cnae', 'CNAE ausente.'))
    if (!d.contrato.indice_reajuste) out.push(f('R-09', 'WARN', 'contrato.indice_reajuste', 'Índice/fórmula de reajuste ausente.'))
    return out
  },

  // 2 · Consistência temporal
  (d) => {
    if (!isISO(d.contrato.assinatura)) return []
    const datasEv = d.eventos.filter((e) => /apostil|reajust|aditiv/i.test(e.tipo)).map((e) => e.data_norm).filter(isISO)
    return datasEv.includes(d.contrato.assinatura)
      ? [f('R-10', 'BLOCKER', 'contrato.assinatura', 'Data de assinatura coincide com a de um apostilamento/aditivo (contaminação).', { encontrado: d.contrato.assinatura ?? undefined })]
      : []
  },
  (d) => {
    const db = mes(d.contrato.data_base)
    const asn = mes(d.contrato.assinatura)
    return db && asn && db > asn
      ? [f('R-11', 'BLOCKER', 'contrato.data_base', 'Data-base é posterior à assinatura.', { esperado: `≤ ${asn}`, encontrado: db })]
      : []
  },
  (d) => {
    const { inicio_exec, prazo_exec_dias, termino_exec } = d.contrato
    if (!isISO(inicio_exec) || !prazo_exec_dias || !isISO(termino_exec)) return []
    const calc = addDays(inicio_exec, prazo_exec_dias)
    if (calc && Math.abs(diffDays(calc, termino_exec)) > 5)
      return [f('R-12', 'BLOCKER', 'prazos', 'Início + prazo de execução não fecha com o término.', { esperado: calc, encontrado: termino_exec })]
    return []
  },
  (d) => (isISO(d.contrato.publicacao) && isISO(d.contrato.assinatura) && diffDays(d.contrato.publicacao!, d.contrato.assinatura!) < 0
    ? [f('R-13', 'WARN', 'contrato.publicacao', 'Publicação anterior à assinatura.')] : []),
  (d) => (isISO(d.contrato.termino_vig) && isISO(d.contrato.termino_exec) && diffDays(d.contrato.termino_vig!, d.contrato.termino_exec!) < 0
    ? [f('R-14', 'WARN', 'prazos', 'Término de vigência anterior ao término de execução.')] : []),
  (d) => {
    const db = mes(d.contrato.data_base)
    const hojeM = mes(d.hoje)
    return db && hojeM && db > hojeM ? [f('R-15', 'WARN', 'contrato.data_base', 'Data-base no futuro.', { encontrado: db })] : []
  },

  // 3 · Financeiro
  (d) => {
    const p0 = d.contrato.valor_p0
    const vt = d.contrato.valor_vigente
    if (typeof p0 !== 'number' || typeof vt !== 'number') return []
    const reaj = d.eventos.filter((e) => e.tipo === 'apostilamento').reduce((s, e) => s + (e.delta ?? 0), 0)
    const adit = d.eventos.filter((e) => e.tipo === 'aditivo').reduce((s, e) => s + (e.delta ?? 0), 0)
    return Math.abs(p0 + reaj + adit - vt) > 0.01
      ? [f('R-20', 'BLOCKER', 'financeiro.valor_total', 'Valor total ≠ P0 + reajustes + aditivos.', { esperado: (p0 + reaj + adit).toFixed(2), encontrado: vt.toFixed(2) })]
      : []
  },
  (d) => {
    const maus = d.eventos.filter((e) => e.tipo === 'aditivo' && /apostil|reajust/i.test(e.rotulo ?? ''))
    return maus.length ? [f('R-23', 'BLOCKER', 'eventos.aditivos', 'Apostilamento/reajuste classificado como aditivo de valor.')] : []
  },
  (d) => {
    const p0 = d.contrato.valor_p0
    if (typeof p0 !== 'number' || p0 <= 0) return []
    const adit = d.eventos.filter((e) => e.tipo === 'aditivo').reduce((s, e) => s + (e.delta ?? 0), 0)
    const pct = adit / p0
    if (pct > 0.5) return [f('R-24', 'BLOCKER', 'financeiro.pct_aditado', `Aditivos acima do teto de 50% (${(pct * 100).toFixed(1)}%).`)]
    if (pct >= 0.225) return [f('R-24', 'WARN', 'financeiro.pct_aditado', `Aditivos próximos do teto de 25% (${(pct * 100).toFixed(1)}%).`)]
    return []
  },

  // 4 · Identidade / normalização
  (d) => {
    const chaves = d.partes.filter((p) => /consorc|contratad/i.test(p.papel)).map((p) => chaveEmpresa(p.nome, p.cnpj))
    return new Set(chaves).size !== chaves.length
      ? [f('R-30', 'BLOCKER', 'partes', 'Empresas duplicadas após normalização.', { encontrado: chaves.join(' | ') })]
      : []
  },
  (d) => {
    const suspeitas = d.partes.filter((p) => /consorc|contratad/i.test(p.papel) && !((p.cnpj ?? '').replace(/\D/g, '').length === 14) && !PALAVRAS_PJ.test(p.nome) && p.nome.trim().split(/\s+/).length <= 4)
    return suspeitas.length
      ? [f('R-31', 'BLOCKER', 'partes', 'Possível pessoa física listada como contratada.', { encontrado: suspeitas.map((p) => p.nome).join(' | ') })]
      : []
  },
  (d) => {
    const re = /&amp;|&lt;|&gt;|&quot;|&#\d+;/
    const achou = d.textos.find((t) => re.test(t)) ?? (re.test(d.contrato.numero ?? '') ? d.contrato.numero : null)
    return achou ? [f('R-33', 'BLOCKER', 'texto', 'Entidade HTML não decodificada no texto.', { encontrado: String(achou).slice(0, 80) })] : []
  },
  // (R-34 de "prefixo do órgão" removida: era frágil — nem toda obra usa prefixo.
  //  A escolha do nº correto agora é por CONSENSO entre documentos no resolver.)
  (d) => (d.contrato.processo && d.contrato.edital && d.contrato.processo.replace(/\D/g, '') === d.contrato.edital.replace(/\D/g, '')
    ? [f('R-35', 'WARN', 'contrato.processo', 'Processo do contrato igual ao do edital — possível troca.')] : []),
  (d) => {
    const maus = d.partes.filter((p) => p.cnpj && !cnpjValido(p.cnpj))
    return maus.length ? [f('R-36', 'WARN', 'partes', 'CNPJ com dígito verificador inválido.', { encontrado: maus.map((p) => p.cnpj).join(' | ') })] : []
  },

  // 5 · Jurídicas
  (d) => {
    const reg = (d.contrato.regime ?? '').toUpperCase()
    const lei = d.contrato.lei ?? ''
    if ((/RDC/.test(reg) || /DIFERENCIADO/.test(reg)) && /14\.?133/.test(lei))
      return [f('R-41', 'BLOCKER', 'contrato.lei', 'Regime RDC incompatível com a Lei 14.133/2021.', { esperado: '12.462/2011 ou 8.666/1993', encontrado: lei })]
    return []
  },

  // 6 · Proveniência / confiança
  (d) => {
    const out: Finding[] = []
    for (const [campo, prov] of Object.entries(d.proveniencia)) {
      if (!prov?.doc_id) out.push(f('R-50', 'WARN', campo, 'Campo sem documento de origem (proveniência).'))
      else if (typeof prov.confianca === 'number' && prov.confianca < 0.8) out.push(f('R-51', 'WARN', campo, 'Confiança abaixo de 0,80 — a conferir.', { encontrado: prov.confianca.toFixed(2) }))
    }
    return out
  }
]

export function validarTap(d: VDado): Finding[] {
  return REGRAS.flatMap((r) => r(d))
}

export function podeEmitirDefinitivo(findings: Finding[]): boolean {
  return !findings.some((x) => x.severidade === 'BLOCKER')
}
