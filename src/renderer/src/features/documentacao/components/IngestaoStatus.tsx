import { type ReactNode } from 'react'
import { Loader2, CheckCircle2, AlertCircle, X, UploadCloud } from 'lucide-react'
import { useIngestaoStore } from '@/stores/ingestao-store'

/**
 * Indicador global da fila de ingestão em segundo plano. Fica flutuando no canto
 * inferior esquerdo (o canto direito é dos toasts). Aparece enquanto há jobs e
 * permite dispensar quando termina. Não bloqueia o app.
 */
export function IngestaoStatus(): ReactNode {
  const fila = useIngestaoStore((s) => s.fila)
  const processando = useIngestaoStore((s) => s.processando)
  const limparConcluidos = useIngestaoStore((s) => s.limparConcluidos)

  if (fila.length === 0) return null

  const total = fila.length
  const concluidos = fila.filter(
    (j) => j.status === 'ok' || j.status === 'erro' || j.status === 'ignorado'
  ).length
  const erros = fila.filter((j) => j.status === 'erro').length
  const atual = fila.find((j) => j.status === 'processando')
  const pct = total > 0 ? Math.round((concluidos / total) * 100) : 0

  return (
    <div className="fixed bottom-3 left-3 z-50 w-72 rounded-lg border border-border-strong bg-bg-elevated shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {processando ? (
          <Loader2 size={13} className="text-accent animate-spin shrink-0" />
        ) : erros > 0 ? (
          <AlertCircle size={13} className="text-danger shrink-0" />
        ) : (
          <CheckCircle2 size={13} className="text-success shrink-0" />
        )}
        <span className="flex-1 text-2xs font-mono text-text font-medium">
          {processando ? 'Ingerindo documentos…' : 'Ingestão concluída'}
        </span>
        <span className="text-2xs font-mono text-text-dim tabular-nums">
          {concluidos}/{total}
        </span>
        {!processando ? (
          <button
            type="button"
            aria-label="Dispensar"
            className="text-text-dim hover:text-text"
            onClick={limparConcluidos}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <div className="h-1 w-full rounded-full bg-bg overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-2xs font-mono text-text-muted min-h-[14px]">
          <UploadCloud size={10} className="shrink-0 text-text-dim" />
          <span className="flex-1 min-w-0 truncate" title={atual?.nome}>
            {atual ? atual.nome : erros > 0 ? `${erros} falha(s)` : 'tudo certo'}
          </span>
        </div>
      </div>
    </div>
  )
}
