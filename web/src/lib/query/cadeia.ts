import type { QueryClient } from '@tanstack/react-query'

/**
 * A cadeia recurso → composição → serviço → orçamento → plano em edição é
 * recalculada no banco (ao vivo, no fim de cada transação). Qualquer escrita
 * nela pode mudar valores em várias telas: invalida orçamento e planejamento.
 */
export function invalidarCadeia(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['orcamento'] })
  void qc.invalidateQueries({ queryKey: ['planejamento'] })
}
