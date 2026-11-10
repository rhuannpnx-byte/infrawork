/**
 * Frota (da empresa), origens e destinos da obra (+ rotas com DMT) e o registro de viagens (migração 0034).
 * A ficha e as viagens são gravadas pela mesma RPC do app de campo (`campo_sync_ficha`), idempotente pelos ids: a
 * produção do dia do serviço é recomposta no banco (Σ das viagens).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'

export type TipoVeiculo =
  | 'basculante'
  | 'carreta'
  | 'betoneira'
  | 'pipa'
  | 'caminhao'
  | 'escavadeira'
  | 'retroescavadeira'
  | 'carregadeira'
  | 'outro'
export const TIPO_VEICULO_LABEL: Record<TipoVeiculo, string> = {
  basculante: 'Basculante',
  carreta: 'Carreta',
  betoneira: 'Betoneira',
  pipa: 'Pipa',
  caminhao: 'Caminhão',
  escavadeira: 'Escavadeira',
  retroescavadeira: 'Retroescavadeira',
  carregadeira: 'Carregadeira',
  outro: 'Outro'
}
/** Máquinas que carregam ("Carregado por" na viagem); as demais transportam. */
export const TIPOS_MAQUINA_DE_CARGA: readonly TipoVeiculo[] = [
  'escavadeira',
  'retroescavadeira',
  'carregadeira'
]
export const ehMaquinaDeCarga = (v: Pick<Veiculo, 'tipo'>): boolean =>
  TIPOS_MAQUINA_DE_CARGA.includes(v.tipo)

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
  /** capacidade como está na FleetHub (valor + unidade), mesmo quando não vira m³ */
  fleet_capacidade: string | null
  /** capacidade_m3 veio da FleetHub (só muda lá) */
  capacidade_fleethub: boolean
  ativo: boolean
  origem: 'manual' | 'fleethub'
  fleet_id: number | null
  fleet_tipo: string | null
  marca: string | null
  ano: number | null
  fleet_obra_id: string | null
  fleet_status: string | null
  sincronizado_em: string | null
}

export interface FleetObra {
  id: string
  fleet_id: number
  nome: string
}

export interface FleetSyncExecucao {
  iniciado_em: string
  terminado_em: string | null
  ok: boolean | null
  mensagem: string | null
  novos: number
  atualizados: number
  inativados: number
  capacidades: number | null
}

export type TipoLocalTransporte =
  'jazida' | 'caixa_emprestimo' | 'usina' | 'central' | 'bota_fora' | 'deposito' | 'pista' | 'outro'
export const TIPO_LOCAL_LABEL: Record<TipoLocalTransporte, string> = {
  jazida: 'Jazida',
  caixa_emprestimo: 'Caixa de empréstimo',
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
  /** onde o acesso encontra o eixo (m no trecho); só fora da pista */
  estaca_acesso_m: number | null
  distancia_acesso_km: number
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
  estaca_carga_m: number | null
  estaca_descarga_m: number | null
  dmt_calculada_km: number | null
  dmt_manual: boolean
  dmt_origem: 'geometria' | 'rota' | 'manual' | null
  obs: string | null
  ordem: number
  carregador_id: string | null
}

export interface FichaViagens {
  id: string
  obra_id: string
  data: string
  veiculo_id: string | null
  motorista: string | null
  encarregado_id: string | null
  equipe_id: string | null
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
const veiculoDe = (v: Record<string, unknown>): Veiculo => ({
  ...(v as unknown as Veiculo),
  capacidade_m3: num(v.capacidade_m3)
})

export function useFrota(
  empresaId: string | null | undefined
): ReturnType<typeof useQuery<Veiculo[]>> {
  return useQuery({
    queryKey: ['frota', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const data = await lerTodas((de, ate) =>
        sb()
          .from('frota_veiculo')
          .select('*')
          .eq('empresa_id', empresaId!)
          .order('prefixo')
          .order('id')
          .range(de, ate)
      )
      return data.map(veiculoDe)
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

/** Veículos que a obra enxerga: os da FleetHub das obras vinculadas + os manuais (sem vínculo, todos). */
export function useVeiculosDaObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Veiculo[]>> {
  return useQuery({
    queryKey: ['frota', 'obra', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await sb().rpc('veiculos_da_obra', { _obra_id: obraId! })
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[])
        .map(veiculoDe)
        .sort((a, b) => a.prefixo.localeCompare(b.prefixo, 'pt-BR', { numeric: true }))
    }
  })
}

export function useAplicarCapacidadeModelo(): ReturnType<
  typeof useMutation<
    number,
    Error,
    {
      empresa_id: string
      modelo: string
      capacidade_m3: number | null
    }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ empresa_id, modelo, ...cap }) => {
      const { data, error } = await sb()
        .from('frota_veiculo')
        .update(cap)
        .eq('empresa_id', empresa_id)
        .eq('modelo', modelo)
        .eq('capacidade_fleethub', false)
        .select('id')
      if (error) throw new Error(error.message)
      return data?.length ?? 0
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['frota'] })
  })
}

