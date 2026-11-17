import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { caminhoDoModelo, compactar, descompactar } from '../lib/arquivo'
import type { Modelo4D } from '../lib/contrato'
import {
  COLUNAS_WP,
  montarPlano,
  type LinhaSemana,
  type LinhaWp,
  type PlanoNoTempo
} from '../lib/plano'
import { prepararModelo, type ModeloPronto, type ResumoModelo } from '../lib/preparar'

const BUCKET = 'modelos-4d'

export interface ModeloRegistro {
  id: string
  obra_id: string
  nome: string
  origem: 'html' | 'iw4d'
  storage_path: string
  tamanho_bytes: number | null
  resumo: ResumoModelo
  ativo: boolean
  created_at: string
}

export interface VinculosGravados {
  eixos: { eixo: string; trecho_id: string }[]
  classes: { classe: string; item_orcamentario_id: string }[]
}

export interface ServicoDaObra {
  id: string
  codigo: string
  descricao: string
  unidade: string | null
}

export function useModelos4D(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ModeloRegistro[]>> {
  return useQuery({
    queryKey: ['modelo4d', 'lista', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ModeloRegistro[]> => {
      const { data, error } = await supabase
        .from('modelo4d')
        .select('id, obra_id, nome, origem, storage_path, tamanho_bytes, resumo, ativo, created_at')
        .eq('obra_id', obraId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ModeloRegistro[]
    }
  })
}

/** Baixa o arquivo do modelo e o expande em peças. Pesado: fica em memória enquanto a tela estiver aberta. */
export function useModeloPronto(
  registro: ModeloRegistro | null | undefined
): ReturnType<typeof useQuery<ModeloPronto>> {
  return useQuery({
    queryKey: ['modelo4d', 'arquivo', registro?.id],
    enabled: !!registro,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: async (): Promise<ModeloPronto> => {
      const { data, error } = await supabase.storage.from(BUCKET).download(registro!.storage_path)
      if (error) throw error
      return prepararModelo(JSON.parse(await descompactar(data)) as Modelo4D)
    }
  })
}

export function useVinculos4D(
  modeloId: string | null | undefined
): ReturnType<typeof useQuery<VinculosGravados>> {
  return useQuery({
    queryKey: ['modelo4d', 'vinculos', modeloId],
    enabled: !!modeloId,
    queryFn: async (): Promise<VinculosGravados> => {
      const [e, c] = await Promise.all([
        supabase.from('modelo4d_eixo').select('eixo, trecho_id').eq('modelo_id', modeloId!),
        supabase
          .from('modelo4d_vinculo')
          .select('classe, item_orcamentario_id')
          .eq('modelo_id', modeloId!)
      ])
      if (e.error) throw e.error
      if (c.error) throw c.error
      return {
        eixos: (e.data ?? []) as VinculosGravados['eixos'],
        classes: (c.data ?? []) as VinculosGravados['classes']
      }
    }
  })
}

/** Serviços diretos da obra, para o vínculo com as classes do modelo. */
export function useServicosDaObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ServicoDaObra[]>> {
  return useQuery({
    queryKey: ['modelo4d', 'servicos', obraId],
    enabled: !!obraId,
    staleTime: 60_000,
    queryFn: async (): Promise<ServicoDaObra[]> => {
      const linhas = await lerTodas<ServicoDaObra>((de, ate) =>
        supabase
          .from('item_orcamentario')
          .select('id, codigo, descricao, unidade')
          .eq('obra_id', obraId!)
          .eq('tipo', 'servico_grupo')
          .is('indireto_id', null)
          .order('id')
          .range(de, ate)
      )
      return linhas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
    }
  })
}

/** Os trechos de tarefa do plano com os instantes de início e fim, e o perfil semanal de cada tarefa. */
export function usePlanoNoTempo(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<PlanoNoTempo>> {
  return useQuery({
    queryKey: ['modelo4d', 'plano', planejamentoId],
    enabled: !!planejamentoId,
    staleTime: 60_000,
    queryFn: async (): Promise<PlanoNoTempo> => {
      const [wps, semanas] = await Promise.all([
        lerTodas<LinhaWp>((de, ate) =>
          supabase
            .from('planejamento_tarefa_wp')
            .select(COLUNAS_WP)
            .eq('planejamento_id', planejamentoId!)
            .order('tarefa_id')
            .order('ordem')
            .range(de, ate)
        ),
        lerTodas<LinhaSemana>((de, ate) =>
          supabase
            .from('planejamento_tarefa_perfil_semana')
            .select(
              'tarefa_id, semana_segunda, quantidade_planejada, tarefa:tarefa_id!inner(planejamento_id)'
            )
            .eq('tarefa.planejamento_id', planejamentoId!)
            .order('tarefa_id')
            .order('semana_segunda')
            .range(de, ate)
        )
      ])
      return montarPlano(wps, semanas)
    }
  })
}

export interface ImportarModeloEntrada {
  obraId: string
  nome: string
  origem: 'html' | 'iw4d'
  modelo: Modelo4D
  resumo: ResumoModelo
  eixos: VinculosGravados['eixos']
  classes: VinculosGravados['classes']
}

export function useImportarModelo4D(): ReturnType<
  typeof useMutation<string, Error, ImportarModeloEntrada>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: ImportarModeloEntrada): Promise<string> => {
      const id = crypto.randomUUID()
      const caminho = caminhoDoModelo(e.obraId, id)
      const arquivo = await compactar(JSON.stringify(e.modelo))
      const up = await supabase.storage
        .from(BUCKET)
        .upload(caminho, arquivo, { contentType: 'application/gzip', upsert: false })
      if (up.error) throw up.error
      const { error } = await supabase.rpc('modelo4d_registrar', {
        _obra_id: e.obraId,
        _id: id,
        _nome: e.nome,
        _origem: e.origem,
        _tamanho_bytes: arquivo.size,
        _resumo: e.resumo,
        _eixos: e.eixos,
        _vinculos: e.classes
      })
      if (error) {
        await supabase.storage.from(BUCKET).remove([caminho])
        throw error
      }
      return id
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['modelo4d'] })
  })
}

export function useVincularModelo4D(): ReturnType<
  typeof useMutation<void, Error, { modeloId: string } & VinculosGravados>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v): Promise<void> => {
      const { error } = await supabase.rpc('modelo4d_vincular', {
        _modelo_id: v.modeloId,
        _eixos: v.eixos,
        _vinculos: v.classes
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['modelo4d', 'vinculos'] })
  })
}

export function useAtivarModelo4D(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (modeloId: string): Promise<void> => {
      const { error } = await supabase.rpc('modelo4d_ativar', { _modelo_id: modeloId })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['modelo4d', 'lista'] })
  })
}

export function useExcluirModelo4D(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (modeloId: string): Promise<void> => {
      const { data, error } = await supabase.rpc('modelo4d_excluir', { _modelo_id: modeloId })
      if (error) throw error
      if (data) await supabase.storage.from(BUCKET).remove([data as string])
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['modelo4d'] })
  })
}
