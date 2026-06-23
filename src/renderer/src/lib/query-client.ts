import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Erro desconhecido'
  }
}

/**
 * QueryClient singleton de módulo. É o mesmo cliente usado pelo
 * <QueryClientProvider> em Providers.tsx — exportá-lo aqui permite que serviços
 * fora da árvore React (ex.: a fila de ingestão em segundo plano) invalidem
 * queries sem precisar de um hook.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  },
  // Mutation falhada sem .onError local nao some no console: vira toast
  // tecnico (PRODUCT.md: "Mensagens vao ao ponto").
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      // Quando a mutation define seu proprio onError, deixa ele assumir.
      if (mutation.options.onError) return
      console.error('[mutation]', err)
      toast.error(`Falha: ${describeError(err)}`)
    }
  }),
  // Erros de fetch (query) que escaparam de .onError tambem aparecem.
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (query.options.meta?.silent) return
      console.error('[query]', err)
    }
  })
})
