import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FolderOpen, CloudOff, UploadCloud, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useIngestaoStore, nextJobId, type JobIngestao } from '@/stores/ingestao-store'

interface Candidato {
  id: string
  kind: 'path' | 'file'
  nome: string
  tamanho: number
  online_only: boolean
  // exatamente um dos dois
  path?: string
  file?: File
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  contratoId: string
}

let _seq = 0
const nextId = (): string => `cand-${++_seq}`

/** Limite de tamanho padrão (MB) — ajustável na UI. */
const LIMITE_MB_PADRAO = 50

function fmtTamanho(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function IngestaoDialog({ open, onOpenChange, obraId, contratoId }: Props): ReactNode {
  const enfileirar = useIngestaoStore((s) => s.enfileirar)
  const [candidatos, setCandidatos] = useState<Candidato[]>([])
  const [classificarIa, setClassificarIa] = useState(true)
  const [indexarIa, setIndexarIa] = useState(true)
  const [limiteMb, setLimiteMb] = useState(LIMITE_MB_PADRAO)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = (): void => {
    setCandidatos([])
    setClassificarIa(true)
    setIndexarIa(true)
    setLimiteMb(LIMITE_MB_PADRAO)
    setError(null)
    setScanning(false)
  }

  const escolherPasta = useCallback(async () => {
    setError(null)
    const sel = await window.infrawork.documentacao.escolherPasta()
    if (sel.canceled || !sel.path) return
    setScanning(true)
    try {
      const res = await window.infrawork.documentacao.varrerPasta(sel.path)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const novos: Candidato[] = res.result.arquivos.map((a) => ({
        id: nextId(),
        kind: 'path',
        nome: a.nome,
        tamanho: a.tamanho,
        online_only: a.online_only,
        path: a.path
      }))
      setCandidatos((prev) => [...prev, ...novos])
      if (res.result.online_only > 0) {
        toast.info(
          `${res.result.online_only} arquivo(s) estão "apenas online" no OneDrive — serão hidratados (baixados) ao ingerir.`
        )
      }
    } finally {
      setScanning(false)
    }
  }, [])

  const adicionarFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const novos: Candidato[] = arr.map((f) => ({
      id: nextId(),
      kind: 'file',
      nome: f.name,
      tamanho: f.size,
      online_only: false,
      file: f
    }))
    setCandidatos((prev) => [...prev, ...novos])
  }, [])

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) adicionarFiles(e.dataTransfer.files)
  }

  const remover = (id: string): void => setCandidatos((prev) => prev.filter((c) => c.id !== id))

  /**
   * Enfileira os candidatos aptos na fila de ingestão em segundo plano e fecha
   * o diálogo na hora — o processamento (leitura/hidratação, upload, classificação
   * e embeddings) roda fora da UI; o progresso aparece no indicador flutuante.
   */
  const enviarParaFila = (): void => {
    if (candidatos.length === 0) return
    setError(null)
    const limiteBytes = limiteMb * 1024 * 1024
    const aIngerir = candidatos.filter((c) => c.tamanho <= limiteBytes)
    const pulados = candidatos.length - aIngerir.length
    if (aIngerir.length === 0) {
      setError(`Todos os arquivos excedem o limite de ${limiteMb} MB.`)
      return
    }
    const jobs: Omit<JobIngestao, 'status'>[] = aIngerir.map((c) => ({
      id: nextJobId(),
      obra_id: obraId,
      contrato_id: contratoId,
      nome: c.nome,
      tamanho: c.tamanho,
      file: c.file,
      path: c.path,
      classificar: classificarIa,
      indexar: indexarIa
    }))
    enfileirar(jobs)
    if (pulados > 0)
      toast.warning(`${pulados} arquivo(s) ignorado(s) por excederem ${limiteMb} MB.`)
    reset()
    onOpenChange(false)
  }

  const ocupado = scanning
  const onlineCount = candidatos.filter((c) => c.online_only).length
  const limiteBytes = limiteMb * 1024 * 1024
  const excedentes = candidatos.filter((c) => c.tamanho > limiteBytes).length
  const aptos = candidatos.length - excedentes

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="xl"
      disableDismiss={ocupado}
    >
      <DialogHeader>
        <DialogTitle>Ingestão de documentos</DialogTitle>
        <DialogDescription>
          Aponte uma pasta (local, rede ou OneDrive sincronizado) ou arraste arquivos. Arquivos
          OneDrive “apenas online” são hidratados automaticamente ao ingerir. O original na origem
          nunca é alterado (WORM).
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={escolherPasta}
            disabled={ocupado}
          >
            <FolderOpen size={12} /> Escolher pasta
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={ocupado}
          >
            <UploadCloud size={12} /> Selecionar arquivos
          </Button>
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
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-2xs font-mono text-text-muted select-none">
            Tamanho máx.
            <input
              type="number"
              min={1}
              max={2048}
              step={1}
              value={limiteMb}
              onChange={(e) => setLimiteMb(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
              disabled={ocupado}
              className="w-16 rounded border border-border bg-bg px-1.5 py-0.5 text-right text-text tabular-nums focus:border-accent focus:outline-none"
            />
            MB
          </label>
        </div>
        <p className="text-2xs text-text-dim font-mono">
          A categoria é definida pela IA (ou ajustada depois no Repositório). Arquivos acima do
          limite são ignorados na ingestão.
        </p>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-2xs font-mono text-text-muted select-none">
            <input
              type="checkbox"
              checked={classificarIa}
              onChange={(e) => setClassificarIa(e.target.checked)}
              disabled={ocupado}
              className="accent-[color:var(--accent)]"
            />
            Classificar com IA (usa o conteúdo do documento + a nomenclatura da pasta)
          </label>
          <label className="flex items-center gap-2 text-2xs font-mono text-text-muted select-none">
            <input
              type="checkbox"
              checked={indexarIa}
              onChange={(e) => setIndexarIa(e.target.checked)}
              disabled={ocupado}
              className="accent-[color:var(--accent)]"
            />
            Indexar para busca por IA (OCR + embeddings) — habilita o agente documental
          </label>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'rounded border border-dashed px-4 py-6 text-center text-xs transition-colors',
            dragOver ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-muted'
          )}
        >
          Arraste arquivos aqui
        </div>

        {/* Lista de candidatos */}
        {candidatos.length > 0 ? (
          <div className="rounded border border-border">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border text-2xs font-mono text-text-dim">
              <span>
                {aptos} de {candidatos.length} arquivo(s)
                {onlineCount > 0 ? ` · ${onlineCount} apenas online` : ''}
                {excedentes > 0 ? ` · ${excedentes} acima de ${limiteMb} MB` : ''}
              </span>
              <button
                type="button"
                className="hover:text-text"
                onClick={() => setCandidatos([])}
                disabled={ocupado}
              >
                Limpar lista
              </button>
            </div>
            <div className="max-h-72 overflow-auto divide-y divide-border">
              {candidatos.map((c) => {
                const excede = c.tamanho > limiteBytes
                return (
                  <div
                    key={c.id}
                    className={cn('flex items-center gap-2 px-3 py-1.5', excede && 'opacity-60')}
                  >
                    <span
                      className="flex-1 min-w-0 truncate text-xs text-text"
                      title={c.path ?? c.nome}
                    >
                      {c.nome}
                    </span>
                    <span className="text-2xs font-mono text-text-dim tabular-nums shrink-0">
                      {fmtTamanho(c.tamanho)}
                    </span>
                    {excede ? (
                      <Badge
                        variant="danger"
                        title={`Acima do limite de ${limiteMb} MB — será ignorado`}
                      >
                        grande
                      </Badge>
                    ) : null}
                    {c.online_only ? (
                      <Badge variant="warn" title="OneDrive: apenas online — será hidratado">
                        <CloudOff size={9} /> online
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Remover"
                      className="text-text-dim hover:text-danger shrink-0"
                      onClick={() => remover(c.id)}
                      disabled={ocupado}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {scanning ? (
          <div className="text-2xs font-mono text-text-muted">Varrendo pasta…</div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={ocupado}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={enviarParaFila}
          disabled={ocupado || aptos === 0}
        >
          <UploadCloud size={13} /> {`Ingerir ${aptos || ''} em 2º plano`}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
