// Arqueação de tanques: o volume de líquido para cada altura de régua, em qualquer formato comercial.
//
// Medidas em centímetros (internas) e volumes em litros. O corpo do tanque sai de fórmula fechada (área da seção até
// a altura × comprimento); os tampos elípticos também; o tampo abaulado e o torisférico saem de integração numérica.
// O resultado é a tabela de arqueação — litros acumulados a cada 1 cm, do fundo ao topo — que o cadastro grava no
// banco: é dela que saem a conversão das leituras, a prévia da tela e a folha impressa. O MCP usa este mesmo módulo.
//
// Mudou alguma fórmula? Suba a VERSAO_TABELA: ela fica gravada com cada tanque e diz com que cálculo a tabela nasceu.

export const VERSAO_TABELA = 1

export type Tampo =
  | { tipo: 'plano' }
  /** calota esférica: informa-se a flecha (o quanto o tampo avança no centro) */
  | { tipo: 'abaulado'; flecha: number }
  /** semielíptico 2:1: a profundidade é um quarto do diâmetro */
  | { tipo: 'semieliptico' }
  | { tipo: 'hemisferico' }
  /** calota de raio fc·D com rebordo de raio fk·D */
  | { tipo: 'torisferico'; fc: number; fk: number }

export type FundoVertical =
  { tipo: 'plano' } | { tipo: 'conico'; altura: number } | { tipo: 'abaulado'; flecha: number }

export type Tanque =
  | { forma: 'cilindrico_horizontal'; diametro: number; comprimento: number; tampo: Tampo }
  | { forma: 'cilindrico_vertical'; diametro: number; altura: number; fundo: FundoVertical }
  /** seção elíptica; `flecha` 0 = tampos planos */
  | {
      forma: 'eliptico_horizontal'
      largura: number
      altura: number
      comprimento: number
      flecha: number
    }
  /** seção de lados retos fechados por semicírculos ("elíptico + cilíndrico"); `flecha` 0 = tampos planos */
  | {
      forma: 'oval_horizontal'
      largura: number
      altura: number
      comprimento: number
      flecha: number
    }
  | { forma: 'retangular'; comprimento: number; largura: number; altura: number }
  /** tabela do fabricante: pares altura (cm) × volume (L) */
  | { forma: 'tabela'; pontos: Array<{ altura: number; volume: number }> }

export type FormaTanque = Tanque['forma']

/** Padrões comerciais de tampo torisférico (raio da calota e do rebordo como fração do diâmetro). */
export const PADROES_TORISFERICO = [
  { id: 'asme_fd', nome: 'ASME F&D', fc: 1, fk: 0.06 },
  { id: 'din_28011', nome: 'DIN 28011 (Klöpper)', fc: 1, fk: 0.1 },
  { id: 'asme_80_10', nome: 'ASME 80-10', fc: 0.8, fk: 0.1 },
  { id: 'din_28013', nome: 'DIN 28013 (Korbbogen)', fc: 0.8, fk: 0.154 }
] as const

const CM3_POR_LITRO = 1000
/** faixas de 1 mm na integração dos tampos */
const FAIXAS_POR_CM = 10
/** pontos na largura de cada faixa (regra do ponto médio em x = w·sen φ, que tira a tangente vertical da borda) */
const PONTOS_NA_LARGURA = 96

const positivo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const naoNegativo = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0

/** Área do segmento de círculo de raio `r` cheio até a altura `h` (0 a 2r). */
function segmentoCirculo(r: number, h: number): number {
  if (h <= 0) return 0
  if (h >= 2 * r) return Math.PI * r * r
  return r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(2 * r * h - h * h)
}

/** Volume da calota de uma esfera de raio `rc` com altura `h`. */
const calotaEsferica = (rc: number, h: number): number => (Math.PI * h * h * (3 * rc - h)) / 3

/** Raio da esfera cuja calota tem base de raio `r` e flecha `f`. */
const raioDaCalota = (r: number, f: number): number => (r * r + f * f) / (2 * f)

