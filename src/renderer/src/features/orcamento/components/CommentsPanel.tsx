import { useState, type FormEvent, type ReactNode } from 'react'
import { Check, Trash2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import {
  useAddComentario,
  useComentariosDoItem,
  useDeleteComentario,
  useResolverComentario
} from '../hooks/comentarios'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  itemId: string
}

export function CommentsPanel({ itemId }: Props): ReactNode {
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  const { data: comentarios = [], isLoading } = useComentariosDoItem(itemId)
  const add = useAddComentario()
  const resolver = useResolverComentario()
  const remove = useDeleteComentario()
  const [texto, setTexto] = useState('')

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!texto.trim()) return
    try {
      await add.mutateAsync({ item_id: itemId, texto: texto.trim() })
      setTexto('')
    } catch {
      // erro já é refletido pelo toast/global handler caso configurado
    }
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="space-y-2 max-h-72 overflow-auto pr-1">
        {isLoading ? (
          <div className="text-text-muted font-mono">Carregando…</div>
        ) : comentarios.length === 0 ? (
          <div className="text-text-muted font-mono italic">Nenhum comentário ainda.</div>
        ) : (
          comentarios.map((c) => (
            <div
              key={c.id}
              className={cn(
                'rounded border p-2 group',
                c.resolvido ? 'border-success/30 bg-success/5' : 'border-border bg-bg-elevated'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-2xs font-mono text-text-dim">
                  <span className="text-text">{c.autor?.nome ?? 'Anônimo'}</span>
                  <span>·</span>
                  <span>{formatDate(c.created_at)}</span>
                  {c.resolvido ? <span className="text-success">· resolvido</span> : null}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() =>
                      resolver.mutate({ id: c.id, item_id: itemId, resolvido: !c.resolvido })
                    }
                    className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-success hover:bg-success/10"
                    title={c.resolvido ? 'Reabrir' : 'Resolver'}
                  >
                    <Check size={11} />
                  </button>
                  {c.autor_id === callerId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Excluir comentário?')) {
                          remove.mutate({ id: c.id, item_id: itemId })
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
              <div className="text-text whitespace-pre-wrap">{c.texto}</div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Adicionar comentário…"
          rows={2}
          className="flex-1 rounded border border-border-strong bg-bg-elevated px-2 py-1.5 text-xs text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent resize-none"
        />
        <Button type="submit" variant="default" size="sm" disabled={add.isPending || !texto.trim()}>
          <Send size={11} /> {add.isPending ? '...' : 'Enviar'}
        </Button>
      </form>
    </div>
  )
}
