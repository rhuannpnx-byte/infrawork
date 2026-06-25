import { create } from 'zustand'
import { toast } from 'sonner'
import { queryClient } from '@/lib/query-client'
import { supabase } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import {
  ingerirDocumento,
  aplicarClassificacao,
  arquivarEmGrupo,
  registrarAderencia
} from '@/features/documentacao/lib/ingest'
import { ensureTemplate } from '@/features/documentacao/hooks/template'
import { nomeCategoria } from '@/types/documentacao'

export type StatusJob = 'pendente' | 'processando' | 'ok' | 'ignorado' | 'erro'

export interface JobIngestao {
  id: string
  obra_id: string
  nome: string
  tamanho: number
  mtime: number
  /** Exatamente um dos dois: arquivo arrastado ou caminho no disco (pasta/OneDrive). */
  file?: File
  path?: string
  classificar: boolean
  indexar: boolean
  /** Inserção MANUAL: grupo escolhido pelo usuário (pula classificação, checa aderência). */
  grupo_forcado?: string
  status: StatusJob
  erro?: string
}

interface IngestaoStore {
  fila: JobIngestao[]
  processando: boolean
  feitos: number
  enfileirar: (jobs: Omit<JobIngestao, 'status'>[]) => void
  limparConcluidos: () => void
  cancelarPendentes: () => void
}

let _seq = 0
export const nextJobId = (): string => `job-${Date.now()}-${++_seq}`

/** Últimos 2 segmentos do caminho (nomenclatura da pasta) para dar contexto à IA. */
function pastaDoPath(p: string | undefined): string | null {
  if (!p) return null
  const partes = p.split(/[\\/]/).filter(Boolean)
  partes.pop()
  return partes.slice(-2).join('/') || null
}

async function lerBytes(job: JobIngestao): Promise<ArrayBuffer> {
  if (job.file) return job.file.arrayBuffer()
  if (job.path) {
    const { bytes } = await window.infrawork.documentacao.lerArquivoBytes(job.path)
    return new Uint8Array(bytes).buffer
  }
  throw new Error('Job sem arquivo nem caminho')
}

function semExtensao(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i > 0 ? nome.slice(0, i) : nome
}

const SCHEMA_VERSION = 1

export const useIngestaoStore = create<IngestaoStore>((set) => ({
  fila: [],
  processando: false,
  feitos: 0,

  enfileirar: (jobs) => {
    if (jobs.length === 0) return
    set((s) => ({ fila: [...s.fila, ...jobs.map((j) => ({ ...j, status: 'pendente' as const }))] }))
    toast.info(`Ingestão de ${jobs.length} arquivo(s) iniciada em segundo plano.`)
    void processar()
  },

  limparConcluidos: () =>
    set((s) => {
      const fila = s.fila.filter((j) => j.status === 'pendente' || j.status === 'processando')
      return { fila, feitos: fila.length === 0 ? 0 : s.feitos }
    }),

  cancelarPendentes: () => set((s) => ({ fila: s.fila.filter((j) => j.status !== 'pendente') }))
}))

function marcar(id: string, status: StatusJob, erro?: string): void {
  useIngestaoStore.setState((s) => ({
    fila: s.fila.map((j) => (j.id === id ? { ...j, status, erro } : j))
  }))
}

/** Loop sequencial (I/O assíncrono — não bloqueia a UI). Incremental via ledger. */
async function processar(): Promise<void> {
  if (useIngestaoStore.getState().processando) return
  useIngestaoStore.setState({ processando: true })

  const obrasTocadas = new Set<string>()
  let ok = 0
  let ignorados = 0
  let falhas = 0

  try {
    for (;;) {
      const job = useIngestaoStore.getState().fila.find((j) => j.status === 'pendente')
      if (!job) break
      marcar(job.id, 'processando')
      try {
        await processarJob(job)
        marcar(job.id, 'ok')
        obrasTocadas.add(job.obra_id)
        ok++
      } catch (err) {
        if (err instanceof IgnoradoError) {
          marcar(job.id, 'ignorado')
          ignorados++
        } else {
          const msg = err instanceof Error ? err.message : 'falha desconhecida'
          marcar(job.id, 'erro', msg)
          console.warn('[ingestao] falha em', job.nome, err)
          falhas++
          await registrarQuarentena(job, msg)
        }
      }
      useIngestaoStore.setState((s) => ({ feitos: s.feitos + 1 }))
    }

    // Fim do lote: resolve candidatos (âncora+dedup) → valida (R-XX) →
    // reavalia lacunas → remonta o dossiê das obras tocadas.
    for (const obraId of obrasTocadas) {
      try {
        await adminApi.resolverDossie({ obra_id: obraId })
        await adminApi.validarDossie({ obra_id: obraId })
        await adminApi.reavaliarLacunas({ obra_id: obraId })
        await adminApi.montarDossie({ obra_id: obraId, fresh: true })
      } catch (e) {
        console.warn('[ingestao] pós-processamento (resolver/validar/dossiê) falhou', e)
      }
      void queryClient.invalidateQueries({ queryKey: ['documentacao', 'dossie', obraId] })
    }
  } finally {
    useIngestaoStore.setState({ processando: false })
    if (ok > 0) toast.success(`${ok} documento(s) ingerido(s).`)
    if (ignorados > 0) toast.info(`${ignorados} já estavam no acervo (ignorados).`)
    if (falhas > 0) toast.error(`${falhas} falha(s) na ingestão (ver painel).`)
  }
}

class IgnoradoError extends Error {}

