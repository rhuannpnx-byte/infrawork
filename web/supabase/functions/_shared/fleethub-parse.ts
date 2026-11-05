// Leitura da página /equipamento da FleetHub (HTML do servidor, sem API). TS puro: roda na Edge Function e no vitest.
// Formato inesperado lança FormatoFleetHubError — a sincronização para sem mexer na frota.

export interface EquipamentoFleet {
  fleet_id: number
  codigo: string
  placa: string | null
  tipo: string
  marca: string | null
  modelo: string | null
  ano: number | null
  obra: string | null
}

export interface ObraFleet {
  fleet_id: number
  nome: string
}

export type TipoInfraWork =
  | 'basculante'
  | 'carreta'
  | 'betoneira'
  | 'pipa'
  | 'caminhao'
  | 'escavadeira'
  | 'retroescavadeira'
  | 'carregadeira'
  | 'outro'

/** Máquinas que carregam o caminhão ("Carregado por" na viagem); as demais transportam. */
export const TIPOS_MAQUINA_DE_CARGA: readonly TipoInfraWork[] = ['escavadeira', 'retroescavadeira', 'carregadeira']

export class FormatoFleetHubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatoFleetHubError'
  }
}

/** Cabeçalho esperado da tabela (sem acento, maiúsculas). "Ação" é ignorada. */
export const CABECALHO = ['ID', 'CODIGO', 'PLACA', 'TIPO', 'MARCA', 'MODELO', 'ANO', 'OBRA'] as const

/** Tipos da FleetHub que entram na frota (transporte de carga e máquinas de carga); os demais ficam de fora. */
export const TIPOS_CARGA: Readonly<Record<string, TipoInfraWork>> = {
  'ESCAVADEIRA HIDRAULICA': 'escavadeira',
  'MINI ESCAVADEIRA': 'escavadeira',
  RETROESCAVADEIRA: 'retroescavadeira',
  'PA CARREGADEIRA': 'carregadeira',
  'MINI CARREGADEIRA': 'carregadeira',
  'CAMINHAO BASCULANTE': 'basculante',
  'CAMINHAO PRANCHA E BASCULANTE': 'basculante',
  'CAVALO MECANICO': 'carreta',
  'SEMI-REBOQUE BASCULANTE': 'carreta',
  CARRETA: 'carreta',
  'CARRETA DE REBOQUE': 'carreta',
  PRANCHA: 'carreta',
  'CAMINHAO BETONEIRA': 'betoneira',
  'CAMINHAO PIPA': 'pipa',
  'CAMINHAO CARROCERIA': 'caminhao',
  'CAMINHAO PLATAFORMA': 'caminhao',
}

/** "Caminhão  basculante " → "CAMINHAO BASCULANTE". */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Tipo InfraWork do equipamento, ou `null` se não é de transporte de carga. */
export function tipoInfraWork(tipoFleet: string): TipoInfraWork | null {
  return TIPOS_CARGA[normalizar(tipoFleet)] ?? null
}

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  sup2: '²',
  sup3: '³',
}

export function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTIDADES[e.toLowerCase()] ?? m
  })
}