/**
 * Parte de um elipsoide de semieixos (a, b, d) cheia até a altura `h` (0 a 2b, medida no eixo b). É o volume dos
 * dois tampos elípticos juntos: semielíptico 2:1, hemisférico e o abaulado da seção elíptica.
 */
function elipsoideAte(a: number, b: number, d: number, h: number): number {
  const x = Math.min(Math.max(h, 0), 2 * b)
  return (Math.PI * a * d * x * x * (3 * b - x)) / (3 * b * b)
}

/** Perfil do tampo torisférico: quanto ele avança no raio `r` (0 no costado, máximo no centro). */
function perfilTorisferico(raio: number, fc: number, fk: number): (r: number) => number {
  const d = 2 * raio
  const rc = fc * d
  const rk = fk * d
  const prof = rc - Math.sqrt((rc - rk) ** 2 - (raio - rk) ** 2)
  const rTransicao = (rc * (raio - rk)) / (rc - rk)
  return (r) =>
    r <= rTransicao
      ? prof - rc + Math.sqrt(Math.max(0, rc * rc - r * r))
      : Math.sqrt(Math.max(0, rk * rk - (r - (raio - rk)) ** 2))
}

/** Profundidade do tampo torisférico no centro. */
export function profundidadeTorisferico(diametro: number, fc: number, fk: number): number {
  const rc = fc * diametro
  const rk = fk * diametro
  return rc - Math.sqrt((rc - rk) ** 2 - (diametro / 2 - rk) ** 2)
}

/**
 * Volume dos DOIS tampos acumulado a cada faixa de 1 mm, do fundo ao topo, por integração numérica.
 * `meiaLargura(y)` é a meia largura da seção na cota y (y = 0 no centro); `avanco(x, y)` é quanto o tampo avança
 * naquele ponto. Devolve o acumulado em cm³: o índice i vale a altura i/10 cm.
 */
function tamposAcumulados(
  alturaSecao: number,
  meiaLargura: (y: number) => number,
  avanco: (x: number, y: number) => number
): number[] {
  const n = Math.max(1, Math.round(alturaSecao * FAIXAS_POR_CM))
  const dy = alturaSecao / n
  const dphi = Math.PI / 2 / PONTOS_NA_LARGURA
  const acumulado = new Array<number>(n + 1)
  acumulado[0] = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const y = -alturaSecao / 2 + (i + 0.5) * dy
    const w = meiaLargura(y)
    let faixa = 0
    if (w > 0)
      for (let k = 0; k < PONTOS_NA_LARGURA; k++) {
        const phi = (k + 0.5) * dphi
        faixa += avanco(w * Math.sin(phi), y) * w * Math.cos(phi) * dphi
      }
    // × 2 pela simetria em x, × 2 pelos dois tampos
    total += 4 * faixa * dy
    acumulado[i + 1] = total
  }
  return acumulado
}

/** Lê o acumulado dos tampos numa altura qualquer (interpolando entre as faixas de 1 mm). */
function lerAcumulado(acumulado: number[], alturaSecao: number, h: number): number {
  const n = acumulado.length - 1
  const p = (Math.min(Math.max(h, 0), alturaSecao) / alturaSecao) * n
  const i = Math.min(n - 1, Math.floor(p))
  return acumulado[i] + (acumulado[i + 1] - acumulado[i]) * (p - i)
}

/**
 * Distância normalizada do centro à borda da seção oval, ao longo do raio (0 no centro, 1 na borda). O tampo
 * abaulado da seção oval é idealizado como d·√(1−ρ²); o tampo real tem calota rasa e rebordo, e fica um pouco mais
 * cheio — erro da ordem de 0,5% da capacidade. Quem precisar de mais usa a tabela do fabricante.
 */
