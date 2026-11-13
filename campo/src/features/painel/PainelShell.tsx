import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Navigate, NavLink, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, Flame, ListChecks, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useSession } from '@/core/auth/SessionStore'
import { useObra, usePainel } from '@/core/db/daos'
import type { CatPainel } from '@/core/db/entities'
import { refreshPainel } from '@/core/sync/painelSync'
import { ApiError } from '@/core/api/fetchClient'
import { cn } from '@/lib/cn'
import { idadeDados } from './lib'

/**
 * Moldura das telas da visão estratégica: cabeçalho (voltar, título, Atualizar), faixa com a data do retrato
 * (amarela quando passou de 24 h), abas de baixo (Resumo · Serviços · Produção · Equipes) e os estados sem dados.
 * Ao abrir, renova o retrato se tiver mais de 1 min; o botão força.
 */
export function PainelShell({
  titulo,
  voltarPara = '/',
  semAbas,
  children,
}: {
  titulo: string
  voltarPara?: string
  semAbas?: boolean
  children: (p: CatPainel) => ReactNode
}) {
  const session = useSession()
  const navigate = useNavigate()
  const obraId = session?.obraAtualId ?? null
  const obra = useObra(obraId)
  const painel = usePainel(obraId)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<{ msg: string; offline: boolean } | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  const atualizar = useCallback(
    async (forcar: boolean) => {
      if (!obraId) return
      setAtualizando(true)
      setErro(null)
      try {
        await refreshPainel(obraId, { seMaisAntigoQueMs: forcar ? 0 : 60_000 })
      } catch (e) {
        const offline = e instanceof ApiError ? e.isOffline : !navigator.onLine
        setErro({ msg: e instanceof Error ? e.message : String(e), offline })
      } finally {
        setAtualizando(false)
        setAgora(Date.now())
      }
    },
    [obraId],
  )

  useEffect(() => {
    void atualizar(false)
  }, [atualizar])

  // a faixa "dados de…" fica amarela sozinha se o app ficar aberto
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!obraId) return <Navigate to="/" replace />
  const idade = painel ? idadeDados(painel.fetchedAt, agora) : null

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pl-safe pr-safe pt-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(voltarPara)}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-on-surface">{titulo}</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {obra?.codigo ?? painel?.obra.codigo ?? '—'} · Visão estratégica
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void atualizar(true)}
            disabled={atualizando}
            aria-label="Atualizar"
          >
            <RefreshCw className={cn('h-5 w-5', atualizando && 'animate-spin')} />
          </Button>
        </div>
        {idade && (
          <div
            className={cn(
              'flex items-center gap-2 px-4 pb-2 text-xs',
              idade.antigo ? 'text-warn' : 'text-on-surface-muted',
            )}
            data-testid="painel-idade"
          >
            <span
              className={cn(
                'h-2 w-2 flex-shrink-0 rounded-full',
                idade.antigo ? 'bg-warn' : 'bg-ok',
              )}
            />
            <span>
              Dados de {idade.texto}
              {idade.antigo && ' (mais de 24 h). Conecte-se e toque em atualizar.'}
              {!idade.antigo && erro?.offline && ' · sem conexão, mostrando o último retrato'}
            </span>
          </div>
        )}
        {erro && !erro.offline && (
          <div role="alert" className="px-4 pb-2 text-xs text-bad">
            {erro.msg}
          </div>
        )}
      </header>

      <div className={cn('mx-auto w-full max-w-2xl flex-1 px-4 pt-4', semAbas ? 'pb-8' : 'pb-24')}>
        {painel === undefined ? null : painel === null ? (
          <SemRetrato atualizando={atualizando} erro={erro} onTentar={() => void atualizar(true)} />
        ) : (
          children(painel)
        )}
      </div>

      {!semAbas && <AbasPainel />}
    </main>
  )
}

function SemRetrato({
  atualizando,
  erro,
  onTentar,
}: {
  atualizando: boolean
  erro: { msg: string; offline: boolean } | null
  onTentar: () => void
}) {
  return (
    <div className="mt-10 rounded-lg border border-border bg-bg-panel p-6 text-center">
      {atualizando ? (
        <p className="text-sm text-on-surface-dim">Baixando a visão estratégica da obra…</p>
      ) : (
        <>
          <p className="text-sm text-on-surface">
            {erro?.offline
              ? 'Sem conexão. Conecte-se à internet uma vez para baixar a visão estratégica; depois ela abre sem sinal.'
              : (erro?.msg ?? 'Ainda não há dados guardados.')}
          </p>
          <Button className="mt-4" variant="outline" onClick={onTentar}>
            Tentar de novo
          </Button>
        </>
      )}
    </div>
  )
}

function AbasPainel() {
  const abas = [
    { to: '/painel', label: 'Resumo', icon: BarChart3, end: true },
    { to: '/painel/servicos', label: 'Serviços', icon: ListChecks, end: false },
    { to: '/painel/producao', label: 'Produção', icon: Flame, end: false },
    { to: '/painel/equipes', label: 'Equipes', icon: Users, end: false },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg-panel pb-safe pl-safe pr-safe">
      <div className="mx-auto flex max-w-2xl">
        {abas.map((a) => (
          <NavLink
            key={a.to}
            to={a.to}
            end={a.end}
            replace
            className={({ isActive }) =>
              cn(
                'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 border-t-2 py-1.5 text-2xs font-medium transition-colors',
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-on-surface-dim hover:text-on-surface',
              )
            }
          >
            <a.icon className="h-5 w-5" strokeWidth={1.8} />
            {a.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** Bloco com título pequeno em caixa alta (padrão das telas do painel). */
export function Secao({
  titulo,
  acao,
  children,
  className,
}: {
  titulo: string
  acao?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-bg-panel p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="rotulo">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  )
}

/** Número grande + legenda. */
export function Kpi({
  valor,
  legenda,
  className,
  testId,
}: {
  valor: ReactNode
  legenda: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="truncate text-xl font-medium text-on-surface tabular" data-testid={testId}>
        {valor}
      </p>
      <p className="mt-0.5 text-2xs text-on-surface-dim">{legenda}</p>
    </div>
  )
}