/** Texto visível de um trecho de HTML (sem tags, entidades decodificadas, espaços colapsados). */
export function texto(html: string): string {
  return decodificar(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** `_token` (CSRF) do formulário de login. */
export function extrairToken(html: string): string | null {
  return (
    html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ??
    html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] ??
    null
  )
}

/** A página é a de login (sessão não aberta / login recusado)? */
export function ehPaginaDeLogin(html: string): boolean {
  return /<input[^>]+type="password"/i.test(html) && /name="_token"/.test(html)
}

function celulas(linha: string): string[] {
  return [...linha.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => texto(m[1] ?? ''))
}

/** Todas as linhas da tabela de equipamentos. Lança `FormatoFleetHubError` se o formato mudou. */
export function parseEquipamentos(html: string): EquipamentoFleet[] {
  const tabela = html.match(/<table\b[^>]*\bid="table"[^>]*>([\s\S]*?)<\/table>/i)?.[1]
  if (!tabela) throw new FormatoFleetHubError('Tabela de equipamentos não encontrada na FleetHub')
  const thead = tabela.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? ''
  const cab = celulas(thead).map(normalizar)
  if (CABECALHO.some((c, i) => cab[i] !== c)) {
    throw new FormatoFleetHubError(`Colunas da FleetHub mudaram: ${cab.join(', ') || '(vazio)'}`)
  }
  const tbody = tabela.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? ''
  const out: EquipamentoFleet[] = []
  for (const m of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const c = celulas(m[1] ?? '')
    if (c.length < CABECALHO.length) continue // linha "nenhum registro" do DataTables
    const id = Number(c[0])
    if (!Number.isInteger(id) || id <= 0 || !c[1]) {
      throw new FormatoFleetHubError(`Linha inesperada na FleetHub: ${c.slice(0, 3).join(' | ')}`)
    }
    const ano = Number(c[6])
    out.push({
      fleet_id: id,
      codigo: c[1]!,
      placa: c[2] || null,
      tipo: c[3] ?? '',
      marca: c[4] || null,
      modelo: c[5] || null,
      ano: Number.isInteger(ano) && ano > 1900 ? ano : null,
      obra: c[7] || null,
    })
  }
  return out
}

/** Obras da FleetHub (opções do filtro de obra). */
export function parseObras(html: string): ObraFleet[] {
  const sel = html.match(/<select\b[^>]*name="obraEquipamento\[\]"[^>]*>([\s\S]*?)<\/select>/i)?.[1]
  if (sel == null) throw new FormatoFleetHubError('Filtro de obras não encontrado na FleetHub')
  const out: ObraFleet[] = []
  for (const m of sel.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const id = Number(m[1])
    const nome = texto(m[2] ?? '')
    if (Number.isInteger(id) && id > 0 && nome) out.push({ fleet_id: id, nome })
  }
  return out
}

/** Campo Capacidade da página de edição (/equipamento/editar/{id}): texto digitado e unidade salva. */
export function parseCapacidade(html: string): { valor: string; unidade: string } {
  const input = html.match(/<input\b[^>]*\bname="capacidade"[^>]*>/i)?.[0]
  if (!input) throw new FormatoFleetHubError('Campo Capacidade não encontrado na página do equipamento')
  const valor = decodificar(input.match(/\bvalue="([^"]*)"/i)?.[1] ?? '').trim()
  const unidade = decodificar(html.match(/\bdata-unidade-salva="([^"]*)"/i)?.[1] ?? '').trim()
  return { valor, unidade }
}

/** Tipos cuja Capacidade na FleetHub não é cubagem (cavalo: tração). */
const SEM_CUBAGEM = new Set(['CAVALO MECANICO'])

/** Equipamento cuja página de edição vale ler para a cubagem (transporte, menos cavalo e máquinas de carga). */
export function temCubagem(e: { tipo: string; tipo_infrawork: TipoInfraWork }): boolean {
  return !TIPOS_MAQUINA_DE_CARGA.includes(e.tipo_infrawork) && !SEM_CUBAGEM.has(normalizar(e.tipo))
}

type Unidade = 'm3' | 't' | 'l' | 'desconhecida' | null

function unidadeDe(s: string): Unidade {
  const u = normalizar(s).replace(/³/g, '3').replace(/[\s.]/g, '')
  if (!u) return null
  if (/^(M|M3|M\/3|MT|MTS|METROS?(CUBICOS?)?)$/.test(u)) return 'm3'
  if (/^(T|TN|TON|TONS|TONELADAS?)$/.test(u)) return 't'
  if (/^(L|LT|LTS|LITROS?)$/.test(u)) return 'l'
  return 'desconhecida'
}

/** "16,12" → 16.12; "20.000" → 20000; "15.98" → 15.98. */
function numero(s: string): number | null {
  let t = s.replace(/[.,]$/, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export const CUBAGEM_MIN_M3 = 2
export const CUBAGEM_MAX_M3 = 60

/**
 * Cubagem em m³ a partir do campo da FleetHub, ou `null` quando não dá para confiar: unidade em toneladas,
 * texto sem número ou valor fora de 2–60 m³ (ex.: "1", "0", "*.*"). Sem unidade, o número é tomado como m³;
 * litros viram m³ (÷ 1000). A unidade salva no formulário vale mais que a escrita junto do número.
 */
export function cubagemM3(valor: string, unidadeSalva: string): number | null {
  const m = valor.match(/\d[\d.,]*/)
  if (!m) return null
  const n = numero(m[0])
  if (n === null) return null
  const u = unidadeDe(unidadeSalva) ?? unidadeDe(valor.slice((m.index ?? 0) + m[0].length))
  const m3 = u === 'm3' || u === null ? n : u === 'l' ? n / 1000 : null
  if (m3 === null || m3 < CUBAGEM_MIN_M3 || m3 > CUBAGEM_MAX_M3) return null
  return Math.round(m3 * 100) / 100
}

/** Texto da capacidade como aparece na FleetHub ("15.98 ton"), ou `null` se o campo está vazio. */
export function textoCapacidade(valor: string, unidade: string): string | null {
  const v = valor.trim()
  if (!v) return null
  const u = unidade.trim()
  return u && !normalizar(v).endsWith(normalizar(u)) ? `${v} ${u}` : v
}

/** Só os equipamentos de transporte de carga e as máquinas de carga, com o tipo InfraWork. */
export function equipamentosDeCarga(
  lista: EquipamentoFleet[],
): (EquipamentoFleet & { tipo_infrawork: TipoInfraWork })[] {
  return lista.flatMap((e) => {
    const t = tipoInfraWork(e.tipo)
    return t ? [{ ...e, tipo_infrawork: t }] : []
  })
}