function rhoOval(x: number, y: number, largura: number, altura: number): number {
  const deitado = largura >= altura
  const r = Math.min(largura, altura) / 2
  const s = Math.abs(largura - altura) / 2
  // u corre no sentido do trecho reto, v no sentido do raio dos semicírculos
  const u = Math.abs(deitado ? x : y)
  const v = Math.abs(deitado ? y : x)
  const dist = Math.hypot(u, v)
  if (dist === 0) return 0
  const c = u / dist
  const sn = v / dist
  const noReto = sn > 0 ? r / sn : Infinity
  const borda = noReto * c <= s ? noReto : s * c + Math.sqrt(Math.max(0, r * r - s * s * sn * sn))
  return Math.min(1, dist / borda)
}

/** Meia largura da seção oval na cota y (y = 0 no centro). */
function meiaLarguraOval(y: number, largura: number, altura: number): number {
  const r = Math.min(largura, altura) / 2
  const s = Math.abs(largura - altura) / 2
  if (largura >= altura) return s + Math.sqrt(Math.max(0, r * r - y * y))
  const ay = Math.abs(y)
  return ay <= s ? r : Math.sqrt(Math.max(0, r * r - (ay - s) ** 2))
}

/** Área da seção oval cheia até a altura `h`. */
function areaOval(largura: number, altura: number, h: number): number {
  const x = Math.min(Math.max(h, 0), altura)
  const r = Math.min(largura, altura) / 2
  if (largura >= altura) return segmentoCirculo(r, x) + (largura - altura) * x
  const reto = altura - largura
  const meio = (Math.PI * r * r) / 2
  if (x <= r) return segmentoCirculo(r, x)
  if (x <= r + reto) return meio + largura * (x - r)
  return meio + largura * reto + (meio - segmentoCirculo(r, altura - x))
}

/** Altura útil do tanque: do ponto mais baixo ao mais alto, em cm. */
export function alturaTotal(t: Tanque): number {
  switch (t.forma) {
    case 'cilindrico_horizontal':
      return t.diametro
    case 'cilindrico_vertical':
      return (
        t.altura +
        (t.fundo.tipo === 'conico'
          ? t.fundo.altura
          : t.fundo.tipo === 'abaulado'
            ? t.fundo.flecha
            : 0)
      )
    case 'eliptico_horizontal':
    case 'oval_horizontal':
    case 'retangular':
      return t.altura
    case 'tabela':
      return t.pontos.reduce((m, p) => Math.max(m, p.altura), 0)
  }
}

/** Confere as medidas. Devolve a frase do erro, ou `null` quando o tanque pode ser calculado. */
export function validarTanque(t: Tanque): string | null {
  switch (t.forma) {
    case 'cilindrico_horizontal': {
      if (!positivo(t.diametro) || !positivo(t.comprimento))
        return 'Informe o diâmetro e o comprimento do costado.'
      const r = t.diametro / 2
      if (t.tampo.tipo === 'abaulado') {
        if (!positivo(t.tampo.flecha)) return 'Informe a flecha do tampo.'
        if (t.tampo.flecha > r) return 'A flecha do tampo não pode passar da metade do diâmetro.'
      }
      if (t.tampo.tipo === 'torisferico') {
        const { fc, fk } = t.tampo
        if (!positivo(fc) || !positivo(fk)) return 'Informe os raios do tampo torisférico.'
        if (fk > 0.5 || fc < 0.5 || fk >= fc)
          return 'Raios do tampo torisférico fora do possível: o rebordo vai até metade do diâmetro e a calota começa nela.'
      }
      return null
    }
    case 'cilindrico_vertical':
      if (!positivo(t.diametro) || !positivo(t.altura)) return 'Informe o diâmetro e a altura.'
      if (t.fundo.tipo === 'conico' && !positivo(t.fundo.altura))
        return 'Informe a altura do fundo cônico.'
      if (t.fundo.tipo === 'abaulado') {
        if (!positivo(t.fundo.flecha)) return 'Informe a flecha do fundo.'
        if (t.fundo.flecha > t.diametro / 2)
          return 'A flecha do fundo não pode passar da metade do diâmetro.'
      }
      return null
    case 'eliptico_horizontal':
    case 'oval_horizontal':
      if (!positivo(t.largura) || !positivo(t.altura) || !positivo(t.comprimento))
        return 'Informe a largura, a altura e o comprimento.'
      if (!naoNegativo(t.flecha)) return 'A flecha do tampo não pode ser negativa.'
      return null
    case 'retangular':
      return positivo(t.comprimento) && positivo(t.largura) && positivo(t.altura)
        ? null
        : 'Informe o comprimento, a largura e a altura.'
    case 'tabela': {
      const pts = ordenarPontos(t.pontos)
      if (pts.length < 2) return 'Informe ao menos duas linhas da tabela (altura e volume).'
      if (pts.some((p) => !naoNegativo(p.altura) || !naoNegativo(p.volume)))
        return 'A tabela só aceita números, sem valores negativos.'
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].altura === pts[i - 1].altura)
          return 'A tabela tem duas linhas com a mesma altura.'
        if (pts[i].volume < pts[i - 1].volume)
          return 'O volume da tabela não pode diminuir quando a altura aumenta.'
      }
      if (pts[pts.length - 1].volume <= 0) return 'A última linha da tabela precisa ter volume.'
      return null
    }
  }
}

