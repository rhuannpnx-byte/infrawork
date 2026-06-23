import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sparkles, Send, FileText, User } from 'lucide-react'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { adminApi } from '@/lib/supabase/functions'
import { abrirDocumentoPorId } from '@/features/documentacao/hooks/documentos'
import type { FonteAgente } from '@/types/documentacao'

interface Turno {
  pergunta: string
  resposta: string | null
  fontes: FonteAgente[]
  erro?: string
}

export function DocumentacaoBuscaPage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Agente documental">
      <RequireObra pageTitle="Agente documental">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

const SUGESTOES = [
  'Qual o valor vigente e o % aditado deste contrato?',
  'Quais licenças e garantias estão previstas e seus prazos?',
  'Qual a multa por atraso e a regra de reajuste?',
  'Quem são os responsáveis técnicos e suas ARTs?'
]

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const [pergunta, setPergunta] = useState('')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [carregando, setCarregando] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  const enviar = async (texto: string): Promise<void> => {
    const q = texto.trim()
    if (!q || carregando) return
    setPergunta('')
    setTurnos((t) => [...t, { pergunta: q, resposta: null, fontes: [] }])
    setCarregando(true)
    try {
      const res = await adminApi.perguntarDocumento({ obra_id: obraId, pergunta: q })
      setTurnos((t) =>
        t.map((turno, i) =>
          i === t.length - 1 ? { ...turno, resposta: res.resposta, fontes: res.fontes } : turno
        )
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao consultar o agente'
      setTurnos((t) =>
        t.map((turno, i) => (i === t.length - 1 ? { ...turno, resposta: '', erro: msg } : turno))
      )
    } finally {
      setCarregando(false)
      requestAnimationFrame(() => fimRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    void enviar(pergunta)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Agente documental"
        subtitle="Pergunte ao acervo da obra — respostas com citação das fontes (RAG sobre os documentos indexados)."
      />
      <div className="flex-1 overflow-auto p-4">
        {turnos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <EmptyState
              icon="sparkles"
              title="Converse com o acervo"
              description="As respostas usam apenas os documentos ingeridos e indexados desta obra, sempre citando as fontes."
            />
            <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void enviar(s)}
                  className="text-2xs font-mono text-text-muted border border-border rounded px-2 py-1 hover:border-border-accent hover:text-text transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {turnos.map((t, i) => (
              <div key={i} className="space-y-2">
                {/* Pergunta */}
                <div className="flex items-start gap-2 justify-end">
                  <div className="rounded border border-border bg-bg-panel px-3 py-2 text-xs text-text max-w-[80%]">
                    {t.pergunta}
                  </div>
                  <div className="w-6 h-6 shrink-0 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-text-dim">
                    <User size={12} />
                  </div>
                </div>
                {/* Resposta */}
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 shrink-0 rounded-full bg-accent-glow border border-accent-line flex items-center justify-center text-accent">
                    <Sparkles size={12} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    {t.resposta === null && !t.erro ? (
                      <div className="text-2xs font-mono text-text-dim">Consultando o acervo…</div>
                    ) : t.erro ? (
                      <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-2xs font-mono text-danger">
                        {t.erro}
                      </div>
                    ) : (
                      <>
                        <div className="rounded border border-border bg-bg-panel px-3 py-2 text-xs text-text whitespace-pre-wrap leading-relaxed">
                          {t.resposta}
                        </div>
                        {t.fontes.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-2xs font-mono text-text-dim">Fontes:</span>
                            {t.fontes.map((f) => (
                              <button
                                key={f.n}
                                type="button"
                                onClick={() =>
                                  void abrirDocumentoPorId(f.documento_id).then((ok) => {
                                    if (!ok) toast.error('Não foi possível abrir o documento.')
                                  })
                                }
                                title={`${f.tipo_codigo ?? ''} · similaridade ${(f.similaridade * 100).toFixed(0)}%`}
                              >
                                <Badge variant="outline" className="hover:border-border-accent">
                                  <FileText size={9} /> [{f.n}]{' '}
                                  {f.titulo ?? f.documento_id.slice(0, 8)}
                                </Badge>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={fimRef} />
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="border-t border-border p-3">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <Input
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            placeholder="Pergunte algo sobre os contratos e documentos desta obra…"
            disabled={carregando}
            autoFocus
          />
          <Button
            type="submit"
            variant="default"
            size="md"
            disabled={carregando || !pergunta.trim()}
          >
            <Send size={13} /> {carregando ? 'Enviando…' : 'Perguntar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
