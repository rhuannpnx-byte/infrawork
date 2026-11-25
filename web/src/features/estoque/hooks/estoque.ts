// Controle de estoque da obra: ativos (tanques e depósitos) com saldo, extrato, movimentos e leituras.
// O saldo e a diferença de cada leitura saem das views do banco (vw_estoque_saldo e vw_estoque_extrato): a regra
// fica num lugar só. A gravação é direta nas tabelas; a regra de acesso do banco decide quem pode.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import type { AtivoEstoque, AtivoInput, LeituraInput, LinhaExtrato, MovimentoInput } from '../tipos'

const n = (v: unknown): number => Number(v ?? 0) || 0
const nOuNulo = (v: unknown): number | null => (v == null ? null : Number(v))

/** As colunas numéricas chegam como texto do PostgREST: vira número aqui, uma vez. */
function ativoDaLinha(l: Record<string, unknown>): AtivoEstoque {
  return {
    ...(l as unknown as AtivoEstoque),
    capacidade: n(l.capacidade),
    estoque_minimo: n(l.estoque_minimo),
    lat: n(l.lat),
    lng: n(l.lng),
    altura_referencia_cm: nOuNulo(l.altura_referencia_cm),
    densidade_kg_l: nOuNulo(l.densidade_kg_l),
    saldo: nOuNulo(l.saldo),
    nivel: nOuNulo(l.nivel),
    leitura_quantidade: nOuNulo(l.leitura_quantidade),
    leitura_diferenca: nOuNulo(l.leitura_diferenca),
    leitura_cm: nOuNulo(l.leitura_cm),
    nivel_cm: nOuNulo(l.nivel_cm),
    saidas_14d: n(l.saidas_14d),
    autonomia_dias: nOuNulo(l.autonomia_dias)
  }
}

/** Ativos de estoque da obra, com saldo, nível, status e última leitura. */
export function useAtivosEstoque(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<AtivoEstoque[]>> {
  return useQuery({
    queryKey: ['estoque', 'ativos', obraId],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<AtivoEstoque[]> => {
      const { data, error } = await supabase
        .from('vw_estoque_saldo')
        .select('*')
        .eq('obra_id', obraId!)
        .order('tipo', { ascending: false })
        .order('nome')
      if (error) throw error
      return ((data ?? []) as Array<Record<string, unknown>>).map(ativoDaLinha)
    }
  })
}

/** Extrato do ativo: movimentos e leituras, do mais recente ao mais antigo, com o saldo depois de cada linha. */
export function useExtratoEstoque(
  ativoId: string | null | undefined
): ReturnType<typeof useQuery<LinhaExtrato[]>> {
  return useQuery({
    queryKey: ['estoque', 'extrato', ativoId],
    enabled: !!ativoId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<LinhaExtrato[]> => {
      // lista que cresce: lida inteira, em páginas, com a ordem fechada pelo id
      const linhas = await lerTodas<Record<string, unknown>>((de, ate) =>
        supabase
          .from('vw_estoque_extrato')
          .select('*')
          .eq('ativo_id', ativoId!)
          .order('ordem', { ascending: false })
          .order('id')
          .range(de, ate)
      )
      return linhas.map((l) => ({
        ...(l as unknown as LinhaExtrato),
        quantidade: n(l.quantidade),
        quantidade_informada: nOuNulo(l.quantidade_informada),
        densidade_kg_l: nOuNulo(l.densidade_kg_l),
        leitura_cm: nOuNulo(l.leitura_cm),
        nivel_cm: nOuNulo(l.nivel_cm),
        temperatura_c: nOuNulo(l.temperatura_c),
        saldo: n(l.saldo),
        diferenca: nOuNulo(l.diferenca)
      }))
    }
  })
}

/** A tabela de arqueação do tanque (litros a cada 1 cm). Lida à parte: são centenas de números por tanque. */
export function useTabelaTanque(
  ativoId: string | null | undefined
): ReturnType<typeof useQuery<number[]>> {
  return useQuery({
    queryKey: ['estoque', 'tabela', ativoId],
    enabled: !!ativoId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await supabase
        .from('estoque_ativo')
        .select('tabela')
        .eq('id', ativoId!)
        .maybeSingle()
      if (error) throw error
      return ((data as { tabela: Array<number | string> | null } | null)?.tabela ?? []).map(Number)
    }
  })
}

/** Estoque muda o saldo, o extrato e a prontidão visual da tela: relê tudo do estoque. */
function invalidar(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['estoque'] })
}

export function useSalvarAtivo(): ReturnType<
  typeof useMutation<string, Error, { id?: string; dados: AtivoInput }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, dados }): Promise<string> => {
      if (id) {
        // a obra e o tipo não mudam depois de criado
        const { obra_id: _obra, tipo: _tipo, ...mudancas } = dados
        void _obra
        void _tipo
        const { error } = await supabase.from('estoque_ativo').update(mudancas).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('estoque_ativo')
        .insert(dados)
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => invalidar(qc)
  })
}

export function useExcluirAtivo(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id): Promise<void> => {
      const { error } = await supabase.from('estoque_ativo').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidar(qc)
  })
}

export function useLancarMovimento(): ReturnType<typeof useMutation<void, Error, MovimentoInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dados): Promise<void> => {
      const { error } = await supabase.from('estoque_movimento').insert(dados)
      if (error) throw error
    },
    onSuccess: () => invalidar(qc)
  })
}

export function useRegistrarLeitura(): ReturnType<typeof useMutation<void, Error, LeituraInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dados): Promise<void> => {
      // no tanque a quantidade é calculada pelo banco; a coluna é obrigatória, então vai zero
      const { error } = await supabase
        .from('estoque_leitura')
        .insert({ ...dados, quantidade: dados.quantidade ?? 0 })
      if (error) throw error
    },
    onSuccess: () => invalidar(qc)
  })
}

/** Exclui uma linha do extrato (movimento ou leitura). */
export function useExcluirLinhaExtrato(): ReturnType<
  typeof useMutation<void, Error, { origem: 'movimento' | 'leitura'; id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ origem, id }): Promise<void> => {
      const { error } = await supabase
        .from(origem === 'movimento' ? 'estoque_movimento' : 'estoque_leitura')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidar(qc)
  })
}