const ordenarPontos = (
  pontos: Array<{ altura: number; volume: number }>
): Array<{ altura: number; volume: number }> => [...pontos].sort((a, b) => a.altura - b.altura)

/** Volume da tabela do fabricante numa altura, por interpolação (abaixo da primeira linha, parte do zero). */
function volumeDosPontos(pontos: Array<{ altura: number; volume: number }>, h: number): number {
  const pts = ordenarPontos(pontos)
  if (pts.length === 0) return 0
  if (pts[0].altura > 0) pts.unshift({ altura: 0, volume: 0 })
  if (h <= pts[0].altura) return pts[0].volume
  for (let i = 1; i < pts.length; i++)
    if (h <= pts[i].altura) {
      const a = pts[i - 1]
      const b = pts[i]
      return a.volume + ((b.volume - a.volume) * (h - a.altura)) / (b.altura - a.altura)
    }
  return pts[pts.length - 1].volume
}

/**
 * Prepara o cálculo de um tanque: devolve a função altura (cm) → volume (L). As integrações numéricas dos tampos são
 * feitas uma vez aqui; chamar a função para muitas alturas é barato.
 */
export function calculadora(t: Tanque): (h: number) => number {
  const topo = alturaTotal(t)
  const limitar = (h: number): number => Math.min(Math.max(h, 0), topo)
  switch (t.forma) {
    case 'cilindrico_horizontal': {
      const r = t.diametro / 2
      const corpo = (h: number): number => segmentoCirculo(r, h) * t.comprimento
      const tampo = t.tampo
      if (tampo.tipo === 'plano') return (h) => corpo(limitar(h)) / CM3_POR_LITRO
      if (tampo.tipo === 'semieliptico' || tampo.tipo === 'hemisferico') {
        const d = tampo.tipo === 'hemisferico' ? r : r / 2
        return (h) => (corpo(limitar(h)) + elipsoideAte(r, r, d, limitar(h))) / CM3_POR_LITRO
      }
      let perfil: (raio: number) => number
      if (tampo.tipo === 'abaulado') {
        const rc = raioDaCalota(r, tampo.flecha)
        perfil = (raio) => Math.sqrt(Math.max(0, rc * rc - raio * raio)) - (rc - tampo.flecha)
      } else perfil = perfilTorisferico(r, tampo.fc, tampo.fk)
      const acumulado = tamposAcumulados(
        t.diametro,
        (y) => Math.sqrt(Math.max(0, r * r - y * y)),
        (x, y) => Math.max(0, perfil(Math.hypot(x, y)))
      )
      return (h) =>
        (corpo(limitar(h)) + lerAcumulado(acumulado, t.diametro, limitar(h))) / CM3_POR_LITRO
    }
    case 'cilindrico_vertical': {
      const r = t.diametro / 2
      const base = Math.PI * r * r
      const fundo = t.fundo
      if (fundo.tipo === 'plano') return (h) => (base * limitar(h)) / CM3_POR_LITRO
      if (fundo.tipo === 'conico') {
        const c = fundo.altura
        return (h) => {
          const x = limitar(h)
          const noCone = Math.min(x, c)
          // cone com o vértice para baixo: o raio cresce com a altura
          return ((base * noCone ** 3) / (3 * c * c) + base * Math.max(0, x - c)) / CM3_POR_LITRO
        }
      }
      const f = fundo.flecha
      const rc = raioDaCalota(r, f)
      return (h) => {
        const x = limitar(h)
        return (calotaEsferica(rc, Math.min(x, f)) + base * Math.max(0, x - f)) / CM3_POR_LITRO
      }
    }
    case 'eliptico_horizontal': {
      const a = t.largura / 2
      const b = t.altura / 2
      return (h) => {
        const x = limitar(h)
        return (
          ((a / b) * segmentoCirculo(b, x) * t.comprimento + elipsoideAte(a, b, t.flecha, x)) /
          CM3_POR_LITRO
        )
      }
    }
    case 'oval_horizontal': {
      const corpo = (h: number): number => areaOval(t.largura, t.altura, h) * t.comprimento
      if (!(t.flecha > 0)) return (h) => corpo(limitar(h)) / CM3_POR_LITRO
      const acumulado = tamposAcumulados(
        t.altura,
        (y) => meiaLarguraOval(y, t.largura, t.altura),
        (x, y) => {
          const rho = rhoOval(x, y, t.largura, t.altura)
          return t.flecha * Math.sqrt(Math.max(0, 1 - rho * rho))
        }
      )
      return (h) =>
        (corpo(limitar(h)) + lerAcumulado(acumulado, t.altura, limitar(h))) / CM3_POR_LITRO
    }
    case 'retangular':
      return (h) => (t.comprimento * t.largura * limitar(h)) / CM3_POR_LITRO
    case 'tabela':
      return (h) => volumeDosPontos(t.pontos, limitar(h))
  }
}

