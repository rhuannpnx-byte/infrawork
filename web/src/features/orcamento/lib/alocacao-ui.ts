import { toast } from 'sonner'
import { contar } from '@/lib/rotulos'

/** Tipo de dado arrastado da planilha para o painel de serviços (ids de receitas). */
export const DRAG_RECEITAS = 'application/x-infrawork-receitas'

/** Toast do resultado de "alocar receitas". */
export function avisarAlocacao(alocadas: number, avisos: string[]): void {
  if (alocadas > 0) toast.success(`${contar(alocadas, 'receita alocada', 'receitas alocadas')}.`)
  if (avisos.length > 0) toast.warning(avisos.join(' · '))
}
