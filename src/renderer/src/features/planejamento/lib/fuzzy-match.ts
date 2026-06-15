// Similaridade fuzzy de nomes — porta client-side do algoritmo usado no
// matching SIGA (acompanhamento-matching-sugerir). Usada para sugerir o
// item_orcamentario de uma tarefa importada do MS Project a partir do nome.

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'e', 'em', 'para', 'com',
  'servico', 'serviço', 'tarefa', 'item'
])

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/** 0..1 — quão parecidos são dois nomes. 1 = idênticos (normalizados). */
export function similarity(a: string, b: string): number {
  const n1 = normalize(a)
  const n2 = normalize(b)
  if (!n1 || !n2) return 0
  if (n1 === n2) return 1

  const t1 = tokens(a)
  const t2 = tokens(b)
  if (t1.length && t2.length) {
    const set2 = new Set(t2)
    let hits = 0
    for (const t of t1) if (set2.has(t)) hits++
    const tokenScore = hits / Math.min(t1.length, t2.length)
    if (tokenScore >= 1) return 0.95
    if (tokenScore >= 0.5) return Math.min(0.92, 0.65 + tokenScore * 0.25)
  }

  const bg1 = new Set<string>()
  for (let i = 0; i < n1.length - 1; i++) bg1.add(n1.slice(i, i + 2))
  const bg2 = new Set<string>()
  for (let i = 0; i < n2.length - 1; i++) bg2.add(n2.slice(i, i + 2))
  let inter = 0
  for (const bg of bg1) if (bg2.has(bg)) inter++
  const dice = !bg1.size || !bg2.size ? 0 : (2 * inter) / (bg1.size + bg2.size)

  let sub = 0
  if (n1.length >= 3 && n2.includes(n1)) sub = 0.3
  else if (n2.length >= 3 && n1.includes(n2)) sub = 0.3

  let pref = 0
  for (let i = 0; i < Math.min(4, n1.length, n2.length); i++) {
    if (n1[i] === n2[i]) pref++
    else break
  }
  return Math.min(1, dice + pref * 0.05 + sub)
}

/**
 * Melhor candidato (id) entre `opcoes` para o nome `alvo`, acima de `minConf`.
 * Retorna { id, confianca } ou null.
 */
export function melhorCandidato(
  alvo: string,
  opcoes: Array<{ id: string; nome: string }>,
  minConf = 0.6
): { id: string; confianca: number } | null {
  let best: { id: string; confianca: number } | null = null
  for (const o of opcoes) {
    const c = similarity(alvo, o.nome)
    if (c >= minConf && (!best || c > best.confianca)) best = { id: o.id, confianca: c }
  }
  return best
}
