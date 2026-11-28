// A estaca no SIGA é texto livre ("KM INICIAL 45+390 > KM FINAL 46+429", "ESTACA INICIAL 38+800 > ..."). Aqui o
// texto vira a faixa do lançamento em metros internos do eixo, quando dá para ler; quando não dá, a produção
// entra sem posição e o texto original fica guardado. Sem dependências: o web testa este arquivo.

export interface EixoDoLocal {
  unidade: 'km' | 'm' | 'estaca' | 'custom'
  /** valor do marcador no início do eixo (km 164, estaca 0…) */
  marcador_inicial: number
  sentido: 'natural' | 'invertido'
}

const METROS_POR_ESTACA = 20

/**
 * As posições "N+M" do texto, em unidades do marcador. No eixo em km, 45+390 é o km 45,390; no eixo em estacas,
 * 12+10 é a estaca 12,5. Texto de eixo em estacas escrito como km+metro (o "+M" passa de 20) não é adivinhado.
 */
export function marcadoresDoTexto(texto: string | null | undefined, unidade: EixoDoLocal['unidade']): number[] {
  if (!texto || (unidade !== 'km' && unidade !== 'estaca')) return []
  const out: number[] = []
  for (const m of texto.matchAll(/(\d{1,5})\s*\+\s*(\d{1,3}(?:[.,]\d+)?)/g)) {
    const inteiro = Number(m[1])
    const resto = Number(m[2].replace(',', '.'))
    if (unidade === 'km') {
      if (resto >= 1000) return []
      out.push(inteiro + resto / 1000)
    } else {
      if (resto >= METROS_POR_ESTACA) return []
      out.push(inteiro + resto / METROS_POR_ESTACA)
    }
  }
  return out
}

/** Marcador (km ou estaca) → metros internos a partir do início do eixo. Mesma conta de `marcadorToMetros` do web. */
export function marcadorParaMetros(marcador: number, eixo: EixoDoLocal): number {
  const divisor = eixo.unidade === 'km' ? 1000 : METROS_POR_ESTACA
  const delta = eixo.sentido === 'invertido' ? eixo.marcador_inicial - marcador : marcador - eixo.marcador_inicial
  return Math.round(delta * divisor * 100) / 100
}

/**
 * A faixa do lançamento, em metros internos. Usa os campos separados (inicial e final) quando os dois têm
 * posição; senão o texto livre. Precisa de pelo menos duas posições; com mais de duas (dois sentidos no mesmo
 * texto), vale da menor à maior.
 */
export function faixaDaEstaca(
  campos: { estaca?: string | null; inicial?: string | null; final?: string | null },
  eixo: EixoDoLocal
): { inicio_m: number; fim_m: number } | null {
  const ini = marcadoresDoTexto(campos.inicial, eixo.unidade)
  const fim = marcadoresDoTexto(campos.final, eixo.unidade)
  const marcadores =
    ini.length > 0 && fim.length > 0 ? [...ini, ...fim] : marcadoresDoTexto(campos.estaca, eixo.unidade)
  if (marcadores.length < 2) return null
  const metros = marcadores.map((m) => marcadorParaMetros(m, eixo))
  return { inicio_m: Math.min(...metros), fim_m: Math.max(...metros) }
}

/**
 * Metros internos do eixo → texto do marcador como se digita no SIGA ("45+390" no eixo em km, "12+10,00" no eixo
 * em estacas). É o inverso de `marcadorParaMetros`; em eixo de outra unidade devolve null (fica o texto digitado).
 */
export function metrosParaTextoDoMarcador(metros: number, eixo: EixoDoLocal): string | null {
  if (eixo.unidade !== 'km' && eixo.unidade !== 'estaca') return null
  const divisor = eixo.unidade === 'km' ? 1000 : METROS_POR_ESTACA
  // posição absoluta em metros desde o marcador zero
  const absoluto =
    eixo.sentido === 'invertido' ? eixo.marcador_inicial * divisor - metros : eixo.marcador_inicial * divisor + metros
  if (!Number.isFinite(absoluto) || absoluto < 0) return null
  if (eixo.unidade === 'km') {
    const total = Math.round(absoluto)
    return `${Math.floor(total / 1000)}+${String(total % 1000).padStart(3, '0')}`
  }
  const centesimos = Math.round(absoluto * 100)
  const inteiro = Math.floor(centesimos / (METROS_POR_ESTACA * 100))
  const resto = (centesimos - inteiro * METROS_POR_ESTACA * 100) / 100
  return `${inteiro}+${resto.toFixed(2).replace('.', ',')}`
}
