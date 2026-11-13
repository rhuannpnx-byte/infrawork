/** "1 viagem", "3 viagens": número e substantivo no plural certo (nada de "viagem(ns)"). */
export const contar = (n: number, singular: string, plural: string): string =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural}`

/** Só a palavra, sem o número: `plural(n, 'salva', 'salvas')`. */
export const plural = (n: number, singular: string, variosTexto: string): string =>
  n === 1 ? singular : variosTexto

/** "a", "a e b", "a, b e c". */
export const listar = (itens: string[]): string =>
  itens.length <= 1
    ? (itens[0] ?? '')
    : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
