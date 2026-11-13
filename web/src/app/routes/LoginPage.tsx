import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  MailCheck
} from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { SUPABASE_CONFIGURADO } from '@/lib/supabase/client'
import infraworkWordmark from '@/assets/infrawork-wordmark.png'
import loginCover from '@/assets/login-cover.webp'
import { LoginWallpaper } from './LoginWallpaper'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SENHA_MIN = 8

/** Traduz o erro do Supabase (AuthApiError expõe `.code`/`.status`) para PT-BR. */
function mapAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string; name?: string; status?: number }
  const code = e?.code
  const message = e?.message ?? ''
  const name = e?.name ?? ''

  if (code === 'invalid_credentials') return 'E-mail ou senha incorretos.'
  if (code === 'email_not_confirmed')
    return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit')
    return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.'
  if (code === 'user_banned') return 'Conta suspensa. Contate o administrador.'
  if (code === 'same_password') return 'A nova senha precisa ser diferente da atual.'
  if (code === 'weak_password') return 'Senha fraca. Use letras, números e símbolos.'

  // Falha de rede (sem code; fetch/network; AuthRetryableFetchError)
  if (name === 'AuthRetryableFetchError' || /failed to fetch|network|fetch/i.test(message))
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.'

  // Erro do /me (lançado em auth-store: "/me retornou NNN" ou "/me retornou vazio")
  if (/^\/me retornou/i.test(message))
    return 'Não foi possível carregar seu perfil. Contate o suporte.'

  // Fallback por mensagem conhecida do Supabase, caso o code venha ausente
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.'

  return 'Não foi possível concluir. Tente novamente.'
}

// ─── Peças do cartão ────────────────────────────────────────────────────────

const CAMPO_BASE =
  'h-10 rounded-md px-3 text-sm bg-[color-mix(in_oklab,var(--bg-elevated)_85%,transparent)] ' +
  'transition-[border-color,box-shadow] hover:border-border-accent ' +
  'focus-visible:ring-[3px] focus-visible:ring-[color:var(--accent-glow-strong)]'
const CAMPO_ERRO =
  'border-danger hover:border-danger focus-visible:border-danger ' +
  'focus-visible:ring-[color:color-mix(in_oklab,var(--danger)_25%,transparent)]'

interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  rotulo: string
  erro?: string | null
  /** Conteúdo à direita do rótulo (ex.: "Esqueci minha senha"). */
  extraRotulo?: ReactNode
  /** Botão dentro do campo, à direita (ex.: mostrar senha). */
  acao?: ReactNode
  dica?: ReactNode
}

const Campo = forwardRef<HTMLInputElement, CampoProps>(function Campo(
  { id, rotulo, erro, extraRotulo, acao, dica, className, ...props },
  ref
) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-medium text-text-muted">
          {rotulo}
        </Label>
        {extraRotulo}
      </div>
      <div className="relative">
        <Input
          ref={ref}
          id={id}
          aria-invalid={!!erro}
          aria-describedby={erro ? `${id}-erro` : undefined}
          className={cn(CAMPO_BASE, acao && 'pr-11', erro && CAMPO_ERRO, className)}
          {...props}
        />
        {acao}
      </div>
      {erro ? (
        <div id={`${id}-erro`} className="flex items-center gap-1 text-xs text-danger">
          <AlertCircle size={12} className="shrink-0" />
          {erro}
        </div>
      ) : null}
      {dica}
    </div>
  )
})

function BotaoMostrarSenha({
  visivel,
  onToggle
}: {
  visivel: boolean
  onToggle: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
      aria-pressed={visivel}
      className={cn(
        'absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md',
        'text-text-dim transition-colors hover:bg-bg-hover hover:text-text',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-glow-strong)] focus-visible:text-text'
      )}
    >
      {visivel ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  )
}

function BotaoPrincipal({
  carregando,
  textoCarregando,
  children
}: {
  carregando: boolean
  textoCarregando: string
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="submit"
      disabled={carregando}
      aria-busy={carregando}
      className={cn(
        'inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold',
        'text-[color:var(--primary-foreground)] shadow-[0_0_0_1px_var(--accent-line),0_10px_28px_-12px_var(--accent-glow-strong)]',
        'transition-[background-color,box-shadow,transform] hover:bg-accent-hover',
        'hover:shadow-[0_0_0_1px_var(--accent-line),0_14px_32px_-12px_var(--accent)] active:translate-y-px',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--accent-glow-strong)]',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-panel)]',
        'disabled:cursor-wait disabled:opacity-90'
      )}
    >
      {carregando ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {textoCarregando}
        </>
      ) : (
        children
      )}
    </button>
  )
}

