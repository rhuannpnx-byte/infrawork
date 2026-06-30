import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Loader2 } from 'lucide-react'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { queryClient } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { reprocessarObra, type ReprocessoProgresso } from '@/features/documentacao/lib/reprocessar'

interface Props {
  obraId: string
  /** Também regerar embeddings (RAG). Mais lento; use após mudar transcrição/chunking. */
  reindexar?: boolean
  className?: string
}

/**
 * Botão de RETROANÁLISE: reprocessa todos os documentos já ingeridos com o
 * template/prompts atuais, sem re-inserir arquivos. Mostra progresso.
 */
export function ReprocessarButton({ obraId, reindexar = false, className }: Props): ReactNode {
  const confirm = useConfirm()
  const [prog, setProg] = useState<ReprocessoProgresso | null>(null)
  const rodando = prog != null && prog.etapa !== 'concluido'

  const rodar = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Reprocessar documentos?',
      description:
        'Re-extrai e re-resolve TODOS os documentos já ingeridos desta obra com o template e os prompts atuais (não re-insere arquivos). Pode levar alguns minutos.',
      confirmLabel: 'Reprocessar',
      variant: 'info'
    })
    if (!ok) return
    setProg({ total: 0, feitos: 0, etapa: 'extraindo' })
    try {
      const r = await reprocessarObra(obraId, { reindexar, onProgress: setProg })
      await queryClient.invalidateQueries({ queryKey: ['documentacao', 'dossie', obraId] })
      if (r.erros > 0) toast.warning(`Reprocessado: ${r.docs} doc(s), ${r.erros} com falha.`)
      else toast.success(`Reprocessado: ${r.docs} documento(s).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reprocessar')
    } finally {
      setProg(null)
    }
  }

  const rotulo = (): string => {
    if (!prog) return 'Reprocessar'
    if (prog.etapa === 'resolvendo') return 'Resolvendo dossiê…'
    if (prog.etapa === 'concluido') return 'Concluído'
    return prog.total ? `Extraindo ${prog.feitos}/${prog.total}…` : 'Iniciando…'
  }

  return (
    <button
      type="button"
      onClick={() => void rodar()}
      disabled={rodando}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-border bg-bg-panel px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:border-border-accent disabled:opacity-60',
        className
      )}
      title="Reprocessar todos os documentos com as premissas atuais"
    >
      {rodando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      {rotulo()}
    </button>
  )
}
