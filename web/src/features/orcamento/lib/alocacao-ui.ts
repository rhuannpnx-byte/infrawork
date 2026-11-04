import { toast } from 'sonner'

/** Tipo de dado arrastado da planilha para o painel de serviços (ids de receitas). */
export const DRAG_RECEITAS = 'application/x-infrawork-receitas'

/** Toast do resultado de "alocar receitas". */
export function avisarAlocacao(alocadas: number, avisos: string[]): void {
  if (alocadas > 0) toast.success(`${alocadas} receita(s) alocada(s).`)
  if (avisos.length > 0) toast.warning(avisos.join(' · '))
}