function Alerta({ tom, children }: { tom: 'erro' | 'aviso'; children: ReactNode }): ReactNode {
  const erro = tom === 'erro'
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed',
        erro
          ? 'border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--danger)_10%,transparent)] text-danger'
          : 'border-[color:color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--warn)_10%,transparent)] text-warn'
      )}
    >
      {erro ? (
        <AlertCircle size={14} className="mt-px shrink-0" />
      ) : (
        <AlertTriangle size={14} className="mt-px shrink-0" />
      )}
      <span>{children}</span>
    </div>
  )
}

function LinkTexto({ onClick, children }: { onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-xs font-medium text-accent transition-colors hover:text-accent-hover hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-glow-strong)]"
    >
      {children}
    </button>
  )
}

function Cabecalho({ titulo, subtitulo }: { titulo: string; subtitulo: ReactNode }): ReactNode {
  return (
    <div className="mb-7">
      <h1 className="text-2xl font-semibold tracking-tight text-text">{titulo}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{subtitulo}</p>
    </div>
  )
}

/** Cartão com "tremida" curta ao receber um erro (respeita reduced-motion via CSS). */
function Cartao({
  onSubmit,
  tremer,
  onTremido,
  rodape,
  children
}: {
  onSubmit: (e: FormEvent) => void
  tremer: boolean
  onTremido: () => void
  rodape?: ReactNode
  children: ReactNode
}): ReactNode {
  const form = useRef<HTMLFormElement>(null)
  // validação recusada: o foco vai ao primeiro campo com erro
  useEffect(() => {
    if (tremer) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [tremer])
  return (
    <form
      ref={form}
      onSubmit={onSubmit}
      noValidate
      onAnimationEnd={onTremido}
      className={cn(
        'pointer-events-auto w-[400px] max-w-full rounded-xl border border-border-strong p-9',
        'bg-[color-mix(in_oklch,var(--bg-panel)_84%,transparent)] shadow-2xl backdrop-blur-md',
        tremer && 'login-tremer'
      )}
    >
      {children}
      {rodape ? (
        <div className="mt-7 border-t border-border pt-4 text-center text-2xs leading-relaxed text-text-dim">
          {rodape}
        </div>
      ) : null}
    </form>
  )
}

// ─── Layout (foto + painel com wallpaper) ───────────────────────────────────

function LoginShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="h-dvh w-screen bg-bg grid lg:grid-cols-[1.05fr_1fr]">
      {/* PAINEL DE IMAGEM / MARCA — esquerda (escondido em janela estreita) */}
      <aside className="relative hidden overflow-hidden bg-bg lg:block">
        {/* Fallback: gradiente + grade de pontos, visível antes da foto chegar */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_20%_0%,var(--accent-glow),transparent_55%),linear-gradient(160deg,var(--bg-elevated),var(--bg)_70%)]" />
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)',
            backgroundSize: '22px 22px'
          }}
        />
        <img
          src={loginCover}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 p-10">
          <div className="h-px w-12 bg-[var(--accent-line)]" />
          <img
            src={infraworkWordmark}
            alt="InfraWork"
            className="mt-5 w-[220px] h-auto select-none drop-shadow-[0_0_28px_rgba(56,139,253,0.35)]"
            draggable={false}
          />
          <div className="mt-3 text-2xs font-mono uppercase tracking-[0.25em] text-text-muted">
            Engenharia · Planejamento · Acompanhamento
          </div>
        </div>
      </aside>

      {/* PAINEL DO FORMULÁRIO — direita, sobre as curvas de nível */}
      <main className="relative flex flex-col overflow-hidden bg-bg px-6 py-8">
        <div id="login-fx" aria-hidden className="absolute inset-0 z-0 overflow-hidden">
          <LoginWallpaper />
        </div>
        {/* pb desloca o cartão um pouco acima do centro óptico */}
        <div className="pointer-events-none relative z-10 flex flex-1 items-center justify-center pb-[7vh]">
          {children}
        </div>
      </main>
    </div>
  )
}

