// Capacidades da empresa e conectores com sistemas externos (o SIGA é o primeiro).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { capacidadeLigada, CHAVES_CAPACIDADE, type Capacidade } from '@/config/capacidades'

/** O que está ligado para a empresa, já com o padrão do catálogo para o que não tem linha. */
export function useCapacidades(
  empresaId: string | null | undefined
): ReturnType<typeof useQuery<Record<Capacidade, boolean>>> {
  return useQuery({
    queryKey: ['capacidades', empresaId],
    enabled: !!empresaId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresa_capacidade')
        .select('chave, valor')
        .eq('empresa_id', empresaId!)
      if (error) throw error
      const gravadas = new Map((data ?? []).map((l) => [l.chave as string, l.valor as unknown]))
      return Object.fromEntries(
        CHAVES_CAPACIDADE.map((c) => [c, capacidadeLigada(c, gravadas.get(c))])
      ) as Record<Capacidade, boolean>
    }
  })
}

/** Liga ou desliga uma capacidade da empresa (só o god: é o que foi contratado). */
export function useDefinirCapacidade(): ReturnType<
  typeof useMutation<void, Error, { empresa_id: string; chave: Capacidade; ligada: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ empresa_id, chave, ligada }) => {
      const { error } = await supabase
        .from('empresa_capacidade')
        .upsert({ empresa_id, chave, valor: ligada }, { onConflict: 'empresa_id,chave' })
      if (error) throw error
    },
    onSuccess: (_r, v) => {
      // a tela mostra o novo valor na hora; a releitura confirma
      qc.setQueryData<Record<Capacidade, boolean>>(['capacidades', v.empresa_id], (antes) =>
        antes ? { ...antes, [v.chave]: v.ligada } : antes
      )
      void qc.invalidateQueries({ queryKey: ['capacidades', v.empresa_id] })
    }
  })
}

export interface Integracao {
  id: string
  empresa_id: string
  tipo: 'siga'
  config: { host?: string; porta?: number; banco?: string; usuario?: string }
  ativa: boolean
  conectado_em: string
}

export function useIntegracao(
  empresaId: string | null | undefined,
  tipo: Integracao['tipo']
): ReturnType<typeof useQuery<Integracao | null>> {
  return useQuery({
    queryKey: ['integracao', empresaId, tipo],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracao')
        .select('id, empresa_id, tipo, config, ativa, conectado_em')
        .eq('empresa_id', empresaId!)
        .eq('tipo', tipo)
        .maybeSingle()
      if (error) throw error
      return (data as Integracao | null) ?? null
    }
  })
}

/** O que o diagnóstico do SIGA devolve: a estrutura das tabelas e como elas estão preenchidas. */
export interface DiagnosticoSiga {
  banco: string
  versao: string
  usuario: string
  permissoes: string[]
  tabelas: Array<{ tabela: string; linhas: string | null }>
  tabelas_detalhadas: string[]
  colunas: Array<{ tabela: string; coluna: string; tipo: string; nulo: string; chave: string }>
  chaves_estrangeiras: Array<{ tabela: string; coluna: string; ref_tabela: string }>
  gatilhos: unknown[]
  uso: Record<string, { linhas_lidas: number } | undefined>
  tem_producao: boolean
  tem_foto: boolean
}

export interface ExecucaoIntegracao {
  id: string
  acao: string
  iniciado_em: string
  terminado_em: string | null
  ok: boolean | null
  erro: string | null
  resumo: DiagnosticoSiga | null
}

/** A última execução de uma ação do conector (hoje, o diagnóstico). */
export function useUltimaExecucao(
  integracaoId: string | null | undefined,
  acao: string
): ReturnType<typeof useQuery<ExecucaoIntegracao | null>> {
  return useQuery({
    queryKey: ['integracao-execucao', integracaoId, acao],
    enabled: !!integracaoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracao_execucao')
        .select('id, acao, iniciado_em, terminado_em, ok, erro, resumo')
        .eq('integracao_id', integracaoId!)
        .eq('acao', acao)
        .order('iniciado_em', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as ExecucaoIntegracao | null) ?? null
    }
  })
}

export interface CredencialSigaForm {
  host: string
  porta: number | null
  banco: string
  usuario: string
  senha: string
}

type AcaoSiga =
  | ({ acao: 'conectar'; empresa_id: string } & CredencialSigaForm)
  | { acao: 'desconectar'; empresa_id: string }
  | { acao: 'diagnostico'; empresa_id: string }

/** Chama o conector do SIGA no servidor. O erro vem com a mensagem pronta para a tela. */
export function useSiga(): ReturnType<
  typeof useMutation<{ ok: true; resumo?: DiagnosticoSiga }, Error, AcaoSiga>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data, error } = await supabase.functions.invoke('siga', { body })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const corpo = ctx
          ? ((await ctx.json().catch(() => null)) as { error?: string } | null)
          : null
        throw new Error(corpo?.error ?? error.message)
      }
      if (!data?.ok) throw new Error(data?.error ?? 'Falha no conector do SIGA')
      return data
    },
    // cada tela mostra o erro no próprio lugar (sem o aviso global repetido)
    onError: () => undefined,
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['integracao', v.empresa_id] })
      void qc.invalidateQueries({ queryKey: ['integracao-execucao'] })
    }
  })
}
