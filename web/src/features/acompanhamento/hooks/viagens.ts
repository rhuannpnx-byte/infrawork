/**
 * Frota (da empresa), origens e destinos da obra (+ rotas com DMT) e o registro de viagens (migração 0034).
 * A ficha e as viagens são gravadas pela mesma RPC do app de campo (`campo_sync_ficha`), idempotente pelos ids: a
 * produção do dia do serviço é recomposta no banco (Σ das viagens).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

export type TipoVeiculo = 'basculante' | 'carreta' | 'betoneira' | 'pipa' | 'caminhao' | 'outro'
export const TIPO_VEICULO_LABEL: Record<TipoVeiculo, string> = {
  basculante: 'Basculante',
  carreta: 'Carreta',
  betoneira: 'Betoneira',
  pipa: 'Pipa',
  caminhao: 'Caminhão',
  outro: 'Outro'
}

export interface Veiculo {
  id: string
  empresa_id: string
  prefixo: string
  placa: string | null
  tipo: TipoVeiculo
  modelo: string | null
  proprietario: 'proprio' | 'terceiro'
  fornecedor: string | null
  capacidade_m3: number | null
  capacidade_t: number | null
  ativo: boolean
}

export type TipoLocalTransporte =
  'jazida' | 'usina' | 'central' | 'bota_fora' | 'deposito' | 'pista' | 'outro'
export const TIPO_LOCAL_LABEL: Record<TipoLocalTransporte, string> = {
  jazida: 'Jazida',
  usina: 'Usina',
  central: 'Central de concreto',
  bota_fora: 'Bota-fora',
  deposito: 'Depósito',
  pista: 'Pista',
  outro: 'Outro'
}

export interface LocalTransporte {
  id: string
  obra_id: string
  nome: string
  tipo: TipoLocalTransporte
  trecho_id: string | null
  ativo: boolean
}

export interface RotaTransporte {
  id: string
  origem_id: string
  destino_id: string
  dmt_km: number
}

export interface Viagem {
  id: string
  item_orcamentario_id: string
  origem_id: string | null
  destino_id: string | null
  hora_carga: string | null
  hora_descarga: string | null
  quantidade: number
  material_qtd: number | null
  dmt_km: number | null
  nf_ticket: string | null
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  obs: string | null
  ordem: number
}

export interface FichaViagens {
  id: string
  obra_id: string
  data: string
  veiculo_id: string | null
  motorista: string | null
  encarregado_id: string | null
  equipe_id: string | null
  km_inicial: number | null
  km_final: number | null
  obs: string | null
  origem: 'web' | 'campo'
  criado_por: string | null
  viagens: Viagem[]
}

function sb(): NonNullable<typeof supabase> {
  if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
  return supabase
}
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

// ─── frota ──────────────────────────────────────────────────────────────────
export function useFrota(
  empresaId: string | null | undefined
): ReturnType<typeof useQuery<Veiculo[]>> {
  return useQuery({
    queryKey: ['frota', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from('frota_veiculo')
        .select('*')
        .eq('empresa_id', empresaId!)
        .order('prefixo')
      if (error) throw error
      return (data ?? []).map((v) => ({
        ...(v as Veiculo),
        capacidade_m3: num(v.capacidade_m3),
        capacidade_t: num(v.capacidade_t)
      }))
    }
  })
}

export function useSalvarVeiculo(): ReturnType<
  typeof useMutation<void, Error, Partial<Veiculo> & { empresa_id: string; prefixo: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v) => {
      const { id, ...campos } = v
      const r = id
        ? await sb().from('frota_veiculo').update(campos).eq('id', id)
        : await sb().from('frota_veiculo').insert(campos)
      if (r.error)
        throw new Error(
          /duplicate|unique/.test(r.error.message)
            ? `Já existe um veículo com o prefixo ${v.prefixo}.`
            : r.error.message
        )
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['frota'] })
  })
}

export function useExcluirVeiculo(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await sb().from('frota_veiculo').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['frota'] })
  })
}

// ─── origens, destinos e rotas ──────────────────────────────────────────────
export function useLocaisTransporte(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<{ locais: LocalTransporte[]; rotas: RotaTransporte[] }>> {
  return useQuery({
    queryKey: ['transporte', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const [l, r] = await Promise.all([
        sb().from('transporte_local').select('*').eq('obra_id', obraId!).order('nome'),
        sb()
          .from('transporte_rota')
          .select('id, origem_id, destino_id, dmt_km')
          .eq('obra_id', obraId!)
      ])
      if (l.error) throw l.error
      if (r.error) throw r.error
      return {
        locais: (l.data ?? []) as LocalTransporte[],
        rotas: (r.data ?? []).map((x) => ({ ...(x as RotaTransporte), dmt_km: Number(x.dmt_km) }))
      }
    }
  })
}

export function useSalvarLocalTransporte(): ReturnType<
  typeof useMutation<void, Error, Partial<LocalTransporte> & { obra_id: string; nome: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v) => {
      const { id, ...campos } = v
      const r = id
        ? await sb().from('transporte_local').update(campos).eq('id', id)
        : await sb().from('transporte_local').insert(campos)
      if (r.error)
        throw new Error(
          /duplicate|unique/.test(r.error.message)
            ? `Já existe um local chamado "${v.nome}".`
            : r.error.message
        )
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['transporte'] })
  })
}

export function useExcluirLocalTransporte(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await sb().from('transporte_local').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['transporte'] })
  })
}

export function useSalvarRota(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { obra_id: string; origem_id: string; destino_id: string; dmt_km: number | null }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r) => {
      const c = sb()
      const res =
        r.dmt_km === null
          ? await c
              .from('transporte_rota')
              .delete()
              .eq('origem_id', r.origem_id)
              .eq('destino_id', r.destino_id)
          : await c.from('transporte_rota').upsert(r, { onConflict: 'origem_id,destino_id' })
      if (res.error) throw new Error(res.error.message)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['transporte'] })
  })
}

// ─── fichas e viagens ───────────────────────────────────────────────────────
export function useFichasViagens(
  obraId: string | null | undefined,
  de: string,
  ate: string
): ReturnType<typeof useQuery<FichaViagens[]>> {
  return useQuery({
    queryKey: ['viagens', obraId, de, ate],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from('viagem_ficha')
        .select('*, viagens:viagem(*)')
        .eq('obra_id', obraId!)
        .gte('data', de)
        .lte('data', ate)
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((f) => ({
        ...(f as FichaViagens),
        km_inicial: num(f.km_inicial),
        km_final: num(f.km_final),
        viagens: ((f.viagens ?? []) as Viagem[])
          .map((v) => ({
            ...v,
            quantidade: Number(v.quantidade),
            material_qtd: num(v.material_qtd),
            dmt_km: num(v.dmt_km),
            posicao_inicio_m: num(v.posicao_inicio_m),
            posicao_fim_m: num(v.posicao_fim_m)
          }))
          .sort((a, b) => a.ordem - b.ordem)
      }))
    }
  })
}

export type FichaInput = Omit<FichaViagens, 'origem' | 'criado_por' | 'viagens'> & {
  viagens: Omit<Viagem, 'ordem'>[]
}

/** Grava a ficha e as viagens (mesma RPC do app de campo, origem 'web'). */
export function useSalvarFicha(): ReturnType<typeof useMutation<void, Error, FichaInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f) => {
      const { error } = await sb().rpc('campo_sync_ficha', { _ficha: { ...f, origem: 'web' } })
      if (error) throw new Error(error.message)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['viagens'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
    }
  })
}

export function useExcluirFicha(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await sb().from('viagem_ficha').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['viagens'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
    }
  })
}
