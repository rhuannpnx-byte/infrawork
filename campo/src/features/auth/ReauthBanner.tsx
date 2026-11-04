import { useLocation, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { useIsAuthenticated, useTokenRecusado } from '@/core/auth/SessionStore'

/**
 * Faixa no topo quando o servidor recusou o token (401) mas a sessão local continua. Vencer pelo relógio estando
 * offline não mostra a faixa: o Supabase renova o token sozinho quando a rede volta.
 *
 * O app é offline-first: token vencido NÃO derruba o operador para o login —
 * no campo, sem sinal, ele não conseguiria entrar de novo e perderia o acesso
 * aos catálogos e aos rascunhos. Ele continua lançando (tudo fica no outbox) e
 * só precisa entrar de novo, quando tiver rede, para os envios saírem.
 */
export function ReauthBanner() {
  const authed = useIsAuthenticated()
  const recusado = useTokenRecusado()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (!authed || !recusado || pathname === '/login') return null

  return (
    <div className="sticky top-0 z-40 border-b border-warn/40 bg-bg-elevated">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2 text-xs">
        <KeyRound className="h-4 w-4 shrink-0 text-warn" aria-hidden />
        <p className="min-w-0 flex-1 text-on-surface">
          <span className="font-semibold">Sessão expirada.</span>{' '}
          <span className="text-on-surface-dim">
            Continue lançando; entre de novo com internet para enviar.
          </span>
        </p>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="h-8 shrink-0 rounded-md bg-warn px-3 font-semibold text-black"
        >
          Entrar
        </button>
      </div>
    </div>
  )
}