// ─── FleetHub ───────────────────────────────────────────────────────────────
export function useFleetObras(
  empresaId: string | null | undefined
): ReturnType<typeof useQuery<FleetObra[]>> {
  return useQuery({
    queryKey: ['fleet-obras', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from('fleet_obra')
        .select('id, fleet_id, nome')
        .eq('empresa_id', empresaId!)
        .order('nome')
      if (error) throw error
      return (data ?? []) as FleetObra[]
    }
  })
}

export function useObraFleetObras(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<string[]>> {
  return useQuery({
    queryKey: ['obra-fleet', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from('obra_fleet_obra')
        .select('fleet_obra_id')
        .eq('obra_id', obraId!)
      if (error) throw error
      return (data ?? []).map((x) => x.fleet_obra_id as string)
    }
  })
}

export function useVincularFleetObra(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; fleet_obra_id: string; vincular: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, fleet_obra_id, vincular }) => {
      const c = sb().from('obra_fleet_obra')
      const { error } = vincular
        ? await c.insert({ obra_id, fleet_obra_id })
        : await c.delete().eq('obra_id', obra_id).eq('fleet_obra_id', fleet_obra_id)
      if (error) throw new Error(error.message)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['obra-fleet'] })
      void qc.invalidateQueries({ queryKey: ['frota'] })
    }
  })
}

export function useUltimaSyncFleet(
  empresaId: string | null | undefined
): ReturnType<typeof useQuery<FleetSyncExecucao | null>> {
  return useQuery({
    queryKey: ['fleet-sync', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from('fleet_sync_execucao')
        .select(
          'iniciado_em, terminado_em, ok, mensagem, novos, atualizados, inativados, capacidades'
        )
        .eq('empresa_id', empresaId!)
        .order('iniciado_em', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as FleetSyncExecucao | null) ?? null
    }
  })
}

export interface FleethubConfig {
  empresa_id: string
  email: string
  conectado_em: string
}

export function useFleethubConfig(
  empresaId: string | null | undefined
): ReturnType<typeof useQuery<FleethubConfig | null>> {
  return useQuery({
    queryKey: ['fleethub-config', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await sb()
        .from('fleethub_config')
        .select('empresa_id, email, conectado_em')
        .eq('empresa_id', empresaId!)
        .maybeSingle()
      if (error) throw error
      return (data as FleethubConfig | null) ?? null
    }
  })
}

type AcaoFleet =
  | { acao: 'sincronizar'; empresa_id: string }
  | { acao: 'conectar'; empresa_id: string; email: string; senha: string }
  | { acao: 'desconectar'; empresa_id: string }

/** Conectar (testa o login e guarda a senha no servidor), desconectar ou sincronizar a frota. */
export function useFleethub(): ReturnType<
  typeof useMutation<
    { novos?: number; atualizados?: number; inativados?: number; capacidades?: number | null },
    Error,
    AcaoFleet
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data, error } = await sb().functions.invoke('fleethub-sync', { body })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const corpo = ctx
          ? ((await ctx.json().catch(() => null)) as { error?: string } | null)
          : null
        throw new Error(corpo?.error ?? error.message)
      }
      if (!data?.ok) throw new Error(data?.error ?? 'Falha na FleetHub')
      return data
    },
    // cada tela mostra o erro no próprio lugar (sem o aviso global repetido)
    onError: () => undefined,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['frota'] })
      void qc.invalidateQueries({ queryKey: ['fleet-sync'] })
      void qc.invalidateQueries({ queryKey: ['fleet-obras'] })
      void qc.invalidateQueries({ queryKey: ['fleethub-config'] })
    }
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
        locais: (l.data ?? []).map((x) => ({
          ...(x as LocalTransporte),
          estaca_acesso_m: num(x.estaca_acesso_m),
          distancia_acesso_km: Number(x.distancia_acesso_km ?? 0)
        })),
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
      const data = await lerTodas((ini, fim) =>
        sb()
          .from('viagem_ficha')
          .select('*, viagens:viagem(*)')
          .eq('obra_id', obraId!)
          .gte('data', de)
          .lte('data', ate)
          .order('data', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(ini, fim)
      )
      return data.map((f) => ({
        ...(f as unknown as FichaViagens),
        viagens: ((f.viagens ?? []) as Viagem[])
          .map((v) => ({
            ...v,
            quantidade: Number(v.quantidade),
            material_qtd: num(v.material_qtd),
            dmt_km: num(v.dmt_km),
            posicao_inicio_m: num(v.posicao_inicio_m),
            posicao_fim_m: num(v.posicao_fim_m),
            estaca_carga_m: num(v.estaca_carga_m),
            estaca_descarga_m: num(v.estaca_descarga_m),
            dmt_calculada_km: num(v.dmt_calculada_km)
          }))
          .sort((a, b) => a.ordem - b.ordem)
      }))
    }
  })
}

export type ViagemInput = Pick<
  Viagem,
  | 'id'
  | 'item_orcamentario_id'
  | 'origem_id'
  | 'destino_id'
  | 'hora_carga'
  | 'hora_descarga'
  | 'material_qtd'
  | 'nf_ticket'
  | 'estaca_carga_m'
  | 'estaca_descarga_m'
  | 'quantidade'
  | 'dmt_manual'
  | 'obs'
  | 'carregador_id'
> & { dmt_km: number | null }

export type FichaInput = Omit<FichaViagens, 'origem' | 'criado_por' | 'viagens'> & {
  viagens: ViagemInput[]
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
