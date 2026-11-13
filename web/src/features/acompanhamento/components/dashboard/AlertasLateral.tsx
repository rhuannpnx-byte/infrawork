import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, AlertCircle, Info, ZapOff, ChevronRight } from 'lucide-react'
import type { AcompanhamentoAlerta } from '@/types/acompanhamento'
import { ALERTA_TIPO_LABEL } from '@/types/acompanhamento'
import { useSilenciarAlerta } from '@/features/acompanhamento/hooks/alertas'
import { cn } from '@/lib/utils'

interface Props {
  alertas: AcompanhamentoAlerta[]
  obraId: string
  altura?: number
}

const ICON = { critical: AlertCircle, warn: AlertTriangle, info: Info } as const

export function AlertasLateral({ alertas, obraId, altura = 200 }: Props): ReactNode {
  const navigate = useNavigate()
  const silenciar = useSilenciarAlerta()
  const top = (alertas ?? []).slice(0, 8)

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3 shrink-0">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">
          Alertas críticos
        </h4>
        <button
          onClick={() => navigate({ to: '/acompanhamento/alertas' })}
          className="text-sm font-semibold text-accent hover:underline inline-flex items-center gap-1"
        >
          Ver todos <ChevronRight size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
        {top.length === 0 ? (
          <div className="text-sm text-text-muted flex items-center justify-center h-full text-center px-3">
            Nenhum alerta crítico aberto.
          </div>
        ) : (
          top.map((a) => {
            const Icon = ICON[a.severidade] ?? Info
            const cor =
              a.severidade === 'critical'
                ? 'text-danger border-danger/40'
                : a.severidade === 'warn'
                  ? 'text-warn border-warn/40'
                  : 'text-accent border-accent/40'
            return (
              <button
                key={a.id}
                onClick={() => navigate({ to: '/acompanhamento/alertas' })}
                className={cn(
                  'w-full text-left rounded border bg-bg-panel hover:bg-bg-hover transition-colors px-2 py-1.5',
                  cor
                )}
              >
                <div className="flex items-start gap-1.5">
                  <Icon size={12} className="shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text truncate" title={a.titulo}>
                      {a.titulo}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {ALERTA_TIPO_LABEL[a.tipo]}
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await silenciar.mutateAsync({ id: a.id, obra_id: obraId, dias: 7 })
                        toast.success('Alerta silenciado por 7 dias.')
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : 'Não foi possível silenciar o alerta.'
                        )
                      }
                    }}
                    className="text-text-dim hover:text-text shrink-0"
                    title="Silenciar por 7 dias"
                    aria-label="Silenciar por 7 dias"
                  >
                    <ZapOff size={12} />
                  </button>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
