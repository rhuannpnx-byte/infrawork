/** Datas do apontamento: o dia é o do aparelho (fuso local), como no lançamento do web. */
export function hojeLocal(quando: Date = new Date()): string {
  const y = quando.getFullYear()
  const m = String(quando.getMonth() + 1).padStart(2, '0')
  const d = String(quando.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function ontemLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return hojeLocal(d)
}

export function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function formatNumero(n: number, casas = 3): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas })
}
