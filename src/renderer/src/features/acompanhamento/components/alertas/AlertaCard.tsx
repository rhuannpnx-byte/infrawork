import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertCircle, AlertTriangle, Info, Check, ZapOff, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AcompanhamentoAlerta } from '@/types/acompanhamento'
import { ALERTA_TIPO_LABEL } from '@/types/acompanhamento'
import {
  useResolverAlerta,
  useSilenciarAlerta,
  useReabrirAlerta
} from '@/features/acompanhamento/hooks/alertas'

interface Props { alerta: AcompanhamentoAlerta }

const ICON = { critical: AlertCircle, warn: AlertTriangle, info: Info } as const

export function AlertaCard({ alerta }: Props): ReactNode {
  const silenciar = useSilenciarAlerta()
  const resolver = useResolverAlerta()
  const reabrir = useReabrirAlerta()
  const Icon = ICON[alerta.severidade] ?? Info
  const cor =
    alerta.severidade === 'critical' ? 'text-red-400 border-red-500/30 bg-red-500/5'
    : alerta.severidade === 'warn' ? 'text-amber-400 border-amber-500/30 bg-amber-500/5'
    : 'text-blue-400 border-blue-500/30 bg-blue-500/5'

  const ctx = alerta.contexto ?? {}

  return (
    <div className={cn('rounded border p-3', cor)}>
      <div className="flex items-start gap-3">
        <Icon size={16} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-semibold text-text">{alerta.titulo}</h4>
            <Badge variant="default" className="text-2xs">{ALERTA_TIPO_LABEL[alerta.tipo]}</Badge>
            {alerta.status !== 'aberto' && (
              <Badge variant="default" className="text-2xs uppercase">{alerta.status}</Badge>
            )}
          </div>
          {alerta.descricao && (
            <p className="text-xs text-text-muted leading-relaxed">{alerta.descricao}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1 text-2xs font-mono text-text-dim">
            {Object.entries(ctx).slice(0, 6).map(([k, v]) => (
              <span key={k} className="px-1.5 py-0.5 rounded bg-bg/70">
                {k}: <span className="text-text">{formatVal(v)}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {alerta.status === 'aberto' && (
              <>
                <Button size="sm" variant="ghost"
                  onClick={async () => {
                    try {
                      await silenciar.mutateAsync({ id: alerta.id, obra_id: alerta.obra_id, dias: 7 })
                      toast.success('Silenciado por 7 dias')
                    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro') }
                  }}
                >
                  <ZapOff size={11} /> Silenciar 7d
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={async () => {
                    try {
                      await resolver.mutateAsync({ id: alerta.id, obra_id: alerta.obra_id })
                      toast.success('Resolvido')
                    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro') }
                  }}
                >
                  <Check size={11} /> Resolver
                </Button>
              </>
            )}
            {alerta.status !== 'aberto' && (
              <Button size="sm" variant="ghost"
                onClick={async () => {
                  try {
                    await reabrir.mutateAsync({ id: alerta.id, obra_id: alerta.obra_id })
                    toast.success('Reaberto')
                  } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro') }
                }}
              >
                <Undo2 size={11} /> Reabrir
              </Button>
            )}
          </div>
        </div>
        <span className="text-2xs font-mono text-text-dim shrink-0">{tempo(alerta.criado_em)}</span>
      </div>
    </div>
  )
}

function formatVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function tempo(s: string): string {
  const d = new Date(s)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
