import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { SUPABASE_ENABLED } from '@/lib/supabase/client'
import infraworkWordmark from '@/assets/infrawork-wordmark.png'
import loginCover from '@/assets/login-cover.png'
import { LoginWallpaper } from './LoginWallpaper'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Traduz o erro do Supabase (AuthApiError expõe `.code`/`.status`) para PT-BR. */
function mapAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string; name?: string; status?: number }
  const code = e?.code
  const message = e?.message ?? ''
  const name = e?.name ?? ''

  if (code === 'invalid_credentials') return 'Email ou senha incorretos.'
  if (code === 'email_not_confirmed')
    return 'Email ainda não confirmado. Verifique sua caixa de entrada.'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit')
    return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.'
  if (code === 'user_banned') return 'Conta suspensa. Contate o administrador.'

  // Falha de rede (sem code; fetch/network; AuthRetryableFetchError)
  if (name === 'AuthRetryableFetchError' || /failed to fetch|network|fetch/i.test(message))
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.'

  // Erro do /me (lançado em auth-store: "/me retornou NNN" ou "/me retornou vazio")
  if (/^\/me retornou/i.test(message))
    return 'Não foi possível carregar seu perfil. Contate o suporte.'

  // Fallback por mensagem conhecida do Supabase, caso o code venha ausente
  if (/invalid login credentials/i.test(message)) return 'Email ou senha incorretos.'

  return 'Não foi possível entrar. Tente novamente.'
}

export function LoginPage(): ReactNode {
  const navigate = useNavigate()
  const signIn = useAuthStore((s) => s.signInWithPassword)
  const status = useAuthStore((s) => s.status)

  const passwordRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [loading, setLoading] = useState(false)

  const [authError, setAuthError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  if (!SUPABASE_ENABLED) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg text-text">
        <div className="max-w-md text-center p-6 border border-warn/30 bg-warn/10 rounded">
          <AlertTriangle size={20} className="text-warn mx-auto mb-2" />
          <div className="text-sm font-medium mb-1">Supabase desativado</div>
          <div className="text-xs text-text-muted">
            Defina <code className="font-mono">VITE_USE_SUPABASE=true</code> e as credenciais para
            usar a tela de login.
          </div>
        </div>
      </div>
    )
  }

  const validate = (): boolean => {
    let ok = true
    const trimmed = email.trim()
    if (!trimmed) {
      setEmailError('Informe seu email.')
      ok = false
    } else if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Email inválido.')
      ok = false
    }
    if (!password) {
      setPasswordError('Informe sua senha.')
      ok = false
    }
    return ok
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setAuthError(null)
    setEmailError(null)
    setPasswordError(null)
    if (!validate()) return

    setLoading(true)
    try {
      await signIn(email.trim(), password)
      navigate({ to: '/' })
    } catch (err) {
      setAuthError(mapAuthError(err))
      // Mantém o email, limpa a senha e refoca para nova tentativa.
      setPassword('')
      passwordRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false)
  }

  const busy = loading || status === 'loading'

  return (
    <div className="h-screen w-screen bg-bg grid lg:grid-cols-[1.05fr_1fr]">
      {/* ============================================================
       * PAINEL DE IMAGEM / MARCA — esquerda (escondido em janela estreita)
       * ============================================================ */}
      <aside className="relative hidden overflow-hidden bg-bg lg:block">
        {/* Fallback CSS auto-suficiente: gradiente escuro azulado + grade técnica sutil.
         * Fica profissional mesmo antes da foto chegar. */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_20%_0%,var(--accent-glow),transparent_55%),linear-gradient(160deg,var(--bg-elevated),var(--bg)_70%)]" />
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)',
            backgroundSize: '22px 22px'
          }}
        />

        {/* Foto de capa (aérea noturna de rodovia) por cima do fallback */}
        <img
          src={loginCover}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />

        {/* Overlay de legibilidade (bottom→top) para o wordmark sobre a foto */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Marca ancorada no canto inferior-esquerdo */}
        <div className="absolute bottom-0 left-0 p-10">
          <div className="h-px w-12 bg-[var(--accent-line)]" />
          <img
            src={infraworkWordmark}
            alt="InfraWork"
            className="mt-5 w-[220px] h-auto select-none drop-shadow-[0_0_28px_rgba(56,139,253,0.4)]"
            draggable={false}
          />
          <div className="mt-3 text-2xs font-mono uppercase tracking-[0.25em] text-text-muted">
            Engenharia · Planejamento · Acompanhamento
          </div>
        </div>
      </aside>

      {/* ============================================================
       * PAINEL DO FORMULÁRIO — direita
       * ============================================================ */}
      <main className="relative flex flex-col overflow-hidden bg-bg px-6 py-8">
        {/* ============================================================
         * WALLPAPER INTERATIVO "Vetor" — mapa dark + HUD técnico, atrás do
         * formulário. As camadas do HUD são pointer-events:none, então o
         * arraste chega ao mapa; o card (z-10) captura os eventos do form.
         * ============================================================ */}
        <div id="login-fx" aria-hidden className="absolute inset-0 z-0 overflow-hidden">
          <LoginWallpaper />
        </div>

        <div className="pointer-events-none relative z-10 flex flex-1 items-center justify-center">
          <form
            onSubmit={onSubmit}
            noValidate
            className="pointer-events-auto w-[340px] rounded-lg border border-border-strong bg-[oklch(15%_0.008_255_/_0.82)] p-8 shadow-2xl backdrop-blur-md"
          >
            <div className="mb-6">
              <div className="text-lg font-semibold text-text">Acesso ao sistema</div>
              <div className="mt-0.5 text-2xs text-text-dim font-mono">
                Entre com suas credenciais
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'email-error' : undefined}
                  className={cn(emailError && 'border-danger focus-visible:border-danger')}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (emailError) setEmailError(null)
                    if (authError) setAuthError(null)
                  }}
                />
                {emailError ? (
                  <div id="email-error" className="text-2xs font-mono text-danger">
                    {emailError}
                  </div>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    className={cn(
                      'pr-8',
                      passwordError && 'border-danger focus-visible:border-danger'
                    )}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      if (passwordError) setPasswordError(null)
                      if (authError) setAuthError(null)
                    }}
                    onKeyUp={onPasswordKey}
                    onKeyDown={onPasswordKey}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-0 top-0 grid h-7 w-7 place-items-center text-text-dim hover:text-text-muted transition-colors"
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {passwordError ? (
                  <div id="password-error" className="text-2xs font-mono text-danger">
                    {passwordError}
                  </div>
                ) : null}
                {capsLock ? (
                  <div className="flex items-center gap-1 text-2xs font-mono text-warn">
                    <AlertTriangle size={11} />
                    Caps Lock ativado
                  </div>
                ) : null}
              </div>
            </div>

            {authError ? (
              <div
                role="alert"
                aria-live="polite"
                className="mt-3 flex items-start gap-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-2xs font-mono text-danger"
              >
                <AlertCircle size={13} className="mt-px shrink-0" />
                <span>{authError}</span>
              </div>
            ) : null}

            <Button
              type="submit"
              variant="default"
              size="md"
              className="w-full mt-4"
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Autenticando…
                </>
              ) : (
                'Entrar'
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