function SemConfiguracao(): ReactNode {
  return (
    <div className="flex items-center justify-center h-screen bg-bg text-text">
      <div className="max-w-md text-center p-6 border border-warn/30 bg-warn/10 rounded">
        <AlertTriangle size={20} className="text-warn mx-auto mb-2" />
        <div className="text-sm font-medium mb-1">Sistema sem configuração</div>
        <div className="text-xs text-text-muted">
          Esta publicação saiu sem <code className="font-mono">VITE_SUPABASE_URL</code> e{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>. Avise o administrador.
        </div>
      </div>
    </div>
  )
}

// ─── Login ──────────────────────────────────────────────────────────────────

type Modo = 'entrar' | 'recuperar' | 'enviado'

export function LoginPage(): ReactNode {
  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')

  if (!SUPABASE_CONFIGURADO) return <SemConfiguracao />

  return (
    <LoginShell>
      {modo === 'entrar' ? (
        <FormEntrar email={email} setEmail={setEmail} onEsqueci={() => setModo('recuperar')} />
      ) : modo === 'recuperar' ? (
        <FormRecuperar
          email={email}
          setEmail={setEmail}
          onEnviado={() => setModo('enviado')}
          onVoltar={() => setModo('entrar')}
        />
      ) : (
        <LinkEnviado email={email} onVoltar={() => setModo('entrar')} />
      )}
    </LoginShell>
  )
}

function validarEmail(email: string): string | null {
  const t = email.trim()
  if (!t) return 'Informe seu e-mail.'
  if (!EMAIL_RE.test(t)) return 'E-mail inválido.'
  return null
}

function FormEntrar({
  email,
  setEmail,
  onEsqueci
}: {
  email: string
  setEmail: (v: string) => void
  onEsqueci: () => void
}): ReactNode {
  const signIn = useAuthStore((s) => s.signInWithPassword)
  const avisoLogin = useAuthStore((s) => s.avisoLogin)
  const passwordRef = useRef<HTMLInputElement>(null)

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tremer, setTremer] = useState(false)

  const [authError, setAuthError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setAuthError(null)
    const eErr = validarEmail(email)
    const pErr = password ? null : 'Informe sua senha.'
    setEmailError(eErr)
    setPasswordError(pErr)
    if (eErr || pErr) {
      setTremer(true)
      return
    }

    setLoading(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setAuthError(mapAuthError(err))
      setTremer(true)
      // Mantém o e-mail, limpa a senha e refoca para nova tentativa.
      setPassword('')
      passwordRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false)
  }

  return (
    <Cartao
      onSubmit={onSubmit}
      tremer={tremer}
      onTremido={() => setTremer(false)}
      rodape="Problemas para entrar? Fale com o administrador da sua empresa."
    >
      <Cabecalho
        titulo="Acesse o InfraWork"
        subtitulo="Entre com seu e-mail e senha para continuar."
      />

      {avisoLogin && !authError ? (
        <div className="mb-4">
          <Alerta tom="aviso">{avisoLogin}</Alerta>
        </div>
      ) : null}

      <div className="space-y-4">
        <Campo
          id="email"
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          autoFocus
          placeholder="nome@empresa.com.br"
          value={email}
          erro={emailError}
          onChange={(e) => {
            setEmail(e.target.value)
            if (emailError) setEmailError(null)
            if (authError) setAuthError(null)
          }}
        />

        <Campo
          id="password"
          ref={passwordRef}
          rotulo="Senha"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          erro={passwordError}
          extraRotulo={<LinkTexto onClick={onEsqueci}>Esqueci minha senha</LinkTexto>}
          acao={
            <BotaoMostrarSenha visivel={showPassword} onToggle={() => setShowPassword((v) => !v)} />
          }
          dica={
            capsLock ? (
              <div className="flex items-center gap-1 text-xs text-warn">
                <AlertTriangle size={12} />
                Caps Lock ativado
              </div>
            ) : null
          }
          onChange={(e) => {
            setPassword(e.target.value)
            if (passwordError) setPasswordError(null)
            if (authError) setAuthError(null)
          }}
          onKeyUp={onPasswordKey}
          onKeyDown={onPasswordKey}
        />
      </div>

      {authError ? (
        <div className="mt-4">
          <Alerta tom="erro">{authError}</Alerta>
        </div>
      ) : null}

      <div className="mt-6">
        <BotaoPrincipal carregando={loading} textoCarregando="Entrando…">
          Entrar
        </BotaoPrincipal>
      </div>
    </Cartao>
  )
}

