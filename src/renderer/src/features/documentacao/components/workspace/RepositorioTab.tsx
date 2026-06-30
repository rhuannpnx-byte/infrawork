import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  UploadCloud,
  CloudOff,
  FileText,
  Eye,
  ArrowRight,
  Check,
  Trash2,
  Plus,
  Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { queryClient } from '@/lib/query-client'
import { adminApi } from '@/lib/supabase/functions'
import { useIngestaoStore, nextJobId, type JobIngestao } from '@/stores/ingestao-store'
import { nomeCategoria, type DossieDocumento } from '@/types/documentacao'
import { gruposAplicaveis, type GrupoTemplate } from '@/types/documentacao-template'
import { useTemplate } from '@/features/documentacao/hooks/template'
import { useObraPerfil } from '@/features/documentacao/hooks/perfil'
import { arquivarEmGrupo, registrarAderencia } from '@/features/documentacao/lib/ingest'
import { ReprocessarButton } from '@/features/documentacao/components/workspace/ReprocessarButton'
import type { AbrirFonte } from '@/features/documentacao/components/DocPage'

const LIMITE_MB = 50
const OUTROS = '__outros'

const CRIT_LABEL: Record<string, string> = {
  essencial: 'Essencial',
  recomendado: 'Recomendado',
  condicional: 'Condicional',
  operacional: 'Operacional',
  final: 'Final',
  apoio: 'Apoio'
}

interface Props {
  obraId: string
  documentos: DossieDocumento[]
  abrirFonte: AbrirFonte
}

