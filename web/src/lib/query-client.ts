import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AVISO_ERRO_MS } from '@/lib/avisos'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

function describeError(err: unknown): string {
  if (typeof err === 'string') return err
  // o erro do Supabase é um objeto comum ({ message, code }), não um `Error`
  return detalheDoErro(err) ?? (err instanceof Error ? err.name : '')
}

/** A tela já mostrou o erro dentro do diálogo aberto (faixa de erro ou mensagem no campo)? */
function erroNoDialogo(): boolean {
  return !!document.querySelector(
    '[role="dialog"] [role="alert"], [role="alertdialog"] [role="alert"]'
  )
}

// Marca a hora de cada aviso de erro mostrado por qualquer tela, para o aviso global saber se já houve um.
let ultimoAvisoDeErro = 0
const avisarErro = toast.error
toast.error = ((...args: Parameters<typeof avisarErro>) => {
  ultimoAvisoDeErro = performance.now()
  return avisarErro(...args)
}) as typeof toast.error

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
      retry: 2
    }
  },
  // Gravação que falha e que a tela não tratou não some em silêncio: vira aviso. Quando a tela avisa por conta
  // própria (aviso dela ou erro mostrado no diálogo), o aviso daqui não aparece, para não sair em dobro.
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return
      console.error('[mutation]', err)
      const quando = performance.now()
      setTimeout(() => {
        if (ultimoAvisoDeErro >= quando || erroNoDialogo()) return
        avisarErro(`Não foi possível concluir a gravação. ${describeError(err)}`.trim(), {
          duration: AVISO_ERRO_MS
        })
      }, 80)
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
