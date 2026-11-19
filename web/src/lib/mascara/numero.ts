/**
 * Texto de campo numérico em pt-BR.
 *
 * O "canônico" é o que o campo entrega a quem o usa: só algarismos, vírgula decimal e, quando aceito, o sinal de
 * menos na frente ("1234,56"). Não tem ponto de milhar, então qualquer leitor do sistema (`parseBR`, `parseNumero`)
 * entende sem ambiguidade. O ponto de milhar existe só na exibição (`agrupar`).
 */

export interface OpcoesNumero {
  /** Casas decimais aceitas na digitação; 0 = inteiro. */
  casas: number
  /** Aceita número negativo. */
  negativo?: boolean
}

function montar(neg: boolean, int: string, dec: string | null): string {
  const i = int.replace(/^0+(?=\d)/, '')
  if (i === '' && dec === null) return neg ? '-' : ''
  return `${neg ? '-' : ''}${i === '' ? '0' : i}${dec === null ? '' : `,${dec}`}`
}

/**
 * Texto que veio de fora do campo (banco, colar, preenchimento automático): aceita "1.234,56", "1234,56",
 * "1,234.56" e "1234.56". Um ponto só, sem vírgula, é decimal: a mesma regra de `parseBR` e `parseNumero`.
 * `limitar` corta as casas além das aceitas; valor que já estava gravado não é cortado.
 */
export function canonicoDeTexto(texto: string, o: OpcoesNumero, limitar = false): string {
  const t = texto.trim()
  const neg = !!o.negativo && /^[^\d.,]*-/.test(t)
  const s = t.replace(/[^\d.,]/g, '')
  if (!/\d/.test(s)) return ''
  const virgulas = (s.match(/,/g) ?? []).length
  const pontos = (s.match(/\./g) ?? []).length
  let sep = -1
  if (virgulas > 0 && pontos > 0) sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
  else if (virgulas === 1) sep = s.indexOf(',')
  else if (virgulas === 0 && pontos === 1) sep = s.indexOf('.')
  const int = (sep < 0 ? s : s.slice(0, sep)).replace(/\D/g, '')
  let dec = sep < 0 ? '' : s.slice(sep + 1).replace(/\D/g, '')
  if (limitar) dec = dec.slice(0, o.casas)
  // zeros à direita não dizem nada ("18416.6700" do banco vira "18416,67")
  dec = dec.replace(/0+$/, '')
  return montar(neg, int, dec === '' ? null : dec)
}

/**
 * Texto do campo durante a digitação: a exibição agrupada com a edição de quem digita. Aqui todo ponto é de
 * milhar (o ponto digitado vira vírgula antes, no componente). Mantém a vírgula final ("12,") para a digitação
 * continuar.
 */
export function canonicoDeDigitacao(texto: string, o: OpcoesNumero): string {
  const neg = !!o.negativo && /^\s*-/.test(texto)
  const s = texto.replace(/[^\d,]/g, '')
  const sep = o.casas > 0 ? s.indexOf(',') : -1
  const int = (sep < 0 ? s : s.slice(0, sep)).replace(/\D/g, '')
  const dec =
    sep < 0
      ? null
      : s
          .slice(sep + 1)
          .replace(/\D/g, '')
          .slice(0, o.casas)
  return montar(neg, int, dec)
}

/** Exibição com ponto de milhar; `casasMin` completa as casas com zero (valor em reais). */
export function agrupar(canonico: string, casasMin = 0): string {
  if (canonico === '' || canonico === '-') return canonico
  const neg = canonico.startsWith('-')
  const corpo = neg ? canonico.slice(1) : canonico
  const sep = corpo.indexOf(',')
  const int = sep < 0 ? corpo : corpo.slice(0, sep)
  let dec = sep < 0 ? null : corpo.slice(sep + 1)
  if (casasMin > 0) dec = (dec ?? '').padEnd(casasMin, '0')
  const grupos = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '-' : ''}${grupos}${dec === null ? '' : `,${dec}`}`
}

/** Tira o que só serve durante a digitação: vírgula final e sinal solto. */
export function limparCanonico(canonico: string): string {
  const c = canonico.replace(/,$/, '')
  return c === '-' ? '' : c
}

function reduzido(canonico: string): string {
  let c = limparCanonico(canonico)
  if (c.includes(',')) c = c.replace(/0+$/, '').replace(/,$/, '')
  return c === '-0' ? '0' : c
}

/** Dois textos canônicos valem o mesmo número ("7," = "7" = "7,0")? Vazio só é igual a vazio. */
export function mesmoNumero(a: string, b: string): boolean {
  return reduzido(a) === reduzido(b)
}

/** Número (do banco ou calculado) no texto do campo: "1234,5". Vazio quando não há valor. */
export function numeroParaCampo(v: number | string | null | undefined, casas = 10): string {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return ''
  const fixo = n.toFixed(Math.min(Math.max(casas, 0), 20))
  const limpo = fixo.includes('.') ? fixo.replace(/0+$/, '').replace(/\.$/, '') : fixo
  return (limpo === '-0' ? '0' : limpo).replace('.', ',')
}

// ── máscaras de texto ────────────────────────────────────────────────────────

/** Telefone com DDD: "(64) 99999-8888" ou "(64) 3333-4444". */
export function mascaraTelefone(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length < 3) return `(${d}`
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`
  const corte = resto.length - 4
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** CNPJ "00.000.000/0000-00"; aceita letra nas 12 primeiras posições (formato alfanumérico de 2026). */
export function mascaraCnpj(texto: string): string {
  const bruto = texto.toUpperCase().replace(/[^A-Z0-9]/g, '')
  let c = ''
  for (const ch of bruto) {
    if (c.length >= 14) break
    if (c.length >= 12 && !/\d/.test(ch)) continue
    c += ch
  }
  let out = c.slice(0, 2)
  if (c.length > 2) out += `.${c.slice(2, 5)}`
  if (c.length > 5) out += `.${c.slice(5, 8)}`
  if (c.length > 8) out += `/${c.slice(8, 12)}`
  if (c.length > 12) out += `-${c.slice(12, 14)}`
  return out
}

/** CPF "000.000.000-00". */
export function mascaraCpf(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 11)
  let out = d.slice(0, 3)
  if (d.length > 3) out += `.${d.slice(3, 6)}`
  if (d.length > 6) out += `.${d.slice(6, 9)}`
  if (d.length > 9) out += `-${d.slice(9, 11)}`
  return out
}

/** Placa em maiúsculas, só letras, algarismos e hífen ("ABC1D23", "ABC-1234"). */
export function mascaraPlaca(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 8)
}

// ── cursor ───────────────────────────────────────────────────────────────────

/** Quantos caracteres que contam (algarismo, vírgula, sinal, letra) existem antes da posição `ate`. */
export function contarSignificativos(
  texto: string,
  ate: number,
  conta: (c: string) => boolean
): number {
  let n = 0
  for (let i = 0; i < Math.min(ate, texto.length); i++) if (conta(texto[i])) n++
  return n
}

/** Posição do cursor logo depois do n-ésimo caractere que conta. */
export function posicaoApos(texto: string, n: number, conta: (c: string) => boolean): number {
  if (n <= 0) return 0
  let vistos = 0
  for (let i = 0; i < texto.length; i++) {
    if (conta(texto[i])) vistos++
    if (vistos === n) return i + 1
  }
  return texto.length
}