async function processarJob(job: JobIngestao): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado.')
  const fileId = `${job.obra_id}:${job.path ?? job.nome}`
  const quickFp = `${job.tamanho}-${Math.round(job.mtime)}`

  // Incremental: já no ledger com mesmo fingerprint e schema → ignora (não relê).
  const { data: led } = await supabase
    .from('ledger')
    .select('quick_fp, status, schema_version')
    .eq('file_id', fileId)
    .maybeSingle()
  if (
    led &&
    led.quick_fp === quickFp &&
    led.status === 'EXTRAIDO' &&
    led.schema_version === SCHEMA_VERSION
  ) {
    throw new IgnoradoError()
  }

  const bytes = await lerBytes(job)
  const mime = job.file?.type || null
  const { documento_id } = await ingerirDocumento({
    obra_id: job.obra_id,
    titulo: semExtensao(job.nome),
    nome_original: job.nome,
    bytes,
    mime,
    fonte_path: job.path ?? null
  })

  // 1) Camada de texto (nativo/OCR via Qwen-VL).
  let texto = ''
  try {
    const r = await adminApi.ocrTexto({ documento_id })
    texto = r.texto ?? ''
  } catch (e) {
    console.warn('[ingestao] OCR/texto falhou em', job.nome, e)
  }

  let categoriaCodigo = '20'
  let grupoCodigo = '20'
  let assinado: boolean | undefined

  if (job.grupo_forcado) {
    // 2') Inserção MANUAL: arquiva no grupo escolhido (sem classificar) e checa
    // aderência em paralelo — ORIENTA sem restringir (banner no Repositório).
    try {
      const tmpl = await ensureTemplate(job.obra_id)
      const g = tmpl.grupos.find((x) => x.codigo === job.grupo_forcado)
      grupoCodigo = job.grupo_forcado
      categoriaCodigo = g?.tipo_codigo_base ?? '20'
      await arquivarEmGrupo(documento_id, grupoCodigo, categoriaCodigo)
      void adminApi
        .verificarAderencia({
          obra_id: job.obra_id,
          grupo_codigo: grupoCodigo,
          texto: texto || undefined,
          nome: job.nome,
          pasta: pastaDoPath(job.path) ?? undefined
        })
        .then((v) => registrarAderencia(documento_id, v.confianca, v.grupo_sugerido))
        .catch((e) => console.warn('[ingestao] aderência falhou em', job.nome, e))
    } catch (e) {
      console.warn('[ingestao] arquivamento manual falhou em', job.nome, e)
    }
  } else if (job.classificar) {
    // 2) Classificação automática (conteúdo + pasta).
    try {
      const cls = await adminApi.classificarDocumento({
        obra_id: job.obra_id,
        texto: texto || undefined,
        nome: job.nome,
        pasta: pastaDoPath(job.path) ?? undefined
      })
      categoriaCodigo = cls.tipo_codigo
      grupoCodigo = cls.grupo_codigo ?? cls.tipo_codigo
      assinado = cls.sinais?.assinado
      await aplicarClassificacao(documento_id, job.obra_id, job.nome, pastaDoPath(job.path), cls)
    } catch (e) {
      console.warn('[ingestao] classificação falhou em', job.nome, e)
    }
  }

  // 3) Extração TEMPLATE-AWARE + gravação de candidatos (resolução no fim do lote).
  if (job.classificar || job.grupo_forcado) {
    try {
      await ensureTemplate(job.obra_id) // garante o template da obra antes de extrair
      const categoria = `${categoriaCodigo} ${nomeCategoria(categoriaCodigo)}`
      const ex = await adminApi.extrairDocumento({
        obra_id: job.obra_id,
        documento_id,
        categoria,
        grupo_codigo: grupoCodigo,
        texto: texto || undefined
      })
      await adminApi.consolidarDocumento({
        obra_id: job.obra_id,
        documento_id,
        categoria,
        respostas: ex.respostas ?? [],
        entradas: ex.entradas ?? [],
        confianca: ex.confianca,
        assinado
      })
    } catch (e) {
      console.warn('[ingestao] extração/consolidação falhou em', job.nome, e)
    }
  }

  // 4) Indexação (embeddings) para o RAG.
  if (job.indexar) {
    try {
      await adminApi.gerarEmbeddings({ documento_id, texto: texto || undefined })
    } catch (e) {
      console.warn('[ingestao] embeddings falhou em', job.nome, e)
    }
  }

  // Checkpoint no ledger (idempotência/incremental).
  await supabase.from('ledger').upsert(
    {
      file_id: fileId,
      obra_id: job.obra_id,
      quick_fp: quickFp,
      path: job.path ?? job.nome,
      size: job.tamanho,
      mtime: job.mtime,
      classe: 'documento',
      categoria: categoriaCodigo,
      status: 'EXTRAIDO',
      documento_id,
      schema_version: SCHEMA_VERSION,
      processed_at: new Date().toISOString(),
      last_seen: new Date().toISOString()
    },
    { onConflict: 'file_id' }
  )
}

async function registrarQuarentena(job: JobIngestao, motivo: string): Promise<void> {
  if (!supabase) return
  const fileId = `${job.obra_id}:${job.path ?? job.nome}`
  await supabase
    .from('ledger')
    .upsert(
      {
        file_id: fileId,
        obra_id: job.obra_id,
        quick_fp: `${job.tamanho}-${Math.round(job.mtime)}`,
        path: job.path ?? job.nome,
        size: job.tamanho,
        mtime: job.mtime,
        status: 'QUARENTENA',
        last_error: motivo.slice(0, 500),
        schema_version: SCHEMA_VERSION,
        last_seen: new Date().toISOString()
      },
      { onConflict: 'file_id' }
    )
    .then(
      () => {},
      () => {}
    )
}
