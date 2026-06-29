import { useRef, useState, useEffect, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Document, Page, pdfjs } from 'react-pdf'
import { FileText, ChevronLeft, ChevronRight, Loader2, X, Sparkles, Send, Info } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useDossie } from '@/features/documentacao/hooks/dossie'
import { getDocumentoSignedUrl } from '@/features/documentacao/lib/ingest'
import { adminApi } from '@/lib/supabase/functions'
import { useDocumentacaoUIStore } from '@/stores/documentacao-ui-store'
import { nomeCategoria } from '@/types/documentacao'
import type { DossieDocumento, FonteAgente } from '@/types/documentacao'

// Worker do pdf.js empacotado pelo Vite (renderiza o PDF dentro do app).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

type Aba = 'meta' | 'chat'

/**
 * Visualizador de documentos como MODAL global do módulo Documentação. Montado
 * uma única vez no layout; abre a qualquer tempo via `abrir(docId, pagina)`
 * (Repositório, Cláusulas, Conversar). Renderiza o PDF real + painel com
 * metadados e RAG por documento (perguntar sobre ESTE documento).
 */
export function VisualizadorModal(): ReactNode {
  const aberto = useDocumentacaoUIStore((s) => s.aberto)
  const docId = useDocumentacaoUIStore((s) => s.docId)
  const pagina = useDocumentacaoUIStore((s) => s.pagina)
  const fechar = useDocumentacaoUIStore((s) => s.fechar)
  const abrir = useDocumentacaoUIStore((s) => s.abrir)

  const scope = useCurrentScope()
  const obraId = scope.obraId ?? null
  const { data: dossie } = useDossie(aberto ? obraId : null)

  const doc = docId ? (dossie?.documentos.find((d) => d.doc_id === docId) ?? null) : null

  const [aba, setAba] = useState<Aba>('meta')

  const { data: url, isFetching } = useQuery({
    queryKey: ['documentacao', 'signed', doc?.storage_bucket, doc?.storage_key],
    enabled: aberto && !!doc?.storage_bucket && !!doc?.storage_key,
    staleTime: 50 * 60 * 1000,
    queryFn: () => getDocumentoSignedUrl(doc!.storage_bucket!, doc!.storage_key!)
  })

  if (!aberto) return null

  const isPdf =
    !!doc &&
    ((doc.mime ?? '').includes('pdf') || (doc.storage_key ?? '').toLowerCase().endsWith('.pdf'))

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()} size="full" hideClose>
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <FileText size={14} className="text-text-dim shrink-0" />
        <span className="flex-1 truncate text-sm font-medium text-text">
          {doc ? (doc.titulo ?? doc.nome) : 'Visualizador'}
        </span>
        {doc ? (
          <span className="text-2xs font-mono text-text-dim shrink-0">
            {doc.tipo_codigo} {nomeCategoria(doc.tipo_codigo)}
          </span>
        ) : null}
        <button
          type="button"
          aria-label="Fechar"
          onClick={() => fechar()}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {!doc ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-2xs font-mono text-text-dim">
          {dossie ? 'Documento não encontrado no dossiê.' : 'Carregando documento…'}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[1.6fr_1fr]">
          <div className="min-h-0 bg-[#1a2433] border-r border-border">
            {!url ? (
              <div className="flex items-center justify-center h-full text-2xs font-mono text-text-dim">
                {isFetching ? 'Gerando link do arquivo…' : 'Arquivo indisponível.'}
              </div>
            ) : isPdf ? (
              <PdfViewer
                key={`${doc.doc_id}:${pagina ?? 1}`}
                url={url}
                paginaInicial={pagina ?? 1}
              />
            ) : (
              <NaoPdf url={url} mime={doc.mime ?? null} />
            )}
          </div>

          <div className="min-h-0 flex flex-col">
            <div className="flex border-b border-border shrink-0">
              <TabBtn ativo={aba === 'meta'} onClick={() => setAba('meta')}>
                <Info size={12} /> Resumo
              </TabBtn>
              <TabBtn ativo={aba === 'chat'} onClick={() => setAba('chat')}>
                <Sparkles size={12} /> Perguntar
              </TabBtn>
            </div>
            {aba === 'meta' ? (
              <MetaPanel doc={doc} />
            ) : (
              <DocChat
                key={doc.doc_id}
                obraId={obraId}
                doc={doc}
                onAbrirFonte={(d, p) => abrir(d, p)}
              />
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function TabBtn({
  ativo,
  onClick,
  children
}: {
  ativo: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
        ativo ? 'text-accent border-b-2 border-accent' : 'text-text-dim hover:text-text'
      )}
    >
      {children}
    </button>
  )
}

function MetaPanel({ doc }: { doc: DossieDocumento }): ReactNode {
  return (
    <div className="min-h-0 overflow-auto p-4">
      <Meta k="Categoria" v={`${doc.tipo_codigo} ${nomeCategoria(doc.tipo_codigo)}`} />
      <Meta k="Espécie" v={doc.especie ?? '—'} />
      <Meta k="Origem" v={doc.nome ?? '—'} />
      <Meta
        k="Camada de texto"
        v={doc.ocr ? 'Escaneado (OCR)' : doc.texto_layer ? 'Nato-digital (texto)' : '—'}
      />
      <Meta k="Assinado" v={doc.assinado ? 'Sim' : 'Não'} />
      {doc.validade ? <Meta k="Validade" v={doc.validade} /> : null}
      <div className="mt-3">
        {doc.assinado ? (
          <Badge variant="success">Assinado</Badge>
        ) : (
          <Badge variant="warn">Sem assinatura</Badge>
        )}
      </div>
    </div>
  )
}

interface Turno {
  pergunta: string
  resposta: string | null
  fontes: FonteAgente[]
  erro?: string
}

/** RAG escopado ao documento aberto (documento_id) — responde só sobre ele. */
function DocChat({
  obraId,
  doc,
  onAbrirFonte
}: {
  obraId: string | null
  doc: DossieDocumento
  onAbrirFonte: (docId: string | null, pagina: number | null) => void
}): ReactNode {
  const [pergunta, setPergunta] = useState('')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [carregando, setCarregando] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  const enviar = async (texto: string): Promise<void> => {
    const q = texto.trim()
    if (!q || carregando || !obraId) return
    setPergunta('')
    setTurnos((t) => [...t, { pergunta: q, resposta: null, fontes: [] }])
    setCarregando(true)
    try {
      const res = await adminApi.perguntarDocumento({
        obra_id: obraId,
        pergunta: q,
        documento_id: doc.doc_id
      })
      setTurnos((t) =>
        t.map((turno, i) =>
          i === t.length - 1 ? { ...turno, resposta: res.resposta, fontes: res.fontes } : turno
        )
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao consultar o documento'
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
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {turnos.length === 0 ? (
          <p className="text-2xs text-text-dim leading-relaxed mt-2">
            Pergunte algo sobre <b className="text-text-muted">este documento</b>. A resposta usa
            apenas o conteúdo dele e cita a página.
          </p>
        ) : (
          turnos.map((t, i) => (
            <div key={i} className="space-y-1.5">
              <div className="rounded border border-border bg-bg-panel px-2.5 py-1.5 text-xs text-text">
                {t.pergunta}
              </div>
              {t.resposta === null && !t.erro ? (
                <div className="text-2xs font-mono text-text-dim flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" /> Consultando o documento…
                </div>
              ) : t.erro ? (
                <div className="rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-2xs font-mono text-danger">
                  {t.erro}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="rounded border border-accent-line bg-accent-glow/40 px-2.5 py-1.5 text-xs text-text whitespace-pre-wrap leading-relaxed">
                    {t.resposta}
                  </div>
                  {t.fontes.filter((f) => f.pagina != null).length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.fontes
                        .filter((f) => f.pagina != null)
                        .map((f) => (
                          <button
                            key={f.n}
                            type="button"
                            onClick={() => onAbrirFonte(f.documento_id, f.pagina)}
                            title="Abrir nesta página"
                          >
                            <Badge variant="outline" className="hover:border-border-accent">
                              <FileText size={9} /> p.{f.pagina}
                            </Badge>
                          </button>
                        ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={fimRef} />
      </div>
      <form onSubmit={onSubmit} className="border-t border-border p-2.5 flex items-center gap-2">
        <Input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Perguntar sobre este documento…"
          disabled={carregando}
        />
        <Button type="submit" variant="default" size="sm" disabled={carregando || !pergunta.trim()}>
          <Send size={12} />
        </Button>
      </form>
    </div>
  )
}

function PdfViewer({ url, paginaInicial }: { url: string; paginaInicial: number }): ReactNode {
  const [numPaginas, setNumPaginas] = useState(0)
  const [pagina, setPagina] = useState(paginaInicial)
  const [largura, setLargura] = useState(720)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setLargura(Math.max(280, Math.floor(w - 32)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={boxRef} className="flex-1 min-h-0 overflow-auto flex justify-center py-4">
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPaginas(numPages)}
          loading={
            <div className="flex items-center gap-2 text-2xs font-mono text-text-dim mt-6">
              <Loader2 size={13} className="animate-spin" /> Carregando PDF…
            </div>
          }
          error={
            <div className="text-2xs font-mono text-danger mt-6">Não foi possível abrir o PDF.</div>
          }
        >
          <Page
            pageNumber={Math.min(Math.max(pagina, 1), numPaginas || 1)}
            width={largura}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        </Document>
      </div>
      {numPaginas > 0 ? (
        <div className="flex items-center justify-center gap-3 border-t border-border py-1.5 text-2xs font-mono text-text-muted">
          <button
            type="button"
            className="hover:text-text disabled:opacity-40"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">
            {Math.min(pagina, numPaginas)} / {numPaginas}
          </span>
          <button
            type="button"
            className="hover:text-text disabled:opacity-40"
            onClick={() => setPagina((p) => Math.min(numPaginas, p + 1))}
            disabled={pagina >= numPaginas}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function NaoPdf({ url, mime }: { url: string; mime: string | null }): ReactNode {
  if ((mime ?? '').startsWith('image/')) {
    return (
      <div className="h-full overflow-auto flex items-start justify-center p-3">
        <img src={url} alt="documento" className="max-w-full" />
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-2xs font-mono text-text-dim px-4 text-center">
      <FileText size={20} />
      Pré-visualização não disponível para este tipo ({mime ?? '—'}).
      <span>Planilhas/Office: use o conteúdo indexado pelo Agente.</span>
    </div>
  )
}

function Meta({ k, v }: { k: string; v: ReactNode }): ReactNode {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-border/60 text-xs">
      <span className="text-text-muted">{k}</span>
      <span className="text-text text-right max-w-[60%]">{v}</span>
    </div>
  )
}
