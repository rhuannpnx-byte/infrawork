import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FolderOpen, UploadCloud, CloudOff, FileText, Eye, ArrowRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIngestaoStore, nextJobId, type JobIngestao } from '@/stores/ingestao-store'
import { nomeCategoria, type DossieDocumento } from '@/types/documentacao'
import { useTemplate } from '@/features/documentacao/hooks/template'
import { arquivarEmGrupo, registrarAderencia } from '@/features/documentacao/lib/ingest'
import type { AbrirFonte } from '@/features/documentacao/components/DocPage'

const LIMITE_MB = 50

interface Props {
  obraId: string
  documentos: DossieDocumento[]
  abrirFonte: AbrirFonte
}

export function RepositorioTab({ obraId, documentos, abrirFonte }: Props): ReactNode {
  const enfileirar = useIngestaoStore((s) => s.enfileirar)
  const processando = useIngestaoStore((s) => s.processando)
  const { data: template } = useTemplate(obraId)
  const grupos = useMemo(() => template?.grupos ?? [], [template])
  const nomeGrupo = (cod: string | null | undefined): string =>
    grupos.find((g) => g.codigo === cod)?.nome ?? nomeCategoria(cod)
  const [arquivarEm, setArquivarEm] = useState('') // '' = classificar automaticamente
  const [resolvidos, setResolvidos] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const orientar = async (
    docId: string,
    acao: 'mover' | 'manter',
    sugerido: string | null
  ): Promise<void> => {
    try {
      if (acao === 'mover' && sugerido) {
        const base = grupos.find((g) => g.codigo === sugerido)?.tipo_codigo_base ?? '20'
        await arquivarEmGrupo(docId, sugerido, base)
        await registrarAderencia(docId, 1, null)
        toast.success(`Movido para "${nomeGrupo(sugerido)}".`)
      } else {
        await registrarAderencia(docId, 1, null)
      }
      setResolvidos((p) => new Set(p).add(docId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar')
    }
  }

  const porCategoria = useMemo(() => {
    const map = new Map<string, DossieDocumento[]>()
    for (const d of documentos) {
      const k = d.tipo_codigo ?? '20'
      const arr = map.get(k) ?? []
      arr.push(d)
      map.set(k, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [documentos])

  const enfileirarArquivos = (jobs: Omit<JobIngestao, 'status'>[]): void => {
    const limite = LIMITE_MB * 1024 * 1024
    const aptos = jobs.filter((j) => j.tamanho <= limite)
    const pulados = jobs.length - aptos.length
    if (aptos.length) enfileirar(aptos)
    if (pulados > 0) toast.warning(`${pulados} arquivo(s) acima de ${LIMITE_MB} MB ignorado(s).`)
  }

  const escolherPasta = async (): Promise<void> => {
    const sel = await window.infrawork.documentacao.escolherPasta()
    if (sel.canceled || !sel.path) return
    const res = await window.infrawork.documentacao.varrerPasta(sel.path)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.result.online_only > 0)
      toast.info(
        `${res.result.online_only} arquivo(s) "apenas online" serão hidratados ao ingerir.`
      )
    enfileirarArquivos(
      res.result.arquivos.map((a) => ({
        id: nextJobId(),
        obra_id: obraId,
        nome: a.nome,
        tamanho: a.tamanho,
        mtime: a.mtime,
        path: a.path,
        classificar: !arquivarEm,
        grupo_forcado: arquivarEm || undefined,
        indexar: true
      }))
    )
  }

  const adicionarFiles = (files: FileList | File[]): void => {
    enfileirarArquivos(
      Array.from(files).map((f) => ({
        id: nextJobId(),
        obra_id: obraId,
        nome: f.name,
        tamanho: f.size,
        mtime: f.lastModified,
        file: f,
        classificar: !arquivarEm,
        grupo_forcado: arquivarEm || undefined,
        indexar: true
      }))
    )
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) adicionarFiles(e.dataTransfer.files)
  }

  return (
    <div className="h-full overflow-auto p-5 space-y-4">
      {/* Ingestão */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void escolherPasta()}
          disabled={processando}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-panel px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:border-border-accent disabled:opacity-50"
        >
          <FolderOpen size={13} /> Escolher pasta
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={processando}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-panel px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:border-border-accent disabled:opacity-50"
        >
          <UploadCloud size={13} /> Selecionar arquivos
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) adicionarFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <label className="flex items-center gap-1.5 text-2xs">
          <span className="text-text-dim">Arquivar em</span>
          <select
            value={arquivarEm}
            onChange={(e) => setArquivarEm(e.target.value)}
            className="rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
          >
            <option value="">Classificar automaticamente</option>
            {[...grupos]
              .sort((a, b) => a.ordem - b.ordem)
              .map((g) => (
                <option key={g.codigo} value={g.codigo}>
                  {g.nome}
                </option>
              ))}
          </select>
        </label>
        <span className="text-2xs font-mono text-text-dim ml-auto">
          {documentos.length} documentos
        </span>
      </div>

      {arquivarEm ? (
        <p className="text-2xs text-text-dim -mt-2">
          Inserção manual em <b className="text-accent">{nomeGrupo(arquivarEm)}</b>: o documento é
          arquivado nesse grupo e a IA apenas <b>orienta</b> se parecer não aderir (nunca bloqueia).
        </p>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-lg border border-dashed px-4 py-5 text-center text-xs transition-colors',
          dragOver ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-dim'
        )}
      >
        Arraste documentos (ou pastas inteiras) aqui — a IA classifica, extrai e indexa em segundo
        plano. WORM: o original nunca é alterado. Limite {LIMITE_MB} MB.
      </div>

      {/* Lista por categoria */}
      {documentos.length === 0 ? (
        <p className="text-xs text-text-dim">Nenhum documento ingerido ainda.</p>
      ) : (
        porCategoria.map(([cat, docs]) => (
          <div key={cat} className="rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-1.5 bg-bg-panel border-b border-border text-2xs font-mono font-bold uppercase tracking-wide text-accent/90">
              {cat} {nomeCategoria(cat)} · {docs.length}
            </div>
            <div className="divide-y divide-border/60">
              {docs.map((d) => {
                const sugerido = d.aderencia_grupo_sugerido
                const orientacao =
                  sugerido &&
                  sugerido !== (d.grupo_codigo ?? d.tipo_codigo) &&
                  !resolvidos.has(d.doc_id)
                return (
                  <div key={d.doc_id}>
                    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover">
                      <FileText size={13} className="shrink-0 text-text-dim" />
                      <span className="flex-1 min-w-0 truncate text-xs text-text">
                        {d.titulo ?? d.nome}
                      </span>
                      {d.ocr ? (
                        <span className="text-[9px] font-mono text-violet-300">OCR</span>
                      ) : d.texto_layer ? (
                        <span className="text-[9px] font-mono text-text-dim">TEXTO</span>
                      ) : null}
                      {d.storage_key == null ? <CloudOff size={11} className="text-warn" /> : null}
                      {d.assinado ? (
                        <span className="text-[9px] font-mono text-success">ASSINADO</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => abrirFonte(d.doc_id, null)}
                        className="inline-flex items-center gap-1 text-2xs text-accent hover:underline shrink-0"
                      >
                        <Eye size={11} /> Abrir
                      </button>
                    </div>
                    {orientacao ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-warn/10 border-t border-warn/20 text-2xs">
                        <span className="text-warn">
                          Parece ser de <b>{nomeGrupo(sugerido)}</b>.
                        </span>
                        <button
                          type="button"
                          onClick={() => void orientar(d.doc_id, 'mover', sugerido)}
                          className="inline-flex items-center gap-1 rounded border border-accent/50 px-1.5 py-0.5 text-accent hover:bg-accent/10"
                        >
                          <ArrowRight size={10} /> Mover
                        </button>
                        <button
                          type="button"
                          onClick={() => void orientar(d.doc_id, 'manter', sugerido)}
                          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-text-dim hover:text-text"
                        >
                          <Check size={10} /> Manter aqui
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
