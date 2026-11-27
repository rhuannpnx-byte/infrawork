// Capacidades da empresa e conectores com sistemas externos (o SIGA é o primeiro).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useCurrentScope } from '@/hooks/useCurrentScope'
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

// ── Capacidades do escopo atual (o menu esconde o que a empresa não tem) ──────────────────────────────────────

/** As capacidades da empresa em uso (a do usuário, ou a que o god escolheu). `null` enquanto carrega. */
export function useCapacidadesDoEscopo(): Record<Capacidade, boolean> | null {
  const { empresaId } = useCurrentScope()
  return useCapacidades(empresaId).data ?? null
}

// ── Vínculo da obra com o SIGA e de-para ───────────────────────────────────────────────────────────────────

/** Chama o conector e devolve o corpo; o erro vem com a mensagem pronta para a tela. */
async function chamarSiga<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('siga', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const corpo = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null
    throw new Error(corpo?.error ?? error.message)
  }
  if (!data?.ok) throw new Error(data?.error ?? 'Falha no conector do SIGA')
  return data as T
}

export interface ResumoSyncSiga {
  lidos: number
  novos: number
  alterados: number
  iguais: number
  removidos: number
  erros: Array<{ externo_id: number; erro: string }>
}

export interface VinculoSiga {
  obra_id: string
  externo_projeto_id: number
  externo_projeto_codigo: string | null
  data_corte: string | null
  gravacao: 'desligada' | 'simulacao' | 'ligada'
  ultimo_sync_em: string | null
  ultimo_sync_ok: boolean | null
  ultimo_sync_resumo: ResumoSyncSiga | null
  ultimo_sync_erro: string | null
}

/** O vínculo da obra com um projeto do SIGA, ou null se a produção dela é lançada aqui. */
export function useVinculoSiga(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<VinculoSiga | null>> {
  return useQuery({
    queryKey: ['siga', 'vinculo', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracao_obra')
        .select(
          'obra_id, externo_projeto_id, externo_projeto_codigo, data_corte, gravacao, ultimo_sync_em, ultimo_sync_ok, ultimo_sync_resumo, ultimo_sync_erro'
        )
        .eq('obra_id', obraId!)
        .maybeSingle()
      if (error) throw error
      return (data as VinculoSiga | null) ?? null
    }
  })
}

export type TipoDePara = 'servico' | 'equipe' | 'encarregado' | 'local'

export interface DeParaSiga {
  tipo: TipoDePara
  externo_id: number
  externo_nome: string
  externo_unidade: string | null
  interno_id: string | null
  fator_conversao: number
  principal: boolean
  ignorado: boolean
}

export function useDeParaSiga(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<DeParaSiga[]>> {
  return useQuery({
    queryKey: ['siga', 'de-para', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracao_de_para')
        .select(
          'tipo, externo_id, externo_nome, externo_unidade, interno_id, fator_conversao, principal, ignorado'
        )
        .eq('obra_id', obraId!)
        .order('externo_nome')
        .limit(2000)
      if (error) throw error
      return (data ?? []).map((d) => ({
        ...d,
        externo_id: Number(d.externo_id),
        fator_conversao: Number(d.fator_conversao)
      })) as DeParaSiga[]
    }
  })
}

export interface CadastroSiga {
  id: number
  nome: string
  lancamentos: number
  ultimo: string | null
  unidade?: string | null
  material?: string | null
  encarregado_id?: number | null
  encarregado?: string | null
}
export interface CadastrosSiga {
  servicos: CadastroSiga[]
  equipes: CadastroSiga[]
  encarregados: CadastroSiga[]
  locais: CadastroSiga[]
}

/** O que o projeto usa no SIGA (lido de lá na hora). */
export function useCadastrosSiga(
  obraId: string | null | undefined,
  ativo: boolean
): ReturnType<typeof useQuery<CadastrosSiga>> {
  return useQuery({
    queryKey: ['siga', 'cadastros', obraId],
    enabled: !!obraId && ativo,
    staleTime: 5 * 60_000,
    queryFn: () => chamarSiga<CadastrosSiga>({ acao: 'cadastros', obra_id: obraId })
  })
}

export interface ProjetoSiga {
  id: number
  codigo: string
  obras: string | null
}

export function useProjetosSiga(
  obraId: string | null | undefined,
  ativo: boolean
): ReturnType<typeof useQuery<ProjetoSiga[]>> {
  return useQuery({
    queryKey: ['siga', 'projetos', obraId],
    enabled: !!obraId && ativo,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await chamarSiga<{ projetos: ProjetoSiga[] }>({ acao: 'projetos', obra_id: obraId }))
        .projetos
  })
}

export interface OpcaoInterna {
  id: string
  nome: string
}

/** Os cadastros do InfraWork que recebem o vínculo: serviços do orçamento com composição, equipes, encarregados e locais. */
export function useInternosDaObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Record<TipoDePara, OpcaoInterna[]>>> {
  return useQuery({
    queryKey: ['siga', 'internos', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const [servicos, equipes, encarregados, locais] = await Promise.all([
        supabase
          .from('item_orcamentario')
          .select('id, descricao, unidade_referencia')
          .eq('obra_id', obraId!)
          .eq('tipo', 'servico_grupo')
          .not('servico_id', 'is', null)
          .order('descricao'),
        supabase.from('equipe').select('id, nome').eq('obra_id', obraId!).order('nome'),
        supabase.from('encarregado').select('id, nome').eq('obra_id', obraId!).order('nome'),
        supabase.from('obra_trecho').select('id, nome').eq('obra_id', obraId!).order('ordem')
      ])
      for (const r of [servicos, equipes, encarregados, locais]) if (r.error) throw r.error
      return {
        servico: (servicos.data ?? []).map((s) => ({
          id: s.id as string,
          nome: `${s.descricao}${s.unidade_referencia ? ` (${s.unidade_referencia})` : ''}`
        })),
        equipe: (equipes.data ?? []) as OpcaoInterna[],
        encarregado: (encarregados.data ?? []) as OpcaoInterna[],
        local: (locais.data ?? []) as OpcaoInterna[]
      }
    }
  })
}

export type AcaoVinculoSiga =
  | {
      acao: 'vincular'
      obra_id: string
      projeto_id: number
      projeto_codigo: string
      data_corte: string | null
    }
  | { acao: 'desvincular'; obra_id: string }
  | { acao: 'sincronizar'; obra_id: string }
  | { acao: 'de_para'; obra_id: string; linhas: Array<Record<string, unknown>> }

export interface RetornoVinculoSiga {
  resumo?: ResumoSyncSiga
  criados?: number
  gravados?: number
}

/** As gravações do vínculo. Tudo que muda aqui muda a produção da obra: as telas de produção são relidas. */
export function useVinculoSigaAcao(): ReturnType<
  typeof useMutation<RetornoVinculoSiga, Error, AcaoVinculoSiga>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a) => {
      if (a.acao === 'sincronizar')
        return chamarSiga<RetornoVinculoSiga>({ acao: 'sincronizar', obra_id: a.obra_id })
      const chamada =
        a.acao === 'vincular'
          ? supabase.rpc('siga_vincular_obra', {
              _obra_id: a.obra_id,
              _projeto_id: a.projeto_id,
              _projeto_codigo: a.projeto_codigo,
              _data_corte: a.data_corte
            })
          : a.acao === 'desvincular'
            ? supabase.rpc('siga_desvincular_obra', { _obra_id: a.obra_id })
            : supabase.rpc('siga_de_para_salvar', { _obra_id: a.obra_id, _linhas: a.linhas })
      const { data, error } = await chamada
      if (error) throw new Error(error.message)
      return (data ?? {}) as RetornoVinculoSiga
    },
    // cada tela mostra o erro no próprio lugar
    onError: () => undefined,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['siga'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
      void qc.invalidateQueries({ queryKey: ['prontidao'] })
    }
  })
}

