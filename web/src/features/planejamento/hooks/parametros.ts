/**
 * Parametrização dos serviços (`servico_parametro`, migração 0034): como cada serviço do orçamento é lançado no campo —
 * por quantidade ou por viagens, com ou sem controle de material, observação e local obrigatório. Sem linha = padrão.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export type ModoLancamento = 'quantidade' | 'viagens'
/** Viagem medida por volume ou por peso (peso exige o ticket da balança); a quantidade é lançada na unidade do serviço. */
export type MedicaoViagem = 'volume' | 'peso'

export interface ServicoParametro {
  item_orcamentario_id: string
  modo_lancamento: ModoLancamento
  controla_material: boolean
  material_recurso_id: string | null
  material_unidade: string | null
  material_obrigatorio: boolean
  habilita_obs: boolean
  exige_local: boolean
  medicao_viagem: MedicaoViagem
}

export const PARAMETRO_PADRAO: Omit<ServicoParametro, 'item_orcamentario_id'> = {
  modo_lancamento: 'quantidade',
  controla_material: false,
  material_recurso_id: null,
  material_unidade: null,
  material_obrigatorio: true,
  habilita_obs: true,
  exige_local: false,
  medicao_viagem: 'volume'
}

export interface ServicoParametrizavel {
  id: string
  codigo: string
  descricao: string
  servico_id: string
  unidade: string | null
}

export interface MaterialObra {
  id: string
  codigo: string | null
  nome: string
  unidade: string
}

export interface ConsumoMaterial {
  item_orcamentario_id: string
  recurso_id: string
  unidade: string | null
  lancamentos: number
  material_total: number
  producao_total: number
  media_por_unidade: number | null
}

const CHAVE = 'servico-parametro'

/** Serviços (agrupadores com composição) da obra — o que se lança e se planeja. */
export function useServicosParametrizaveis(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ServicoParametrizavel[]>> {
  return useQuery({
    queryKey: [CHAVE, 'servicos', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select(
          'id, codigo, descricao, servico_id, unidade_referencia, servico:servico_id(unidade)'
        )
        .eq('obra_id', obraId!)
        .eq('tipo', 'servico_grupo')
        .is('indireto_id', null)
        .not('servico_id', 'is', null)
        .order('ordem')
        .order('codigo')
      if (error) throw error
      return (data ?? []).map((r) => {
        const raw = (r as unknown as { servico: unknown }).servico
        const s = (Array.isArray(raw) ? raw[0] : raw) as { unidade: string | null } | null
        return {
          id: r.id as string,
          codigo: r.codigo as string,
          descricao: r.descricao as string,
          servico_id: r.servico_id as string,
          unidade: s?.unidade ?? (r.unidade_referencia as string | null) ?? null
        }
      })
    }
  })
}

/** Parâmetros gravados da obra, por item do orçamento (sem linha = padrão). */
export function useParametrosServicos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Map<string, ServicoParametro>>> {
  return useQuery({
    queryKey: [CHAVE, 'lista', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servico_parametro')
        .select(
          'item_orcamentario_id, modo_lancamento, controla_material, material_recurso_id, material_unidade, material_obrigatorio, habilita_obs, exige_local, medicao_viagem'
        )
        .eq('obra_id', obraId!)
      if (error) throw error
      return new Map(((data ?? []) as ServicoParametro[]).map((p) => [p.item_orcamentario_id, p]))
    }
  })
}

export function parametroDe(
  mapa: ReadonlyMap<string, ServicoParametro> | undefined,
  itemId: string
): ServicoParametro {
  return mapa?.get(itemId) ?? { item_orcamentario_id: itemId, ...PARAMETRO_PADRAO }
}

export function useMateriaisObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<MaterialObra[]>> {
  return useQuery({
    queryKey: [CHAVE, 'materiais', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recurso')
        .select('id, codigo, nome, unidade')
        .eq('obra_id', obraId!)
        .eq('grupo', 'MATERIAL')
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as MaterialObra[]
    }
  })
}

/** Média de material lançado por unidade produzida (Σ material ÷ Σ produção), por serviço e material. */
export function useConsumoMaterial(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ConsumoMaterial[]>> {
  return useQuery({
    queryKey: [CHAVE, 'consumo', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vw_servico_consumo_material')
        .select(
          'item_orcamentario_id, recurso_id, unidade, lancamentos, material_total, producao_total, media_por_unidade'
        )
        .eq('obra_id', obraId!)
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as ConsumoMaterial),
        lancamentos: Number(r.lancamentos),
        material_total: Number(r.material_total),
        producao_total: Number(r.producao_total),
        media_por_unidade: r.media_por_unidade === null ? null : Number(r.media_por_unidade)
      }))
    }
  })
}

export function useSalvarParametro(
  obraId: string
): ReturnType<typeof useMutation<void, Error, ServicoParametro>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p) => {
      const { error } = await supabase.from('servico_parametro').upsert(
        {
          ...p,
          obra_id: obraId,
          material_recurso_id: p.controla_material ? p.material_recurso_id : null,
          material_unidade: p.controla_material ? p.material_unidade : null
        },
        { onConflict: 'item_orcamentario_id' }
      )
      if (error) throw new Error(error.message)
    },
    // a grade responde na hora; erro volta ao que estava
    onMutate: async (p) => {
      const chave = [CHAVE, 'lista', obraId]
      await qc.cancelQueries({ queryKey: chave })
      const antes = qc.getQueryData<Map<string, ServicoParametro>>(chave)
      const novo = new Map(antes ?? [])
      novo.set(p.item_orcamentario_id, p)
      qc.setQueryData(chave, novo)
      return { antes }
    },
    onError: (_e, _p, ctx) => {
      const c = ctx as { antes?: Map<string, ServicoParametro> } | undefined
      if (c?.antes) qc.setQueryData([CHAVE, 'lista', obraId], c.antes)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [CHAVE] })
    }
  })
}