/** Volume (L) do tanque cheio até a altura `h` (cm). Para muitas alturas, use `calculadora`. */
export function volumeNaAltura(t: Tanque, h: number): number {
  return calculadora(t)(h)
}

/** Capacidade do tanque (L). */
export function capacidade(t: Tanque): number {
  return calculadora(t)(alturaTotal(t))
}

const duasCasas = (v: number): number => Math.round(v * 100) / 100

/**
 * Tabela de arqueação: litros acumulados a cada 1 cm. O índice é a altura em cm; o último ponto fica na altura
 * total arredondada para cima e vale a capacidade. Começa em zero e nunca decresce — é o que o banco confere.
 */
export function tabelaArqueacao(t: Tanque): number[] {
  const volume = calculadora(t)
  const topo = alturaTotal(t)
  const n = Math.max(1, Math.ceil(topo - 1e-9))
  const tabela = new Array<number>(n + 1)
  let anterior = 0
  for (let i = 0; i <= n; i++) {
    const v = i === 0 ? 0 : Math.max(anterior, duasCasas(volume(Math.min(i, topo))))
    tabela[i] = v
    anterior = v
  }
  return tabela
}

/** Volume (L) numa altura (cm) lido da tabela de arqueação, por interpolação. É a mesma conta do banco. */
export function volumeNaTabela(tabela: number[], nivelCm: number): number {
  if (tabela.length === 0) return 0
  const ultimo = tabela.length - 1
  const x = Math.min(Math.max(nivelCm, 0), ultimo)
  const i = Math.min(ultimo - 1, Math.floor(x))
  if (ultimo === 0) return tabela[0]
  return duasCasas(tabela[i] + (tabela[i + 1] - tabela[i]) * (x - i))
}

