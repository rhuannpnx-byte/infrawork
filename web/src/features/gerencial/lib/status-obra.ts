export const STATUS_OBRA: Array<{ value: string; label: string }> = [
  { value: 'planejamento', label: 'Planejamento' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'paralisado', label: 'Paralisada' },
  { value: 'concluido', label: 'Concluída' }
]

export const rotuloStatusObra = (s: string | null | undefined): string =>
  STATUS_OBRA.find((x) => x.value === s)?.label ?? s ?? '—'