// ── Usuários do SIGA ───────────────────────────────────────────────────────────────────────────────────────

export interface UsuarioSiga {
  id: number
  login: string
  nome: string
}

export interface VinculoUsuarioSiga {
  user_id: string
  externo_id: number
  externo_login: string
  externo_nome: string
  /** `login`: entra no app de campo com o usuário do SIGA; `vinculo`: conta do InfraWork ligada pelo administrador. */
  origem: 'login' | 'vinculo'
  /** Continua ativo no SIGA (conferido na entrada e a cada rodada automática). */
  ativo: boolean
}

/** Quem do InfraWork está ligado a um usuário do SIGA (lido do nosso banco). */
export function useVinculosUsuarioSiga(
  ativo: boolean
): ReturnType<typeof useQuery<VinculoUsuarioSiga[]>> {
  return useQuery({
    queryKey: ['siga', 'usuarios-vinculos'],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracao_usuario')
        .select('user_id, externo_id, externo_login, externo_nome, origem, ativo')
      if (error) throw error
      return (data ?? []) as VinculoUsuarioSiga[]
    }
  })
}

/** Os usuários ativos do SIGA da empresa (lidos de lá na hora). */
export function useUsuariosSiga(
  empresaId: string | null | undefined,
  ativo: boolean
): ReturnType<typeof useQuery<UsuarioSiga[]>> {
  return useQuery({
    queryKey: ['siga', 'usuarios', empresaId],
    enabled: !!empresaId && ativo,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await chamarSiga<{ usuarios: UsuarioSiga[] }>({ acao: 'usuarios', empresa_id: empresaId }))
        .usuarios
  })
}

/** Liga um usuário do InfraWork a um usuário do SIGA (`externo_id` nulo desfaz). O nome gravado é o do SIGA. */
export function useVincularUsuarioSiga(): ReturnType<
  typeof useMutation<
    unknown,
    Error,
    { empresa_id: string; user_id: string; externo_id: number | null }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) => chamarSiga({ acao: 'vincular_usuario', ...v }),
    // o diálogo mostra o erro no próprio lugar
    onError: () => undefined,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['siga', 'usuarios-vinculos'] })
    }
  })
}
