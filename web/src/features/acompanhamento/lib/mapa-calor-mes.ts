// Mês de calendário do mapa de calor da produção: um mês por tela, em vez de uma janela de 30 dias que juntava
// dois meses na mesma grade. A mesma regra do app de campo (campo/src/features/painel/periodo.ts).

/** Meses ("AAAA-MM") que aparecem nos dias do período, do mais antigo ao mais recente. */
export function mesesDosDias(dias: string[]): string[] {
  const vistos = new Set<string>()
  for (const d of dias) vistos.add(d.slice(0, 7))
  return [...vistos].sort()
}

/** Todos os dias do mês de calendário ("AAAA-MM"), em ordem. */
export function diasDoMes(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
]

/** "novembro de 2026". */
export function nomeDoMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MESES[m - 1]} de ${y}`
}