/** Altura (cm, uma casa) em que a tabela chega a um volume (L). */
export function nivelParaVolume(tabela: number[], litros: number): number {
  const ultimo = tabela.length - 1
  if (ultimo <= 0 || litros <= 0) return 0
  if (litros >= tabela[ultimo]) return ultimo
  let i = 0
  while (i < ultimo && tabela[i + 1] < litros) i++
  const faixa = tabela[i + 1] - tabela[i]
  const x = i + (faixa > 0 ? (litros - tabela[i]) / faixa : 0)
  return Math.round(x * 10) / 10
}

/**
 * A régua lida pelo vazio mede da boca de medição para baixo: a altura do líquido é a altura de referência (da boca
 * ao fundo) menos a leitura. Pelo cheio, a leitura já é a altura do líquido.
 */
export function nivelDaLeitura(
  leitura: number,
  leituraPor: 'cheio' | 'vazio',
  alturaReferenciaCm: number | null | undefined
): number {
  if (leituraPor === 'vazio') return Math.max(0, (alturaReferenciaCm ?? 0) - leitura)
  return Math.max(0, leitura)
}

/** Linha da folha de controle: o que o almoxarife lê na régua, os litros e quanto vale aquele centímetro. */
export interface LinhaArqueacao {
  /** o número da régua (altura do líquido, ou do vazio quando a régua mede o vazio) */
  leitura: number
  /** altura do líquido, em cm */
  nivel: number
  litros: number
  /** litros entre esta altura e 1 cm abaixo */
  litrosPorCm: number
}

/** As linhas da folha de controle, na ordem em que o operador lê a régua (de cima para baixo no modo vazio). */
export function linhasDaFolha(
  tabela: number[],
  leituraPor: 'cheio' | 'vazio',
  alturaReferenciaCm: number | null | undefined
): LinhaArqueacao[] {
  const linhas: LinhaArqueacao[] = []
  for (let nivel = 0; nivel < tabela.length; nivel++)
    linhas.push({
      leitura: leituraPor === 'vazio' ? duasCasas((alturaReferenciaCm ?? 0) - nivel) : nivel,
      nivel,
      litros: tabela[nivel],
      litrosPorCm: nivel === 0 ? 0 : duasCasas(tabela[nivel] - tabela[nivel - 1])
    })
  return leituraPor === 'vazio' ? linhas.reverse() : linhas
}

/**
 * Lê a tabela do fabricante colada da planilha: uma linha por par, altura e volume separados por tabulação, ponto e
 * vírgula ou espaços, com números no padrão brasileiro (1.234,5) ou com ponto decimal. Linhas sem dois números
 * (cabeçalho, vazias) são ignoradas.
 */
export function lerTabelaColada(texto: string): Array<{ altura: number; volume: number }> {
  const numero = (s: string): number => {
    const limpo = s.trim().replace(/[^\d.,-]/g, '')
    if (!limpo) return NaN
    // vírgula presente: padrão brasileiro (ponto é milhar). Sem vírgula, "2.600" e "12.345.678" são milhar
    // (grupos de três dígitos); qualquer outro ponto é decimal ("120.75").
    if (limpo.includes(',')) return Number(limpo.replace(/\./g, '').replace(',', '.'))
    if (/^-?\d{1,3}(\.\d{3})+$/.test(limpo)) return Number(limpo.replace(/\./g, ''))
    return Number(limpo)
  }
  const pontos: Array<{ altura: number; volume: number }> = []
  for (const linha of texto.split(/\r?\n/)) {
    const partes = linha.split(/\t|;/).map((p) => p.trim())
    const campos = partes.length >= 2 ? partes : linha.trim().split(/\s+/)
    if (campos.length < 2) continue
    const altura = numero(campos[0])
    const volume = numero(campos[1])
    if (Number.isFinite(altura) && Number.isFinite(volume)) pontos.push({ altura, volume })
  }
  return ordenarPontos(pontos)
}
