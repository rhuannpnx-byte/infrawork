import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Send, Check, Clock, AlertTriangle, Sparkles } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDateTimeShort } from '@/lib/format'
import { useOraculoHistorico, useEnviarOraculoMensagem } from '@/features/whatsapp/hooks'
import type { WhatsAppOraculoAcesso, OraculoChatItem } from '@/types/whatsapp'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  acesso: WhatsAppOraculoAcesso | null
  /** false quando a sessão do WhatsApp não está conectada (envio indisponível). */
  podeEnviar?: boolean
}

function StatusIcon({ status }: { status: OraculoChatItem['status'] }): ReactNode {
  if (status === 'enviado') return <Check size={11} className="text-success" />
  if (status === 'erro') return <AlertTriangle size={11} className="text-danger" />
  return <Clock size={11} className="text-text-dim" />
}

export function ChatOraculoDialog({ open, onOpenChange, acesso, podeEnviar = true }: Props): ReactNode {
  const userId = acesso?.user_id ?? null
  const { data: itens = [], isLoading } = useOraculoHistorico(open ? userId : null)
  const enviar = useEnviarOraculoMensagem()
  const [texto, setTexto] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // rola para o fim ao abrir / ao chegar mensagem nova
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [itens.length, open])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const t = texto.trim()
    if (!t || !userId || !podeEnviar) return
    setTexto('')
    try {
      await enviar.mutateAsync({ user_id: userId, texto: t })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar')
      setTexto(t)
    }
  }

  const semWpp = !acesso?.usuario?.whatsapp
  const bloqueado = semWpp || !podeEnviar
  const placeholder = semWpp
    ? 'Usuário sem WhatsApp cadastrado'
    : !podeEnviar
      ? 'Sessão do WhatsApp desconectada'
      : 'Escreva uma mensagem…'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <DialogHeader>
        <DialogTitle>
          Conversa — {acesso?.usuario?.nome ?? 'Usuário'}
          {acesso?.usuario?.whatsapp ? (
            <span className="ml-2 text-2xs font-mono text-text-dim">
              {acesso.usuario.whatsapp}
            </span>
          ) : null}
        </DialogTitle>
      </DialogHeader>

      <div
        ref={scrollRef}
        className="px-4 py-3 h-[55vh] overflow-y-auto bg-bg flex flex-col gap-2"
      >
        {isLoading ? (
          <div className="text-xs text-text-dim font-mono">Carregando…</div>
        ) : itens.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-2xs text-text-dim italic">
            Sem histórico ainda.
          </div>
        ) : (
          itens.map((m) => {
            const direita = m.tipo === 'operador'
            return (
              <div
                key={m.id}
                className={cn('flex flex-col max-w-[80%]', direita ? 'self-end items-end' : 'self-start items-start')}
              >
                <div
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs whitespace-pre-wrap break-words',
                    direita
                      ? 'bg-accent text-white rounded-br-sm'
                      : m.tipo === 'oraculo'
                        ? 'bg-bg-elevated text-text border border-border rounded-bl-sm'
                        : 'bg-bg-panel text-text border border-border rounded-bl-sm'
                  )}
                >
                  {m.tipo === 'oraculo' ? (
                    <span className="flex items-center gap-1 text-2xs font-mono text-accent mb-0.5">
                      <Sparkles size={10} /> Oráculo
                    </span>
                  ) : null}
                  {m.texto}
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-2xs font-mono text-text-faint">
                  {formatDateTimeShort(m.ts)}
                  {direita ? <StatusIcon status={m.status} /> : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={placeholder}
          disabled={bloqueado || enviar.isPending}
          autoFocus
        />
        <Button
          type="submit"
          variant="default"
          size="icon"
          disabled={bloqueado || !texto.trim() || enviar.isPending}
        >
          <Send size={14} />
        </Button>
      </form>
    </Dialog>
  )
}
