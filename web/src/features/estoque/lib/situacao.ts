// A situação do estoque para a cor na tela (mapa, lista e ficha). O banco diz o status; aqui entra a faixa de
// atenção, que é só de exibição: saldo ainda acima do mínimo, mas a até 20% dele.

import type { AtivoEstoque, StatusEstoque } from '../tipos'

export type SituacaoEstoque = StatusEstoque | 'atencao'

/** Quanto acima do mínimo ainda pede atenção (0,2 = até 20% acima). */
export const FOLGA_DE_ATENCAO = 0.2

/**
 * Vermelho no mínimo ou abaixo dele (`baixo`, `zerado`, `negativo`), amarelo até 20% acima do mínimo (`atencao`) e
 * verde daí para cima. Sem mínimo cadastrado não há faixa de atenção.
 */
export function situacaoDoEstoque(
  a: Pick<AtivoEstoque, 'status' | 'saldo' | 'estoque_minimo'>
): SituacaoEstoque {
  if (
    a.status === 'normal' &&
    a.saldo != null &&
    a.estoque_minimo > 0 &&
    a.saldo <= a.estoque_minimo * (1 + FOLGA_DE_ATENCAO)
  )
    return 'atencao'
  return a.status
}
