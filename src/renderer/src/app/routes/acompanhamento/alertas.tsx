import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Filter } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAlertas, useRecalcularAlertas } from '@/features/acompanhamento/hooks/alertas'
import { AlertaCard } from '@/features/acompanhamento/components/alertas/AlertaCard'
import type { AlertaSeveridade, AlertaStatus } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'

export function AcompanhamentoAlertasPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Alertas">
      <RequireObra pageTitle="Alertas">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const [statusFiltro, setStatusFiltro] = useState<AlertaStatus[]>(['aberto'])
  const [severidadeFiltro, setSeveridadeFiltro] = useState<AlertaSeveridade[]>([])
  const { data: alertas = [], isLoading } = useAlertas(obraId, {
    status: statusFiltro,
    severidade: severidadeFiltro.length ? severidadeFiltro : undefined
  })
  const recalc = useRecalcularAlertas()

  const grupos = useMemo(() => {
    const ordem: AlertaSeveridade[] = ['critical', 'warn', 'info']
    const out: Record<AlertaSeveridade, typeof alertas> = { critical: [], warn: [], info: [] }
    for (const a of alertas) out[a.severidade].push(a)
    return ordem.map((s) => ({ severidade: s, itens: out[s] }))
  }, [alertas])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Alertas"
        subtitle={`${scope.obra?.nome ?? ''} · ${alertas.length} alertas (${statusFiltro.join(', ')})`}
        actions={
          <Button
            size="sm"
            variant="default"
            disabled={recalc.isPending}
            onClick={async () => {
              try {
                const r = await recalc.mutateAsync({ obra_id: obraId })
                const item = r.resultados[0]
                if (item) toast.success(`Recalc OK: ${item.inseridos} novos, ${item.resolvidos} auto-resolvidos`)
              } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro') }
            }}
          >
            <RefreshCw size={11} className={recalc.isPending ? 'animate-spin' : ''} />
            Recalcular
          </Button>
        }
      />

      <div className="border-b border-border px-5 py-3 flex flex-wrap items-center gap-4 bg-bg-panel">
        <div className="flex items-center gap-2">
          <Filter size={11} className="text-text-dim" />
          <span className="text-2xs font-mono uppercase text-text-dim">Status</span>
          {(['aberto', 'silenciado', 'resolvido'] as AlertaStatus[]).map((s) => {
            const ativo = statusFiltro.includes(s)
            return (
              <button
                key={s}
                onClick={() => setStatusFiltro((cur) => ativo ? cur.filter((x) => x !== s) : [...cur, s])}
                className={cn(
                  'px-2 py-0.5 rounded border text-2xs font-mono uppercase',
                  ativo ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-dim hover:text-text'
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono uppercase text-text-dim">Severidade</span>
          {(['critical', 'warn', 'info'] as AlertaSeveridade[]).map((s) => {
            const ativo = severidadeFiltro.includes(s)
            return (
              <button
                key={s}
                onClick={() => setSeveridadeFiltro((cur) => ativo ? cur.filter((x) => x !== s) : [...cur, s])}
                className={cn(
                  'px-2 py-0.5 rounded border text-2xs font-mono uppercase',
                  ativo ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-dim hover:text-text'
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <PulseBlock key={i} h={80} />)}
        {!isLoading && alertas.length === 0 && (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-4 py-6 text-center text-emerald-300 text-xs">
            Sem alertas nesse filtro · tudo certo
          </div>
        )}
        {grupos.map((g) => g.itens.length === 0 ? null : (
          <div key={g.severidade} className="space-y-2">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              {g.severidade === 'critical' ? 'Críticos' : g.severidade === 'warn' ? 'Avisos' : 'Informativos'}{' '}
              <span className="font-mono text-text-dim">({g.itens.length})</span>
            </h3>
            <div className="space-y-2">
              {g.itens.map((a) => <AlertaCard key={a.id} alerta={a} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
