import { useState, type FormEvent, type ReactNode } from 'react'
import { Check, RotateCcw, Trash2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { EstadoConsulta } from '@/components/ui/estado'
import { useAuthStore } from '@/stores/auth-store'
import {
  useAddComentario,
  useComentariosDoItem,
  useDeleteComentario,
  useResolverComentario
} from '../hooks/comentarios'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/modals/ConfirmDialog'

interface Props {
  itemId: string
}

export function CommentsPanel({ itemId }: Props): ReactNode {
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  const consulta = useComentariosDoItem(itemId)
  const comentarios = consulta.data ?? []
  const add = useAddComentario()
  const resolver = useResolverComentario()
  const remove = useDeleteComentario()
  const confirm = useConfirm()
  const [texto, setTexto] = useState('')

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!texto.trim()) return
    try {
      await add.mutateAsync({ item_id: itemId, texto: texto.trim() })
      setTexto('')
    } catch {
      // o aviso de erro sai pelo tratamento geral das gravações
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="space-y-2 max-h-72 overflow-auto pr-1">
        <EstadoConsulta
          consulta={consulta}
          oQue="os comentários"
          vazio={comentarios.length === 0}
          textoVazio="Este item ainda não tem comentários. Escreva o primeiro no campo abaixo."
          className="py-2"
        >
          {comentarios.map((c) => {
            const autor = c.autor?.nome ?? 'Autor não identificado'
            return (
              <div
                key={c.id}
                className={cn(
                  'rounded border px-2.5 py-2',
                  c.resolvido ? 'border-success/40 bg-success/10' : 'border-border bg-bg-elevated'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 text-xs text-text-muted">
                    <span className="font-semibold text-text">{autor}</span>
                    <span className="tabular">{formatDate(c.created_at)}</span>
                    {c.resolvido ? <Badge variant="success">Resolvido</Badge> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      size="sm"
                      variant="ghost"
                      disabled={resolver.isPending}
                      onClick={() =>
                        resolver.mutate({ id: c.id, item_id: itemId, resolvido: !c.resolvido })
                      }
                      aria-label={
                        c.resolvido
                          ? `Reabrir o comentário de ${autor}`
                          : `Marcar o comentário de ${autor} como resolvido`
                      }
                      title={c.resolvido ? 'Reabrir' : 'Marcar como resolvido'}
                    >
                      {c.resolvido ? (
                        <RotateCcw size={12} aria-hidden />
                      ) : (
                        <Check size={12} aria-hidden />
                      )}
                    </IconButton>
                    {c.autor_id === callerId ? (
                      <IconButton
                        size="sm"
                        variant="danger"
                        disabled={remove.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Excluir o comentário?',
                            description:
                              'O comentário é apagado para todos que acompanham este item. Não dá para desfazer.',
                            confirmLabel: 'Excluir comentário',
                            variant: 'danger'
                          })
                          if (ok) remove.mutate({ id: c.id, item_id: itemId })
                        }}
                        aria-label="Excluir o meu comentário"
                        title="Excluir"
                      >
                        <Trash2 size={12} aria-hidden />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1 text-text whitespace-pre-wrap break-words">{c.texto}</div>
              </div>
            )
          })}
        </EstadoConsulta>
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Novo comentário"
          placeholder="Escreva um comentário…"
          rows={2}
          className="flex-1 rounded border border-border-strong bg-bg-panel px-2.5 py-1.5 text-sm text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent resize-none"
        />
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={add.isPending || !texto.trim()}
          title={!texto.trim() ? 'Escreva o comentário para enviar' : undefined}
        >
          <Send size={12} aria-hidden /> {add.isPending ? 'Enviando…' : 'Enviar'}
        </Button>
      </form>
    </div>
  )
}
