/**
 * Normalização de unidades para comparação semântica.
 *
 * SIGA registra "m2"/"M2"/"m²" como m², "T"/"Ton"/"Toneladas" como toneladas,
 * etc. O orçamento pode usar variações diferentes. A heurística aqui agrupa
 * variações conhecidas em uma forma canônica e expõe `equivalentes(a, b)`.
 */

/** Canonicaliza uma string de unidade. Retorna '' se entrada inválida. */
export function normalizarUnidade(s: string | null | undefined): string {
  if (!s) return ''
  // base: lowercase, sem acentos, sem espaços / pontos / hifens
  const base = String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s.\-_/]/g, '')
    // expoentes Unicode → ASCII
    .replace(/[²]/g, '2')
    .replace(/[³]/g, '3')
    // m^2 → m2
    .replace(/\^/g, '')
    // remove ponto-no-fim
    .replace(/\.+$/, '')

  // Mapeamentos por palavra inteira (com sinônimos/abreviações)
  // Ordem importa: testa mais específicos primeiro.
  const buckets: Array<{ canonical: string; aliases: RegExp[] }> = [
    // Compostos primeiro
    { canonical: 'm2xdia',  aliases: [/^m2xdia$/, /^m2dia$/, /^m2pordia$/] },
    { canonical: 'm3xkm',   aliases: [/^m3xkm$/, /^m3km$/] },
    { canonical: 'txkm',    aliases: [/^txkm$/, /^tkm$/, /^toneladaxkm$/, /^toneladaskm$/] },
    // Volume
    { canonical: 'm3',      aliases: [/^m3$/, /^metroscubicos$/, /^metrocubico$/, /^mcubico$/, /^mc$/] },
    // Área
    { canonical: 'm2',      aliases: [/^m2$/, /^metrosquadrados$/, /^metroquadrado$/, /^mquadrado$/, /^mq$/] },
    { canonical: 'km2',     aliases: [/^km2$/, /^kmquadrado$/, /^quilometroquadrado$/, /^quilometrosquadrados$/] },
    { canonical: 'ha',      aliases: [/^ha$/, /^hectare$/, /^hectares$/] },
    // Comprimento
    { canonical: 'km',      aliases: [/^km$/, /^quilometro$/, /^quilometros$/, /^kilometro$/, /^kilometros$/] },
    { canonical: 'm',       aliases: [/^m$/, /^mt$/, /^metro$/, /^metros$/, /^mlinear$/, /^ml$/] },
    { canonical: 'cm',      aliases: [/^cm$/, /^centimetro$/, /^centimetros$/] },
    { canonical: 'mm',      aliases: [/^mm$/, /^milimetro$/, /^milimetros$/] },
    // Massa
    { canonical: 't',       aliases: [/^t$/, /^ton$/, /^tons$/, /^tonelada$/, /^toneladas$/, /^tonelada(s)?metrica$/] },
    { canonical: 'kg',      aliases: [/^kg$/, /^quilo$/, /^quilos$/, /^quilograma$/, /^quilogramas$/] },
    { canonical: 'g',       aliases: [/^g$/, /^grama$/, /^gramas$/] },
    // Volume liquido
    { canonical: 'l',       aliases: [/^l$/, /^lt$/, /^litro$/, /^litros$/] },
    { canonical: 'ml',      aliases: [/^ml$/, /^mililitro$/, /^mililitros$/] },
    // Tempo
    { canonical: 'h',       aliases: [/^h$/, /^hr$/, /^hs$/, /^hora$/, /^horas$/] },
    { canonical: 'dia',     aliases: [/^d$/, /^dia$/, /^dias$/] },
    { canonical: 'mes',     aliases: [/^mes$/, /^meses$/] },
    // Unitários
    { canonical: 'un',      aliases: [/^un$/, /^und$/, /^unid$/, /^unidade$/, /^unidades$/, /^pc$/, /^pcs$/, /^peca$/, /^pecas$/, /^p$/] },
    { canonical: 'verba',   aliases: [/^vb$/, /^verba$/] },
    { canonical: '%',       aliases: [/^%$/, /^perc$/, /^percentual$/, /^porcento$/, /^porcent$/] }
  ]

  for (const b of buckets) {
    for (const re of b.aliases) {
      if (re.test(base)) return b.canonical
    }
  }
  // Não conhecida → devolve a forma base normalizada (lower, sem espaços)
  return base
}

/** True quando duas strings de unidade representam a mesma grandeza. */
export function unidadesEquivalentes(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return normalizarUnidade(a) === normalizarUnidade(b)
}

/** Devolve uma string "humana" da unidade canônica (com ² ³ etc.) para exibição. */
export function exibirUnidade(s: string | null | undefined): string {
  const c = normalizarUnidade(s)
  switch (c) {
    case 'm2': return 'm²'
    case 'm3': return 'm³'
    case 'km2': return 'km²'
    case 'm2xdia': return 'm²/dia'
    case 'm3xkm': return 'm³·km'
    case 'txkm': return 't·km'
    case 't': return 't'
    default:
      return s ? String(s) : ''
  }
}
