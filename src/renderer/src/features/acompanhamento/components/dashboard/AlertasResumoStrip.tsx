import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, AlertCircle, Info, ArrowRight, ZapOff, ChevronRight } from 'lucide-react'
import type { AcompanhamentoAlerta } from '@/types/acompanhamento'
import { ALERTA_TIPO_LABEL } from '@/types/acompanhamento'
import { useSilenciarAlerta } from '@/features/acompanhamento/hooks/alertas'
import { cn } from '@/lib/utils'

interface Props {
  alertas: AcompanhamentoAlerta[]
  obraId: string
}

const ICON = { critical: AlertCircle, warn: AlertTriangle, info: Info } as const

export function AlertasResumoStrip({ alertas, obraId }: Props): ReactNode {
  const navigate = useNavigate()
  const silenciar = useSilenciarAlerta()
  const top = (alertas ?? []).slice(0, 5)

  if (top.length === 0) {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-xs flex items-center gap-2 text-emerald-300">
        <Info size={12} />
        Sem alertas críticos abertos · tudo certo
      </div>
    )
  }

  return (
    <div className="rounded border border-border bg-bg-panel">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <AlertTriangle size={11} /> Alertas ativos
        </h4>
        <button
          onClick={() => navigate({ to: '/acompanhamento/alertas' })}
          className="text-2xs font-mono text-text-dim hover:text-text inline-flex items-center gap-1"
        >
          ver todos <ChevronRight size={9} />
        </button>
      </div>
      <div className="divide-y divide-border">
        {top.map((a) => {
          const Icon = ICON[a.severidade] ?? Info
          const corIcon =
            a.severidade === 'critical' ? 'text-red-400'
            : a.severidade === 'warn' ? 'text-amber-400'
            : 'text-blue-400'
          return (
            <div key={a.id} className="px-4 py-2 flex items-center gap-3 hover:bg-bg-hover/50 transition-colors">
              <Icon size={14} className={cn('shrink-0', corIcon)} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-text truncate" title={a.titulo}>{a.titulo}</div>
                <div className="text-2xs font-mono text-text-dim truncate">
                  {ALERTA_TIPO_LABEL[a.tipo]} {a.descricao ? '· ' + a.descricao : ''}
                </div>
              </div>
              <button
                onClick={() => navigate({ to: '/acompanhamento/alertas' })}
                className="text-text-dim hover:text-text"
                title="Ver"
              >
                <ArrowRight size={11} />
              </button>
              <button
                onClick={async () => {
                  try {
                    await silenciar.mutateAsync({ id: a.id, obra_id: obraId, dias: 7 })
                    toast.success('Alerta silenciado por 7 dias')
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Falha ao silenciar')
                  }
                }}
                className="text-text-dim hover:text-text"
                title="Silenciar 7 dias"
              >
                <ZapOff size={11} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
