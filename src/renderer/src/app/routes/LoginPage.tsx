import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth-store'
import { SUPABASE_ENABLED } from '@/lib/supabase/client'
import infraworkWordmark from '@/assets/infrawork-wordmark.png'

export function LoginPage(): ReactNode {
  const navigate = useNavigate()
  const signIn = useAuthStore((s) => s.signInWithPassword)
  const status = useAuthStore((s) => s.status)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!SUPABASE_ENABLED) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg text-text">
        <div className="max-w-md text-center p-6 border border-warn/30 bg-warn/10 rounded">
          <AlertTriangle size={20} className="text-warn mx-auto mb-2" />
          <div className="text-sm font-medium mb-1">Supabase desativado</div>
          <div className="text-xs text-text-muted">
            Defina <code className="font-mono">VITE_USE_SUPABASE=true</code> e as credenciais para usar a tela de login.
          </div>
        </div>
      </div>
    )
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen w-screen bg-bg grid place-items-center">
      <form
        onSubmit={onSubmit}
        className="relative w-[360px] rounded-md border border-border-strong bg-bg-panel p-6 shadow-2xl"
      >
        <div className="absolute left-0 right-0 bottom-full mb-6 flex flex-col items-center">
          <img
            src={infraworkWordmark}
            alt="InfraWork"
            className="w-full h-auto select-none drop-shadow-[0_0_24px_rgba(56,139,253,0.35)]"
            draggable={false}
          />
          <div className="mt-1 text-2xs font-mono uppercase tracking-[0.25em] text-text-dim">
            Engenharia · Planejamento · Acompanhamento
          </div>
        </div>

          <div className="mb-5">
            <div className="text-md font-semibold text-text">Acesso ao sistema</div>
            <div className="text-2xs text-text-dim font-mono">Entre com suas credenciais</div>
          </div>

          <div className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
        </div>

        {error ? (
          <div className="mt-3 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
            {error}
          </div>
        ) : null}

        <Button
          type="submit"
          variant="default"
          size="md"
          className="w-full mt-4"
          disabled={loading || status === 'loading'}
        >
          {loading ? 'Autenticando…' : 'Entrar'}
        </Button>

        <div className="mt-4 pt-3 border-t border-border text-2xs font-mono text-text-dim text-center">
          v0.1.0
        </div>
      </form>
    </div>
  )
}
