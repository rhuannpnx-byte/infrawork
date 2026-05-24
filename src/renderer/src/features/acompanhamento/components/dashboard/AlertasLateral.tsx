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
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between shrink-0">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <AlertTriangle size={11} /> Alertas
        </h4>
        <button
          onClick={() => navigate({ to: '/acompanhamento/alertas' })}
          className="text-2xs font-mono text-text-dim hover:text-text inline-flex items-center gap-1"
        >
          ver todos <ChevronRight size={9} />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2 space-y-1">
        {top.length === 0 ? (
          <div className="text-2xs font-mono text-emerald-300 flex items-center justify-center h-full">
            <Info size={11} className="mr-1.5" /> tudo certo
          </div>
        ) : (
          top.map((a) => {
            const Icon = ICON[a.severidade] ?? Info
            const cor =
              a.severidade === 'critical' ? 'text-red-400 border-red-500/30'
              : a.severidade === 'warn' ? 'text-amber-400 border-amber-500/30'
              : 'text-blue-400 border-blue-500/30'
            return (
              <button
                key={a.id}
                onClick={() => navigate({ to: '/acompanhamento/alertas' })}
                className={cn(
                  'w-full text-left rounded border bg-bg/40 hover:bg-bg-hover transition-colors p-1.5',
                  cor
                )}
              >
                <div className="flex items-start gap-1.5">
                  <Icon size={11} className="shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-2xs font-mono text-text truncate" title={a.titulo}>
                      {a.titulo}
                    </div>
                    <div className="text-[10px] font-mono text-text-dim truncate">
                      {ALERTA_TIPO_LABEL[a.tipo]}
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await silenciar.mutateAsync({ id: a.id, obra_id: obraId, dias: 7 })
                        toast.success('Silenciado 7d')
                      } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
                    }}
                    className="text-text-dim hover:text-text shrink-0"
                    title="Silenciar 7d"
                  >
                    <ZapOff size={10} />
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