function FormRecuperar({
  email,
  setEmail,
  onEnviado,
  onVoltar
}: {
  email: string
  setEmail: (v: string) => void
  onEnviado: () => void
  onVoltar: () => void
}): ReactNode {
  const enviar = useAuthStore((s) => s.enviarLinkRecuperacao)
  const [loading, setLoading] = useState(false)
  const [tremer, setTremer] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErro(null)
    const eErr = validarEmail(email)
    setEmailError(eErr)
    if (eErr) {
      setTremer(true)
      return
    }
    setLoading(true)
    try {
      await enviar(email.trim())
      onEnviado()
    } catch (err) {
      setErro(mapAuthError(err))
      setTremer(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Cartao onSubmit={onSubmit} tremer={tremer} onTremido={() => setTremer(false)}>
      <Cabecalho
        titulo="Redefinir senha"
        subtitulo="Informe seu e-mail. Se ele estiver cadastrado, enviaremos um link para você criar uma nova senha."
      />
      <Campo
        id="email-recuperar"
        rotulo="E-mail"
        type="email"
        autoComplete="username"
        autoFocus
        placeholder="nome@empresa.com.br"
        value={email}
        erro={emailError}
        onChange={(e) => {
          setEmail(e.target.value)
          if (emailError) setEmailError(null)
          if (erro) setErro(null)
        }}
      />
      {erro ? (
        <div className="mt-4">
          <Alerta tom="erro">{erro}</Alerta>
        </div>
      ) : null}
      <div className="mt-6 space-y-4">
        <BotaoPrincipal carregando={loading} textoCarregando="Enviando…">
          Enviar link
        </BotaoPrincipal>
        <div className="flex justify-center">
          <LinkTexto onClick={onVoltar}>
            <span className="inline-flex items-center gap-1">
              <ArrowLeft size={12} />
              Voltar para o login
            </span>
          </LinkTexto>
        </div>
      </div>
    </Cartao>
  )
}

function LinkEnviado({ email, onVoltar }: { email: string; onVoltar: () => void }): ReactNode {
  return (
    <Cartao
      onSubmit={(e) => {
        e.preventDefault()
        onVoltar()
      }}
      tremer={false}
      onTremido={() => undefined}
    >
      <div className="mb-5 grid h-11 w-11 place-items-center rounded-full bg-[color:var(--accent-glow-strong)] text-accent">
        <MailCheck size={20} />
      </div>
      <Cabecalho
        titulo="Verifique seu e-mail"
        subtitulo={
          <>
            Se houver uma conta para <span className="font-medium text-text">{email.trim()}</span>,
            você receberá em instantes um link para criar uma nova senha. O link vale por 1 hora.
          </>
        }
      />
      <p className="-mt-3 mb-6 text-xs leading-relaxed text-text-dim">
        Não chegou? Confira a caixa de spam ou peça ajuda ao administrador da sua empresa.
      </p>
      <BotaoPrincipal carregando={false} textoCarregando="">
        Voltar para o login
      </BotaoPrincipal>
    </Cartao>
  )
}

// ─── Nova senha (chegou pelo link do e-mail) ────────────────────────────────

export function RedefinirSenhaPage(): ReactNode {
  const definir = useAuthStore((s) => s.definirNovaSenha)
  const cancelar = useAuthStore((s) => s.cancelarRecuperacao)
  const emailConta = useAuthStore((s) => s.profile?.email)

  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [visivel, setVisivel] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tremer, setTremer] = useState(false)
  const [senhaErro, setSenhaErro] = useState<string | null>(null)
  const [confErro, setConfErro] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErro(null)
    const sErr = senha.length < SENHA_MIN ? `Use pelo menos ${SENHA_MIN} caracteres.` : null
    const cErr = !sErr && confirmacao !== senha ? 'As senhas não coincidem.' : null
    setSenhaErro(sErr)
    setConfErro(cErr)
    if (sErr || cErr) {
      setTremer(true)
      return
    }
    setLoading(true)
    try {
      await definir(senha)
      toast.success('Senha alterada. Bem-vindo de volta!')
    } catch (err) {
      setErro(mapAuthError(err))
      setTremer(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <LoginShell>
      <Cartao onSubmit={onSubmit} tremer={tremer} onTremido={() => setTremer(false)}>
        <Cabecalho
          titulo="Criar nova senha"
          subtitulo={
            emailConta ? (
              <>
                Conta <span className="font-medium text-text">{emailConta}</span>
              </>
            ) : (
              'Escolha uma nova senha para sua conta.'
            )
          }
        />
        <div className="space-y-4">
          <Campo
            id="nova-senha"
            rotulo="Nova senha"
            type={visivel ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            value={senha}
            erro={senhaErro}
            acao={<BotaoMostrarSenha visivel={visivel} onToggle={() => setVisivel((v) => !v)} />}
            dica={
              !senhaErro ? (
                <div className="text-xs text-text-dim">Mínimo de {SENHA_MIN} caracteres.</div>
              ) : null
            }
            onChange={(e) => {
              setSenha(e.target.value)
              if (senhaErro) setSenhaErro(null)
              if (erro) setErro(null)
            }}
          />
          <Campo
            id="confirmar-senha"
            rotulo="Confirmar nova senha"
            type={visivel ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmacao}
            erro={confErro}
            onChange={(e) => {
              setConfirmacao(e.target.value)
              if (confErro) setConfErro(null)
              if (erro) setErro(null)
            }}
          />
        </div>
        {erro ? (
          <div className="mt-4">
            <Alerta tom="erro">{erro}</Alerta>
          </div>
        ) : null}
        <div className="mt-6 space-y-4">
          <BotaoPrincipal carregando={loading} textoCarregando="Salvando…">
            Salvar nova senha
          </BotaoPrincipal>
          <div className="flex justify-center">
            <LinkTexto onClick={() => void cancelar()}>Cancelar e sair</LinkTexto>
          </div>
        </div>
      </Cartao>
    </LoginShell>
  )
}
