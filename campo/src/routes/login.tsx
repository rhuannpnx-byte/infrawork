import { useEffect, useRef, useState, type FormEvent } from 'react'
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
  // entrar de novo (sessão expirada): o e-mail de quem estava no aparelho já vem preenchido
  const [email, setEmail] = useState(() => session?.userEmail ?? '')
  const [senha, setSenha] = useState('')
  // erro de cada campo, depois da primeira tentativa de entrar
  const [erros, setErros] = useState<{ email?: string; senha?: string }>({})
  const emailRef = useRef<HTMLInputElement>(null)
  const senhaRef = useRef<HTMLInputElement>(null)

  // o servidor recusou (senha errada, sem rede): o foco volta para a senha, que é o que se redigita
  const tentou = useRef(false)
  useEffect(() => {
    if (!loading && error && tentou.current) senhaRef.current?.focus()
  }, [loading, error])

  // Sessão + token válido → nada a fazer aqui. Sessão com token vencido fica:
  // é o modo "entrar de novo" (os dados locais continuam no aparelho).
  if (authed && tokenValid) return <Navigate to="/" replace />
  const reauth = authed && !tokenValid

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const novos: { email?: string; senha?: string } = {}
    const endereco = email.trim()
    if (!endereco) novos.email = 'Informe o e-mail.'
    else if (!/^\S+@\S+\.\S+$/.test(endereco))
      novos.email = 'E-mail incompleto: confira o endereço.'
    if (!senha) novos.senha = 'Informe a senha.'
    setErros(novos)
    if (novos.email) return emailRef.current?.focus()
    if (novos.senha) return senhaRef.current?.focus()
    tentou.current = true
    void login(endereco, senha)
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
            noValidate
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
                ref={emailRef}
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (erros.email) setErros((x) => ({ ...x, email: undefined }))
                }}
                readOnly={loading}
                placeholder="voce@empresa.com.br"
                aria-invalid={erros.email ? true : undefined}
                aria-describedby={erros.email ? 'email-erro' : undefined}
                className={erros.email ? 'h-12 border-bad focus-visible:border-bad' : 'h-12'}
              />
              {erros.email && (
                <p id="email-erro" role="alert" className="text-xs text-bad">
                  {erros.email}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="senha" className="rotulo block">
                Senha
              </label>
              <Input
                ref={senhaRef}
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => {
                  setSenha(e.target.value)
                  if (erros.senha) setErros((x) => ({ ...x, senha: undefined }))
                }}
                readOnly={loading}
                aria-invalid={erros.senha ? true : undefined}
                aria-describedby={erros.senha ? 'senha-erro' : undefined}
                className={erros.senha ? 'h-12 border-bad focus-visible:border-bad' : 'h-12'}
              />
              {erros.senha && (
                <p id="senha-erro" role="alert" className="text-xs text-bad">
                  {erros.senha}
                </p>
              )}
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
              disabled={loading}
              className="group w-full"
            >
              <span>{loading ? 'Entrando…' : 'Entrar'}</span>
              {!loading && (
                <ArrowRight
                  className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
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
