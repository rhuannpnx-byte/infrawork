import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, AlertCircle, Info, ZapOff, ChevronRight } from 'lucide-react'
import type { AcompanhamentoAlerta } from '@/types/acompanhamento'
import { ALERTA_TIPO_LABEL } from '@/types/acompanhamento'
import { useSilenciarAlerta } from '@/features/acompanhamento/hooks/alertas'
import { cn } from '@/lib/utils'
import { motivoDoErro } from '@/features/acompanhamento/lib/mensagem-erro'
import { textoAlerta } from '@/features/acompanhamento/lib/texto-alerta'

interface Props {
  alertas: AcompanhamentoAlerta[]
  obraId: string
  altura?: number
}

const ICON = { critical: AlertCircle, warn: AlertTriangle, info: Info } as const

export function AlertasLateral({ alertas, obraId, altura = 200 }: Props): ReactNode {
  const navigate = useNavigate()
  const silenciar = useSilenciarAlerta()
  // a lista traz os alertas abertos de qualquer gravidade: os críticos primeiro, depois avisos e informativos
  const ordem = { critical: 0, warn: 1, info: 2 } as const
  const top = [...(alertas ?? [])]
    .sort((a, b) => (ordem[a.severidade] ?? 3) - (ordem[b.severidade] ?? 3))
    .slice(0, 8)

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3 shrink-0">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">
          Alertas abertos
        </h4>
        <button
          type="button"
          onClick={() => navigate({ to: '/acompanhamento/alertas' })}
          className="inline-flex min-h-6 items-center gap-1 rounded text-sm font-semibold text-accent hover:underline"
        >
          Ver todos <ChevronRight size={12} aria-hidden />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
        {top.length === 0 ? (
          <div className="text-sm text-text-muted flex items-center justify-center h-full text-center px-3">
            Nenhum alerta aberto.
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
              <div
                key={a.id}
                className={cn(
                  'flex items-start gap-1.5 rounded border bg-bg-panel px-2 py-1.5 transition-colors hover:bg-bg-hover',
                  cor
                )}
              >
                <Icon size={12} className="shrink-0 mt-0.5" aria-hidden />
                <button
                  type="button"
                  onClick={() => navigate({ to: '/acompanhamento/alertas' })}
                  className="min-w-0 flex-1 rounded text-left"
                >
                  <div className="text-sm text-text truncate" title={textoAlerta(a.titulo)}>
                    {textoAlerta(a.titulo)}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    {ALERTA_TIPO_LABEL[a.tipo]}
                  </div>
                </button>
                <button
                  type="button"
                  disabled={silenciar.isPending}
                  onClick={async () => {
                    try {
                      await silenciar.mutateAsync({ id: a.id, obra_id: obraId, dias: 7 })
                      toast.success('Alerta silenciado por 7 dias.')
                    } catch (err) {
                      toast.error(`Não foi possível silenciar o alerta.${motivoDoErro(err)}`)
                    }
                  }}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded text-text-muted hover:text-text"
                  title="Silenciar por 7 dias"
                  aria-label={`Silenciar por 7 dias: ${textoAlerta(a.titulo)}`}
                >
                  <ZapOff size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
