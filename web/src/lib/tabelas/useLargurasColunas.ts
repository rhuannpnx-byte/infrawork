import { useCallback, useState } from 'react'
import { LARGURA_MINIMA, gravarLarguras, lerLarguras } from './colunas-ajustaveis'

/**
 * Larguras das colunas de uma grade que não é `<table>` (as tabelas comuns já ganham o ajuste sozinhas, em
 * `lib/tabelas/colunas-ajustaveis`). Guarda no navegador, no mesmo lugar das tabelas.
 */
export function useLargurasColunas<K extends string>(
  chave: string,
  padrao: Record<K, number>
): {
  larguras: Record<K, number>
  /** `final` grava no navegador (no fim do arraste ou a cada tecla). */
  definir: (coluna: K, largura: number, final: boolean) => void
  restaurar: () => void
} {
  const ordem = Object.keys(padrao) as K[]
  const [larguras, setLarguras] = useState<Record<K, number>>(() => {
    const guardadas = lerLarguras(chave)
    if (!guardadas || guardadas.length !== ordem.length) return padrao
    return Object.fromEntries(ordem.map((k, i) => [k, guardadas[i]])) as Record<K, number>
  })
  const definir = useCallback(
    (coluna: K, largura: number, final: boolean) => {
      setLarguras((atual) => {
        const novas = { ...atual, [coluna]: Math.max(LARGURA_MINIMA, Math.round(largura)) }
        if (final)
          gravarLarguras(
            chave,
            ordem.map((k) => novas[k])
          )
        return novas
      })
    },
    // a ordem vem do padrão, que é constante na tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave]
  )
  const restaurar = useCallback(() => {
    gravarLarguras(chave, null)
    setLarguras(padrao)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  return { larguras, definir, restaurar }
}
