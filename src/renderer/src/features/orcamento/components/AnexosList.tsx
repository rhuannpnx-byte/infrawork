import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Paperclip, Upload, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAnexoSignedUrl, useAnexos, useDeleteAnexo, useUploadAnexo } from '../hooks/anexos'
import { formatDate } from '@/lib/format'
import type { AnexoEscopo } from '@/types/orcamento'

interface Props {
  obraId: string
  escopo: AnexoEscopo
  escopoId: string
  podeEditar: boolean
}

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function AnexosList({ obraId, escopo, escopoId, podeEditar }: Props): ReactNode {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { data: anexos = [], isLoading } = useAnexos(escopo, escopoId)
  const upload = useUploadAnexo()
  const remove = useDeleteAnexo()

  const onPick = (): void => fileInputRef.current?.click()

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await upload.mutateAsync({
        obra_id: obraId,
        escopo,
        escopo_id: escopoId,
        file
      })
      toast.success(`Anexo "${file.name}" enviado.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openSigned = async (path: string): Promise<void> => {
    const url = await getAnexoSignedUrl(path)
    if (url) {
      window.open(url, '_blank')
    } else {
      toast.error('Falha ao gerar link')
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-mono uppercase tracking-wider text-text-dim flex items-center gap-1">
          <Paperclip size={11} /> Anexos ({anexos.length})
        </h3>
        {podeEditar ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPick}
            disabled={upload.isPending}
          >
            <Upload size={11} /> {upload.isPending ? 'Enviando…' : 'Enviar arquivo'}
          </Button>
        ) : null}
        <input ref={fileInputRef} type="file" onChange={onChange} className="hidden" />
      </div>

      {isLoading ? (
        <div className="text-text-muted font-mono">Carregando…</div>
      ) : anexos.length === 0 ? (
        <div className="text-text-muted font-mono italic">Nenhum anexo.</div>
      ) : (
        <div className="rounded border border-border bg-bg-elevated divide-y divide-border/40">
          {anexos.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 group">
              <Paperclip size={11} className="text-text-dim shrink-0" />
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => openSigned(a.storage_path)}
                  className="text-text hover:text-accent truncate text-left block w-full"
                  title={a.nome}
                >
                  {a.nome}
                </button>
                <div className="text-2xs text-text-dim font-mono">
                  {fmtBytes(a.tamanho_bytes)} · {formatDate(a.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => openSigned(a.storage_path)}
                  className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-bg-hover"
                  title="Abrir"
                >
                  <ExternalLink size={11} />
                </button>
                {podeEditar ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Excluir "${a.nome}"?`)) {
                        remove.mutate({
                          id: a.id,
                          escopo,
                          escopo_id: escopoId,
                          storage_path: a.storage_path
                        })
                      }
                    }}
                    className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-danger/10"
                    title="Excluir"
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
