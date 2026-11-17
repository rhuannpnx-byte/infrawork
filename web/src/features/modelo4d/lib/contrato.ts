/**
 * Contrato do modelo 4D do InfraWork (`infrawork-4d`, versão 1: a geometria pronta). A descrição para quem gera
 * o arquivo está em `docs/MODELO-4D.md`; este arquivo é a fonte dos tipos e da validação. O arquivo com os dados
 * de projeto (versão 2) é montado nesta forma por `projeto.ts`.
 *
 * Coordenadas locais em metros: `x` (leste), `n` (norte) e `z` (cota). Posição ao longo do eixo (`s`) em metros
 * desde a estaca 0 do projeto (estaca 100 = 2000).
 */

import { lerFuso } from './geo'

export type Pt = [x: number, n: number, z: number]

export interface Eixo4D {
  id: string
  nome: string
  /** `[s, x, n, z]`, em ordem crescente de `s`. */
  pontos: [number, number, number, number][]
}

/** Grade do terreno. Cotas em Uint16 LE (base64), em centímetros sobre `zb`; 65535 = sem dado. */
export interface BlocoTerreno4D {
  nx: number
  ny: number
  /** Passo da grade, em metros. */
  res: number
  /** Canto noroeste: x do primeiro ponto e n da primeira linha (as linhas descem para o sul). */
  x0: number
  ytop: number
  zb: number
  atual: string
  /** Superfície de projeto; sem ela o terreno não muda com a terraplenagem. */
  projeto?: string
  /** JPEG em base64 estendido sobre o bloco. */
  imagem?: string
  /** Largura e altura que a imagem cobre, em metros, a partir do canto noroeste (padrão: a grade). */
  imagem_larg?: number
  imagem_alt?: number
}

export interface Classe4D {
  id: string
  nome: string
  disciplina: string
  /** Código do serviço do plano (linha de base) a que a classe se vincula. */
  servico?: string
  unidade?: string
  /** Só contexto: aparece sempre, em cor neutra, e não entra no 4D. */
  contexto?: boolean
  /** Terraplenagem: onde ela avança, o terreno natural dá lugar à obra. */
  terreno?: boolean
  /** Material da classe (ver `MATERIAIS`); sem ele, o InfraWork escolhe pelo nome. */
  material?: Material
}

/** Materiais que a cena sabe pintar. */
export const MATERIAIS = [
  'corte',
  'aterro',
  'solo',
  'granular',
  'betume',
  'asfalto',
  'concreto',
  'metal',
  'madeira',
  'grama',
  'sinal-branco',
  'sinal-amarelo',
  'sinal-vermelho',
  'sinal-verde',
  'sinal-azul',
  'contexto'
] as const
export type Material = (typeof MATERIAIS)[number]

/** Seção transversal da plataforma: pontos `[afastamento, cota]`, da esquerda (negativo) para a direita. */
export interface Secao4D {
  eixo?: string
  s: number
  perfil: [number, number][]
}

/** Faixa de afastamento `[de, até]` de uma camada; o terceiro número sobe ou desce só essa faixa (metros). */
export type FaixaCamada = [de: number, ate: number, elevacao?: number]

/** Camada sobre a plataforma entre duas estacas; a leitura a corta em fatias, uma por intervalo de seção. */
export interface Camada4D {
  classe: string
  eixo?: string
  s0: number
  s1: number
  /** Faixas de afastamento que a camada ocupa na seção. */
  faixas: FaixaCamada[]
  /** Topo da camada em relação ao perfil acabado da seção, em metros (negativo = abaixo dele). */
  elevacao?: number
  /** Espessura em metros: com ela a camada é um sólido, do topo para baixo. */
  espessura?: number
  material?: Material
  quantidade?: number
  nome?: string
}