export function RepositorioTab({ obraId, documentos, abrirFonte }: Props): ReactNode {
  const enfileirar = useIngestaoStore((s) => s.enfileirar)
  const { data: template } = useTemplate(obraId)
  const { data: perfil } = useObraPerfil(obraId)
  const confirm = useConfirm()

  const [resolvidos, setResolvidos] = useState<Set<string>>(new Set())
  const [removendo, setRemovendo] = useState<string | null>(null)
  const [dragGrupo, setDragGrupo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const grupoAlvo = useRef<string | null>(null)

  // Estrutura esperada: grupos aplicáveis (consórcio/natureza/órgão), ordenados.
  const grupos = useMemo<GrupoTemplate[]>(() => {
    const all = template?.grupos ?? []
    const aplic = perfil ? gruposAplicaveis(all, perfil) : all
    return [...aplic].sort((a, b) => a.ordem - b.ordem)
  }, [template, perfil])

  const nomeGrupo = (cod: string | null | undefined): string =>
    (template?.grupos ?? []).find((g) => g.codigo === cod)?.nome ?? nomeCategoria(cod)

  // Documentos por grupo (pela escolha do usuário em grupo_codigo). O que não
  // casar um grupo aplicável cai em "Fora da estrutura" — nada some.
  const docsPorGrupo = useMemo(() => {
    const codigos = new Set(grupos.map((g) => g.codigo))
    const map = new Map<string, DossieDocumento[]>()
    for (const d of documentos) {
      const key = d.grupo_codigo && codigos.has(d.grupo_codigo) ? d.grupo_codigo : OUTROS
      const arr = map.get(key) ?? []
      arr.push(d)
      map.set(key, arr)
    }
    return map
  }, [documentos, grupos])

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
        await queryClient.invalidateQueries({ queryKey: ['documentacao', 'dossie', obraId] })
        toast.success(`Movido para "${nomeGrupo(sugerido)}".`)
      } else {
        await registrarAderencia(docId, 1, null)
      }
      setResolvidos((p) => new Set(p).add(docId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar')
    }
  }

  const enfileirarFiles = (files: FileList | File[], grupo: string): void => {
    const limite = LIMITE_MB * 1024 * 1024
    const todos = Array.from(files)
    const aptos = todos.filter((f) => f.size <= limite)
    if (aptos.length) {
      enfileirar(
        aptos.map<Omit<JobIngestao, 'status'>>((f) => ({
          id: nextJobId(),
          obra_id: obraId,
          nome: f.name,
          tamanho: f.size,
          mtime: f.lastModified,
          file: f,
          grupo_forcado: grupo,
          indexar: true
        }))
      )
    }
    const pulados = todos.length - aptos.length
    if (pulados > 0) toast.warning(`${pulados} arquivo(s) acima de ${LIMITE_MB} MB ignorado(s).`)
  }

  const pedirArquivos = (grupo: string): void => {
    grupoAlvo.current = grupo
    inputRef.current?.click()
  }

  const onDrop = (e: DragEvent, grupo: string): void => {
    e.preventDefault()
    setDragGrupo(null)
    if (e.dataTransfer.files?.length) enfileirarFiles(e.dataTransfer.files, grupo)
  }

  const remover = async (d: DossieDocumento): Promise<void> => {
    const ok = await confirm({
      title: 'Remover documento?',
      description: `"${d.titulo ?? d.nome ?? 'documento'}" será apagado do acervo e do arquivo (storage). Os dados extraídos dele saem do dossiê após o reprocessamento.`,
      variant: 'danger',
      confirmLabel: 'Remover'
    })
    if (!ok) return
    setRemovendo(d.doc_id)
    try {
      await adminApi.removerDocumento({ obra_id: obraId, documento_id: d.doc_id })
      // Re-resolve o dossiê (mesma cadeia do fim de lote da ingestão).
      await adminApi.resolverDossie({ obra_id: obraId })
      await adminApi.validarDossie({ obra_id: obraId })
      await adminApi.reavaliarLacunas({ obra_id: obraId })
      await adminApi.montarDossie({ obra_id: obraId, fresh: true })
      await queryClient.invalidateQueries({ queryKey: ['documentacao', 'dossie', obraId] })
      toast.success('Documento removido.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover o documento')
    } finally {
      setRemovendo(null)
    }
  }

  const docRow = (d: DossieDocumento, grupoCod: string): ReactNode => {
    const sugerido = d.aderencia_grupo_sugerido
    const orientacao =
      sugerido && sugerido !== (d.grupo_codigo ?? d.tipo_codigo) && !resolvidos.has(d.doc_id)
    const isRemovendo = removendo === d.doc_id
    return (
      <div key={d.doc_id}>
        <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover">
          <FileText size={13} className="shrink-0 text-text-dim" />
          <span className="flex-1 min-w-0 truncate text-xs text-text">{d.titulo ?? d.nome}</span>
          {d.ocr ? (
            <span className="text-[9px] font-mono text-violet-300">OCR</span>
          ) : d.texto_layer ? (
            <span className="text-[9px] font-mono text-text-dim">TEXTO</span>
          ) : null}
          {d.storage_key == null ? <CloudOff size={11} className="text-warn" /> : null}
          {d.assinado ? <span className="text-[9px] font-mono text-success">ASSINADO</span> : null}
          <button
            type="button"
            onClick={() => abrirFonte(d.doc_id, null)}
            className="inline-flex items-center gap-1 text-2xs text-accent hover:underline shrink-0"
          >
            <Eye size={11} /> Abrir
          </button>
          <button
            type="button"
            disabled={isRemovendo}
            onClick={() => void remover(d)}
            title="Remover documento"
            className="inline-flex items-center gap-1 text-2xs text-text-dim hover:text-danger shrink-0 disabled:opacity-50"
          >
            {isRemovendo ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
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
              <Check size={10} /> Manter em {nomeGrupo(grupoCod)}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  const outros = docsPorGrupo.get(OUTROS) ?? []

  return (
    <div className="h-full overflow-auto p-5 space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length && grupoAlvo.current)
            enfileirarFiles(e.target.files, grupoAlvo.current)
          grupoAlvo.current = null
          e.target.value = ''
        }}
      />

      <div className="flex items-center justify-between">
        <p className="text-2xs text-text-dim">
          Insira cada documento no grupo correspondente da estrutura esperada. A IA apenas{' '}
          <b>orienta</b> a aderência (nunca bloqueia). WORM: o original nunca é alterado. Limite{' '}
          {LIMITE_MB} MB.
        </p>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <span className="text-2xs font-mono text-text-dim">{documentos.length} documentos</span>
          {documentos.length > 0 ? <ReprocessarButton obraId={obraId} /> : null}
        </div>
      </div>

      {grupos.map((g) => {
        const docs = docsPorGrupo.get(g.codigo) ?? []
        const faltante =
          docs.length === 0 && (g.criticidade === 'essencial' || g.criticidade === 'recomendado')
        const isDrag = dragGrupo === g.codigo
        return (
          <div
            key={g.codigo}
            onDragOver={(e) => {
              e.preventDefault()
              setDragGrupo(g.codigo)
            }}
            onDragLeave={() => setDragGrupo((c) => (c === g.codigo ? null : c))}
            onDrop={(e) => onDrop(e, g.codigo)}
            className={cn(
              'rounded-lg border overflow-hidden transition-colors',
              isDrag ? 'border-accent bg-accent-glow' : 'border-border'
            )}
          >
            <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-panel border-b border-border">
              <span className="text-xs font-semibold text-text truncate">{g.nome}</span>
              <Badge variant="outline" className="text-[9px]">
                {CRIT_LABEL[g.criticidade] ?? g.criticidade}
              </Badge>
              {docs.length > 0 ? (
                <span className="text-2xs font-mono text-text-dim">{docs.length}</span>
              ) : faltante ? (
                <span className="text-2xs font-mono text-warn">faltante</span>
              ) : (
                <span className="text-2xs font-mono text-text-dim">vazio</span>
              )}
              <button
                type="button"
                onClick={() => pedirArquivos(g.codigo)}
                className="ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-text-muted hover:text-text hover:border-border-accent"
              >
                <Plus size={11} /> Adicionar
              </button>
            </div>
            {g.regras ? (
              <p className="px-3 pt-1.5 text-[10px] text-text-dim leading-snug">{g.regras}</p>
            ) : null}
            {docs.length ? (
              <div className="divide-y divide-border/60">
                {docs.map((d) => docRow(d, g.codigo))}
              </div>
            ) : (
              <div className="px-3 py-2 text-2xs text-text-dim flex items-center gap-1.5">
                <UploadCloud size={12} /> Arraste aqui ou use “Adicionar”.
              </div>
            )}
          </div>
        )
      })}

      {outros.length ? (
        <div className="rounded-lg border border-warn/40 overflow-hidden">
          <div className="px-3 py-1.5 bg-warn/10 border-b border-warn/20 text-2xs font-mono font-bold uppercase tracking-wide text-warn">
            Fora da estrutura · {outros.length}
          </div>
          <div className="divide-y divide-border/60">{outros.map((d) => docRow(d, OUTROS))}</div>
        </div>
      ) : null}

      {grupos.length === 0 ? (
        <p className="text-xs text-text-dim">
          Template sem grupos. Configure a estrutura em “Template de extração”.
        </p>
      ) : null}
    </div>
  )
}
