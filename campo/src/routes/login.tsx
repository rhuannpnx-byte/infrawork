import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { useAuth } from '@/features/auth/useAuth'
import { useIsAuthenticated, useSession, useTokenValid } from '@/core/auth/SessionStore'
import { SeletorTema } from '@/features/common/SeletorTema'

/**
 * Tela de entrada: a marca no topo, a folha com o formulário (campos e botão de 48 px) e a escolha do tema.
 * O usuário é o mesmo do InfraWork Web (e-mail e senha).
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
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="flex flex-col items-center px-6 pb-6 pt-10 pt-safe-plus-3">
        <img src="/icon-288.webp" alt="" decoding="async" className="h-28 w-28" />
        <h1 className="mt-2 text-xl font-semibold text-on-surface">InfraWork Campo</h1>
        <p className="mt-1 text-center text-sm text-on-surface-dim">
          Produção, viagens e fotos, mesmo sem sinal
        </p>
      </header>

      <section className="flex flex-1 items-start justify-center px-4">
        <div className="w-full max-w-sm">
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-md border border-border bg-bg-panel p-5"
          >
            {reauth && (
              <div className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2.5 text-sm text-on-surface">
                <span className="font-semibold">
                  Sessão expirada{session?.userNome ? ` · ${session.userNome}` : ''}.
                </span>{' '}
                Entre de novo para enviar os lançamentos. Nada foi apagado deste aparelho.
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="email" className="rotulo block">
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

            <div className="space-y-1.5">
              <label htmlFor="senha" className="rotulo block">
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
                className="h-12"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2.5 text-sm text-bad"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              variant="primary"
              disabled={loading || !email || !senha}
              className="group w-full"
            >
              <span>{loading ? 'Entrando…' : 'Entrar'}</span>
              {!loading && (
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              )}
            </Button>
            {reauth && (
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="w-full"
                onClick={() => navigate('/', { replace: true })}
              >
                Continuar sem internet
              </Button>
            )}
          </form>

          <SeletorTema className="mt-6" />
        </div>
      </section>

      <div className="pb-6 pb-safe" />
    </main>
  )
}
