import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Document, Page, pdfjs } from 'react-pdf'
import { FileText, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useDossie } from '@/features/documentacao/hooks/dossie'
import { getDocumentoSignedUrl } from '@/features/documentacao/lib/ingest'
import { useDocumentacaoUIStore } from '@/stores/documentacao-ui-store'
import { nomeCategoria } from '@/types/documentacao'

// Worker do pdf.js empacotado pelo Vite (renderiza o PDF dentro do app).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

/**
 * Visualizador de documentos como MODAL global do módulo Documentação. Montado
 * uma única vez no layout; abre a qualquer tempo via `abrir(docId, pagina)`
 * (Repositório, Cláusulas, Conversar). Renderiza o PDF real dentro do app.
 */
export function VisualizadorModal(): ReactNode {
  const aberto = useDocumentacaoUIStore((s) => s.aberto)
  const docId = useDocumentacaoUIStore((s) => s.docId)
  const pagina = useDocumentacaoUIStore((s) => s.pagina)
  const fechar = useDocumentacaoUIStore((s) => s.fechar)

  const scope = useCurrentScope()
  const obraId = scope.obraId ?? null
  const { data: dossie } = useDossie(aberto ? obraId : null)

  const doc = docId ? (dossie?.documentos.find((d) => d.doc_id === docId) ?? null) : null

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
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()} size="full">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 pr-9">
        <FileText size={14} className="text-text-dim shrink-0" />
        <span className="flex-1 truncate text-sm font-medium text-text">
          {doc ? (doc.titulo ?? doc.nome) : 'Visualizador'}
        </span>
        {doc ? (
          <span className="text-2xs font-mono text-text-dim shrink-0">
            {doc.tipo_codigo} {nomeCategoria(doc.tipo_codigo)}
          </span>
        ) : null}
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

          <div className="min-h-0 overflow-auto p-4">
            <h3 className="text-sm font-semibold text-text mb-2">Metadados extraídos</h3>
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
        </div>
      )}
    </Dialog>
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
