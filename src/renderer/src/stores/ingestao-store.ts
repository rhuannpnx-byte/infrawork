import { create } from 'zustand'
import { toast } from 'sonner'
import { queryClient } from '@/lib/query-client'
import { adminApi } from '@/lib/supabase/functions'
import {
  ingerirDocumento,
  classificarDocumentoExistente
} from '@/features/documentacao/hooks/documentos'
import type { OrigemIngestao } from '@/types/documentacao'

export type StatusJob = 'pendente' | 'processando' | 'ok' | 'erro'

export interface JobIngestao {
  id: string
  obra_id: string
  contrato_id: string
  nome: string
  tamanho: number
  /** Exatamente um dos dois: arquivo arrastado ou caminho no disco (pasta/OneDrive). */
  file?: File
  path?: string
  classificar: boolean
  indexar: boolean
  status: StatusJob
  erro?: string
}

interface IngestaoStore {
  fila: JobIngestao[]
  processando: boolean
  /** Quantos jobs já finalizaram (ok+erro) na rodada atual — base do progresso. */
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
  partes.pop() // remove o arquivo
  return partes.slice(-2).join('/') || null
}

async function lerBytes(job: JobIngestao): Promise<ArrayBuffer> {
  if (job.file) return job.file.arrayBuffer()
  if (job.path) {
    // A leitura no main HIDRATA o placeholder OneDrive (força o download).
    const { bytes } = await window.infrawork.documentacao.lerArquivoBytes(job.path)
    return new Uint8Array(bytes).buffer
  }
  throw new Error('Job sem arquivo nem caminho')
}

function semExtensao(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i > 0 ? nome.slice(0, i) : nome
}

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

/** Loop de processamento sequencial (não bloqueia a UI: tudo é I/O assíncrono). */
async function processar(): Promise<void> {
  if (useIngestaoStore.getState().processando) return
  useIngestaoStore.setState({ processando: true })

  const obrasTocadas = new Set<string>()
  let ok = 0
  let falhas = 0

  try {
    for (;;) {
      const proximo = useIngestaoStore.getState().fila.find((j) => j.status === 'pendente')
      if (!proximo) break
      marcar(proximo.id, 'processando')
      try {
        const bytes = await lerBytes(proximo)
        const { documento_id } = await ingerirDocumento({
          obra_id: proximo.obra_id,
          contrato_id: proximo.contrato_id,
          // '20 Outros' é placeholder; a IA reclassifica logo abaixo (ou o
          // usuário ajusta no Repositório).
          tipo_codigo: '20',
          titulo: semExtensao(proximo.nome),
          origem: (proximo.path ? 'directory' : 'drag_drop') as OrigemIngestao,
          bytes,
          nome_original: proximo.nome,
          mime: proximo.file?.type || null
        })
        if (proximo.classificar) {
          try {
            await classificarDocumentoExistente(
              documento_id,
              proximo.obra_id,
              pastaDoPath(proximo.path)
            )
          } catch (e) {
            console.warn('[ingestao] classificação falhou em', proximo.nome, e)
          }
        }
        if (proximo.indexar) {
          try {
            await adminApi.gerarEmbeddings({ documento_id })
          } catch (e) {
            console.warn('[ingestao] embeddings falhou em', proximo.nome, e)
          }
        }
        marcar(proximo.id, 'ok')
        obrasTocadas.add(proximo.obra_id)
        ok++
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'falha desconhecida'
        marcar(proximo.id, 'erro', msg)
        console.warn('[ingestao] falha em', proximo.nome, err)
        falhas++
      }
      useIngestaoStore.setState((s) => ({ feitos: s.feitos + 1 }))
      // Atualiza as listas conforme cada documento entra (UI sempre fresca).
      for (const obraId of obrasTocadas) {
        void queryClient.invalidateQueries({ queryKey: ['documentacao', 'documentos', obraId] })
      }
    }
  } finally {
    useIngestaoStore.setState({ processando: false })
    if (ok > 0) toast.success(`${ok} documento(s) ingerido(s).`)
    if (falhas > 0) toast.error(`${falhas} falha(s) na ingestão (ver detalhes no painel).`)
  }
}

function marcar(id: string, status: StatusJob, erro?: string): void {
  useIngestaoStore.setState((s) => ({
    fila: s.fila.map((j) => (j.id === id ? { ...j, status, erro } : j))
  }))
}