export type Geo4D =
  /**
   * Peça ao longo de uma polilinha. Sem `perfil`, é um prisma de `largura` × `altura`. Com `perfil` (pontos
   * `[lateral, vertical]` da seção da peça, fechada), ele é extrudado: sarjeta, meio-fio, valeta. `postes` e `fios`
   * fazem cerca e defensa.
   */
  | {
      t: 'linha'
      pts: Pt[]
      largura: number
      altura?: number
      perfil?: [number, number][]
      postes?: { passo: number; altura: number; lado?: number }
      /** Alturas dos fios (ou da lâmina) sobre a polilinha, em metros. */
      fios?: number[]
    }
  /** Caixa: `dim` = [ao longo do rumo, transversal, altura]; `rumo` em radianos a partir do leste. */
  | { t: 'caixa'; p: Pt; dim: [number, number, number]; rumo?: number }
  /** Bueiro: tubular (`diametro`) ou celular (`largura` e `altura`), com `linhas` lado a lado, testas e alas. */
  | {
      t: 'tubo'
      p0: Pt
      p1: Pt
      diametro?: number
      largura?: number
      altura?: number
      linhas?: number
    }
  /** Placa em poste: `rumo` é para onde a face olha; `forma` e as medidas da chapa em metros. */
  | {
      t: 'placa'
      p: Pt
      rumo: number
      forma: 'circulo' | 'losango' | 'octogono' | 'triangulo' | 'retangulo'
      largura: number
      altura?: number
    }
  /** Malha pronta: `pos` em trincas x, n, z; `idx` opcional. */
  | { t: 'malha'; pos: number[]; idx?: number[] }

export interface Elemento4D {
  id: string
  classe: string
  nome?: string
  eixo?: string
  /** Sem `s0`/`s1`, a posição sai da projeção da geometria no eixo. */
  s0?: number
  s1?: number
  quantidade?: number
  material?: Material
  /** Assenta a peça no terreno natural (cerca, placa, poste): a cota da geometria vira altura sobre ele. */
  no_terreno?: boolean
  geo: Geo4D
}

