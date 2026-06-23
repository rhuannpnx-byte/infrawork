// Painel direito do workbench — chat multi-turno com o agente. Cada mensagem do
// operador refina o plano (centro) e o agente responde em linguagem natural.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MensagemChat } from '@/types/agrupamento'

interface Props {
  mensagens: MensagemChat[]
  trabalhando: boolean
  hasResp: boolean
  onEnviar: (texto: string) => void
}

const SUGESTOES = [
  'Não agrupe sinalização',
  'Transporte de agregado é compartilhado entre CBUQ e Base',
  'Junte as variações de DMT no mesmo grupo'
]

export function PainelChat({ mensagens, trabalhando, hasResp, onEnviar }: Props): ReactNode {
  const [texto, setTexto] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensagens.length, trabalhando])

  const enviar = (t: string): void => {
    const v = t.trim()
    if (!v || trabalhando) return
    onEnviar(v)
    setTexto('')
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    enviar(texto)
  }

  return (
    <div className="h-full flex flex-col bg-bg-panel">
      <div className="px-3 py-2 border-b border-border shrink-0 flex items-center gap-1.5">
        <Sparkles size={12} className="text-accent" />
        <span className="text-2xs font-mono text-text-dim uppercase tracking-wide">
          Conversa com o agente
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-bg flex flex-col gap-2 px-3 py-3"
      >
        {mensagens.length === 0 && !trabalhando ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-2">
            <p className="text-2xs text-text-dim leading-relaxed">
              Gere a proposta e converse para refinar. Ex.:
            </p>
            <div className="flex flex-col gap-1 w-full">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="text-2xs text-left rounded border border-border bg-bg-elevated px-2 py-1 text-text-muted hover:text-text hover:border-border-accent transition-colors"
                >
                  “{s}”
                </button>
              ))}
            </div>
          </div>
        ) : (
          mensagens.map((m, i) => {
            const direita = m.role === 'user'
            return (
              <div
                key={i}
                className={cn(
                  'flex flex-col max-w-[88%]',
                  direita ? 'self-end items-end' : 'self-start items-start'
                )}
              >
                <div
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs whitespace-pre-wrap break-words',
                    direita
                      ? 'bg-accent text-white rounded-br-sm'
                      : 'bg-bg-elevated text-text border border-border rounded-bl-sm'
                  )}
                >
                  {!direita ? (
                    <span className="flex items-center gap-1 text-2xs font-mono text-accent mb-0.5">
                      <Sparkles size={10} /> Agente
                    </span>
                  ) : null}
                  {m.texto}
                </div>
              </div>
            )
          })
        )}
        {trabalhando ? (
          <div className="self-start flex items-center gap-2 rounded-lg bg-bg-elevated border border-border px-3 py-1.5 text-2xs font-mono text-text-muted rounded-bl-sm">
            <Loader2 size={12} className="animate-spin text-accent" />
            {hasResp ? 'Ajustando o plano…' : 'Analisando o orçamento…'}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-border p-2.5 shrink-0"
      >
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={hasResp ? 'Refine o agrupamento…' : 'Instrução opcional…'}
          disabled={trabalhando}
        />
        <Button type="submit" variant="default" size="icon" disabled={trabalhando || !texto.trim()}>
          <Send size={14} />
        </Button>
      </form>
    </div>
  )
}
