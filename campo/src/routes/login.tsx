import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { useAuth } from '@/features/auth/useAuth'
import { useIsAuthenticated, useSession, useTokenValid } from '@/core/auth/SessionStore'

/**
 * Tela de login com tratamento hero — ícone grande, wordmark, glow radial sutil
 * de fundo. Sente como "ferramenta de campo séria", não como bookmark.
 *
 * Composição:
 *  - Topo (~40% da viewport): área de marca com glow radial e logo
 *  - Centro: card com form (h-12 inputs e botão pra alvo de toque generoso)
 *  - Login: o mesmo usuário do InfraWork Web (e-mail e senha)
 */
export function LoginRoute() {
  const authed = useIsAuthenticated()
  const tokenValid = useTokenValid()
  const session = useSession()
  const navigate = useNavigate()
  const { login, loading, error } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')

  // Sessão + token válido → nada a fazer aqui. Sessão com token vencido fica:
  // é o modo "entrar de novo" (os dados locais continuam no aparelho).
  if (authed && tokenValid) return <Navigate to="/" replace />
  const reauth = authed && !tokenValid

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void login(email.trim(), senha)
  }

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-bg-base">
      {/* Glow radial — ecoa o efeito do icon-source.png. Posicionado mais pra cima
          pra criar foco visual na marca sem competir com o card de form. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          background: 'radial-gradient(ellipse at top, rgba(77,142,255,0.22) 0%, transparent 60%)',
        }}
      />

      {/* Hero — só o ícone glowing centralizado, sem wordmark embutido */}
      <header className="relative flex flex-col items-center px-6 pb-8 pt-12 pt-safe-plus-3">
        <img src="/icon-288.webp" alt="InfraWork" decoding="async" className="h-36 w-36" />
        <p className="mt-4 text-base font-medium tracking-wide text-on-surface">
          InfraWork
          <span className="text-on-surface-dim"> · Campo</span>
        </p>
      </header>

      {/* Form */}
      <section className="relative flex flex-1 items-start justify-center px-6">
        <div className="w-full max-w-sm">
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-lg border border-border-strong bg-bg-panel p-6 shadow-xl shadow-black/30"
          >
            {reauth && (
              <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs text-on-surface">
                <span className="font-semibold">
                  Sessão expirada{session?.userNome ? ` · ${session.userNome}` : ''}.
                </span>{' '}
                Entre de novo para enviar os lançamentos. Nada foi apagado deste aparelho.
              </div>
            )}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-dim"
              >
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="voce@empresa.com.br"
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="senha"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-dim"
              >
                Senha
              </label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
                className="h-12"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              variant="primary"
              disabled={loading || !email || !senha}
              className="group h-12 w-full"
            >
              <span>{loading ? 'Entrando…' : 'Entrar'}</span>
              {!loading && (
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              )}
            </Button>
            {reauth && (
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="h-11 w-full"
                onClick={() => navigate('/', { replace: true })}
              >
                Continuar sem internet
              </Button>
            )}
          </form>
        </div>
      </section>

      <div className="pb-6 pb-safe" />
    </main>
  )
}
