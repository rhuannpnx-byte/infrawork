import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertCircle, AlertTriangle, Info, Check, ZapOff, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { motivoDoErro } from '@/features/acompanhamento/lib/mensagem-erro'
import { rotuloAlertaStatus } from '@/lib/rotulos'
import { formatDateTimeShort } from '@/lib/format'
import type { AcompanhamentoAlerta } from '@/types/acompanhamento'
import { ALERTA_TIPO_LABEL } from '@/types/acompanhamento'
import {
  useResolverAlerta,
  useSilenciarAlerta,
  useReabrirAlerta
} from '@/features/acompanhamento/hooks/alertas'
import { contextoAlerta, tempoDesde, textoAlerta } from '@/features/acompanhamento/lib/texto-alerta'

interface Props {
  alerta: AcompanhamentoAlerta
}

const ICON = { critical: AlertCircle, warn: AlertTriangle, info: Info } as const

export function AlertaCard({ alerta }: Props): ReactNode {
  const silenciar = useSilenciarAlerta()
  const resolver = useResolverAlerta()
  const reabrir = useReabrirAlerta()
  const gravando = silenciar.isPending || resolver.isPending || reabrir.isPending
  const Icon = ICON[alerta.severidade] ?? Info
  const cor =
    alerta.severidade === 'critical'
      ? 'text-danger border-danger/40 bg-danger/5'
      : alerta.severidade === 'warn'
        ? 'text-warn border-warn/40 bg-warn/5'
        : 'text-accent border-accent/40 bg-accent/5'

  const contexto = contextoAlerta(alerta.contexto)
  const falhou = (oQue: string, e: unknown): void => {
    toast.error(`Não foi possível ${oQue} o alerta.${motivoDoErro(e)}`)
  }

  return (
    <div className={cn('rounded border p-3', cor)}>
      <div className="flex items-start gap-3">
        <Icon size={16} className="shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
            <h3 className="text-md font-semibold text-text">{textoAlerta(alerta.titulo)}</h3>
            <Badge variant="default">{ALERTA_TIPO_LABEL[alerta.tipo]}</Badge>
            {alerta.status !== 'aberto' && (
              <Badge variant="default">{rotuloAlertaStatus(alerta.status)}</Badge>
            )}
          </div>
          {alerta.descricao && (
            <p className="text-sm text-text-muted">{textoAlerta(alerta.descricao)}</p>
          )}
          {contexto.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1 text-xs text-text-muted">
              {contexto.map((c) => (
                <li key={c} className="rounded bg-bg/70 px-1.5 py-0.5 tabular">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {alerta.status === 'aberto' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gravando}
                  onClick={async () => {
                    try {
                      await silenciar.mutateAsync({
                        id: alerta.id,
                        obra_id: alerta.obra_id,
                        dias: 7
                      })
                      toast.success('Alerta silenciado por 7 dias.')
                    } catch (e) {
                      falhou('silenciar', e)
                    }
                  }}
                >
                  <ZapOff size={12} />{' '}
                  {silenciar.isPending ? 'Silenciando…' : 'Silenciar por 7 dias'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gravando}
                  onClick={async () => {
                    try {
                      await resolver.mutateAsync({ id: alerta.id, obra_id: alerta.obra_id })
                      toast.success('Alerta marcado como resolvido.')
                    } catch (e) {
                      falhou('resolver', e)
                    }
                  }}
                >
                  <Check size={12} /> {resolver.isPending ? 'Resolvendo…' : 'Resolver'}
                </Button>
              </>
            )}
            {alerta.status !== 'aberto' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={gravando}
                onClick={async () => {
                  try {
                    await reabrir.mutateAsync({ id: alerta.id, obra_id: alerta.obra_id })
                    toast.success('Alerta reaberto.')
                  } catch (e) {
                    falhou('reabrir', e)
                  }
                }}
              >
                <Undo2 size={12} /> {reabrir.isPending ? 'Reabrindo…' : 'Reabrir'}
              </Button>
            )}
          </div>
        </div>
        <span
          className="text-xs text-text-muted shrink-0 tabular"
          title={`Aberto em ${formatDateTimeShort(alerta.criado_em)}`}
        >
          {tempoDesde(alerta.criado_em)}
        </span>
      </div>
    </div>
  )
}