export interface Modelo4D {
  formato: 'infrawork-4d'
  versao: 1
  nome: string
  /**
   * UTM do ponto (0, 0) local e o fuso ("22S"). É o que põe a obra no lugar certo do terreno e da imagem de
   * satélite.
   */
  origem: { e: number; n: number; fuso: string }
  eixos: Eixo4D[]
  terreno?: BlocoTerreno4D[]
  classes: Classe4D[]
  secoes?: Secao4D[]
  camadas?: Camada4D[]
  elementos: Elemento4D[]
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pt = (v: unknown): boolean => Array.isArray(v) && v.length >= 3 && v.every(num)

/** Confere a forma do arquivo e devolve o modelo ou a lista do que está errado (em português, para a tela). */
export function validarModelo(json: unknown): { modelo: Modelo4D } | { erros: string[] } {
  const erros: string[] = []
  const m = json as Partial<Modelo4D> | null
  if (!m || typeof m !== 'object') return { erros: ['O arquivo não é um JSON de modelo 4D.'] }
  if (m.formato !== 'infrawork-4d')
    return {
      erros: ['Falta `formato: "infrawork-4d"`: o arquivo não é um modelo 4D do InfraWork.']
    }
  if (m.versao !== 1)
    erros.push(
      m.versao === 2
        ? 'A versão 2 do contrato leva os dados de projeto no bloco `projeto`, que não veio no arquivo.'
        : `Versão ${String(m.versao)} do contrato não é aceita (1 = geometria pronta, 2 = dados de projeto).`
    )
  if (!num(m.origem?.e) || !num(m.origem?.n) || !lerFuso(m.origem?.fuso))
    erros.push(
      'Falta a `origem` com `e`, `n` e `fuso` (ex.: "22S"): é ela que põe a obra no terreno e na imagem de satélite.'
    )
  if (!Array.isArray(m.eixos) || m.eixos.length === 0)
    erros.push('O modelo precisa de ao menos um eixo.')
  const eixos = new Set<string>()
  for (const e of m.eixos ?? []) {
    if (!e?.id) erros.push('Eixo sem `id`.')
    else if (eixos.has(e.id)) erros.push(`Eixo "${e.id}" repetido.`)
    else eixos.add(e.id)
    const p = e?.pontos
    if (!Array.isArray(p) || p.length < 2)
      erros.push(`Eixo "${e?.id}" precisa de 2 pontos ou mais.`)
    else if (!p.every((q) => Array.isArray(q) && q.length >= 4 && q.every(num)))
      erros.push(`Eixo "${e.id}": cada ponto é [s, x, n, z].`)
    else if (p.some((q, i) => i > 0 && q[0] <= p[i - 1][0]))
      erros.push(`Eixo "${e.id}": os pontos precisam estar em ordem crescente de estaca.`)
  }
  const classes = new Set<string>()
  if (!Array.isArray(m.classes) || m.classes.length === 0) erros.push('O modelo não tem classes.')
  for (const c of m.classes ?? []) {
    if (!c?.id || !c?.nome || !c?.disciplina)
      erros.push('Classe precisa de `id`, `nome` e `disciplina`.')
    else if (classes.has(c.id)) erros.push(`Classe "${c.id}" repetida.`)
    else classes.add(c.id)
  }
  const eixoOk = (e: string | undefined): boolean => e == null || eixos.has(e)
  let semClasse = 0
  let semEixo = 0
  let geoRuim = 0
  const ids = new Set<string>()
  let repetidos = 0
  for (const el of m.elementos ?? []) {
    if (!classes.has(el?.classe)) semClasse++
    if (!eixoOk(el?.eixo)) semEixo++
    if (!el?.id || ids.has(el.id)) repetidos++
    else ids.add(el.id)
    const g = el?.geo
    const ok =
      g?.t === 'linha'
        ? Array.isArray(g.pts) && g.pts.length >= 2 && g.pts.every(pt) && num(g.largura)
        : g?.t === 'caixa'
          ? pt(g.p) && Array.isArray(g.dim) && g.dim.length === 3 && g.dim.every(num)
          : g?.t === 'tubo'
            ? pt(g.p0) && pt(g.p1) && (num(g.diametro) || (num(g.largura) && num(g.altura)))
            : g?.t === 'placa'
              ? pt(g.p) && num(g.rumo) && num(g.largura) && typeof g.forma === 'string'
              : g?.t === 'malha'
                ? Array.isArray(g.pos) && g.pos.length >= 9 && g.pos.length % 3 === 0
                : false
    if (!ok) geoRuim++
  }
  for (const c of m.camadas ?? []) {
    if (!classes.has(c?.classe)) semClasse++
    if (!eixoOk(c?.eixo)) semEixo++
    if (
      !num(c?.s0) ||
      !num(c?.s1) ||
      !(c.s1 > c.s0) ||
      !Array.isArray(c.faixas) ||
      !c.faixas.length
    )
      geoRuim++
  }
  if (!Array.isArray(m.elementos)) erros.push('Falta a lista `elementos` (pode ser vazia).')
  if (semClasse) erros.push(`${semClasse} elementos ou camadas citam uma classe que não existe.`)
  if (semEixo) erros.push(`${semEixo} elementos ou camadas citam um eixo que não existe.`)
  if (repetidos) erros.push(`${repetidos} elementos sem \`id\` ou com \`id\` repetido.`)
  if (geoRuim) erros.push(`${geoRuim} elementos ou camadas com geometria incompleta.`)
  if ((m.camadas?.length ?? 0) > 0 && !(m.secoes?.length ?? 0))
    erros.push(
      'Há camadas mas não há seções: as camadas são desenhadas sobre as seções da plataforma.'
    )
  for (const b of m.terreno ?? []) {
    if (![b?.nx, b?.ny, b?.res, b?.x0, b?.ytop, b?.zb].every(num) || typeof b.atual !== 'string') {
      erros.push('Bloco de terreno incompleto (nx, ny, res, x0, ytop, zb, atual).')
      break
    }
  }
  if (!(m.elementos?.length ?? 0) && !(m.camadas?.length ?? 0))
    erros.push('O modelo não tem elementos nem camadas.')
  return erros.length ? { erros } : { modelo: m as Modelo4D }
}
