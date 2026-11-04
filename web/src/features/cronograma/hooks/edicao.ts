/**
 * Edição do cronograma: cada gravação sobe o `dados_rev` do plano (gatilhos) e invalida a entrada; o cálculo e a
 * gravação dos resultados seguem sozinhos (`useCalculoCronograma`).
 *
 * Os comandos das visões (arrastar início/término, nova dependência, compactar) passam antes pelo worker, que aplica o
 * comando do ApeX ao último cálculo: a tela mostra o resultado na hora e o banco recebe só o que muda.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { editarNoWorker } from '../motor/cliente'
import type { ComandoEdicao } from '../motor/edicao'
import { desserializar } from '../motor/serial'
import type { TipoDependencia } from '../motor/tipos'
import { invalidarCronograma } from './calculo'
import { usePreviaStore } from './previa'
import { fmtNum } from '../visoes/formato'

function sb(): NonNullable<typeof supabase> {
  if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
  return supabase
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(traduzirErro(error.message))
  return data
}

/** Mensagens do banco em português de tela. */
export function traduzirErro(msg: string): string {
  if (/fk_plan_tarefa_parent|violates foreign key constraint "fk_plan_tarefa_parent"/.test(msg))
    return 'A tarefa-resumo ainda tem tarefas dentro.'
  if (/chk_local_faixa/.test(msg))
    return 'Faixa do local inválida: no eixo, a estaca final precisa ser maior que a inicial; área e "sem local" não têm estacas.'
  if (/chk_obra_trecho_comprimento/.test(msg))
    return 'Eixo precisa de comprimento maior que zero; área não tem comprimento.'
  if (/chk_obra_trecho_tipo/.test(msg)) return 'Tipo de local inválido (eixo ou área).'
  if (/chk_plan_dep_atrasos/.test(msg)) return 'O atraso mínimo não pode passar do máximo.'
  if (/uq_plan_dep|duplicate key value violates unique constraint .*dependencia/.test(msg))
    return 'Já existe uma dependência entre essas tarefas.'
  if (/chk_tarefa_restricao/.test(msg)) return 'Informe a data da restrição.'
  if (/coef_producao_check/.test(msg))
    return 'O coeficiente de produção precisa ser maior que zero.'
  if (/qtd_equipes_check/.test(msg)) return 'O número de equipes vai de 1 a 50.'
  if (/chk_plan_tar_qtd_alocada_pos/.test(msg)) return 'A quantidade precisa ser maior que zero.'
  // trg_tarefa_limite_servico: Σ tarefas do serviço ≤ quantidade do serviço no orçamento
  const lim =
    /Quantidade acima do serviço "(.+)": ([\d.-]+) já programado \+ ([\d.-]+) > ([\d.-]+) do orçamento \(restam ([\d.-]+)\)/.exec(
      msg
    )
  if (lim) {
    const f = (x: string): string => fmtNum(Number(x), 'auto')
    return `Quantidade acima do serviço "${lim[1]}": ${f(lim[2]!)} já programados + ${f(lim[3]!)} passam dos ${f(lim[4]!)} do orçamento (restam ${f(lim[5]!)}). Para programar além do orçamento, lance um aditivo.`
  }
  return msg
}

/** Invalidações comuns depois de gravar dados de entrada do plano. */
function useDepois(): (planejamentoId: string) => Promise<void> {
  const qc = useQueryClient()
  return async (planejamentoId) => {
    await invalidarCronograma(qc, planejamentoId)
    void qc.invalidateQueries({ queryKey: ['planejamento'] })
  }
}

// ── comandos das visões ─────────────────────────────────────────────────────────────────────────────────────────

export interface ComandoInput {
  planejamentoId: string
  /** assinatura da entrada em que o comando foi aplicado (para a prévia) */
  sig: string | null
  comando: ComandoEdicao
}

/** Resultado de um comando das visões: `aviso` quando o comando não mudou nada (ex.: o término não muda as equipes). */
export interface ResultadoComando {
  aviso: string | null
}

export function useComandoVisao(): ReturnType<
  typeof useMutation<ResultadoComando, Error, ComandoInput>
> {
  const depois = useDepois()
  const definirPrevia = usePreviaStore((s) => s.definir)
  const limparPrevia = usePreviaStore((s) => s.limpar)
  const iniciar = usePreviaStore((s) => s.iniciarComando)
  const terminar = usePreviaStore((s) => s.terminarComando)
  return useMutation({
    onMutate: ({ planejamentoId }) => iniciar(planejamentoId),
    mutationFn: async ({ planejamentoId, sig, comando }) => {
      const r = await editarNoWorker(planejamentoId, comando)
      if (r.mudancas.aviso) return { aviso: r.mudancas.aviso }
      if (sig) definirPrevia(planejamentoId, { sig, resultado: desserializar(r.resultado) })
      try {
        const c = sb()
        if (r.mudancas.tarefas.length)
          await ok(
            c.rpc('planejamento_tarefas_atualizar', {
              _planejamento_id: planejamentoId,
              _itens: r.mudancas.tarefas
            })
          )
        if (r.mudancas.dependencias.length)
          await ok(
            c
              .from('planejamento_dependencia')
              .insert(
                r.mudancas.dependencias.map((d) => ({ planejamento_id: planejamentoId, ...d }))
              )
          )
      } catch (e) {
        limparPrevia(planejamentoId)
        throw e
      }
      return { aviso: null }
    },
    onSettled: async (_d, _e, v) => {
      try {
        await depois(v.planejamentoId)
      } finally {
        terminar(v.planejamentoId)
      }
    }
  })
}

// ── tarefas ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CamposTarefa {
  nome_custom?: string | null
  notas?: string | null
  quantidade_alocada?: number | null
  prioridade?: number
  asap?: boolean
  inicio_dia?: boolean
  sentido?: 'crescente' | 'decrescente'
  restricao_inicio?: 'nao_antes' | 'exato' | null
  restricao_inicio_em?: string | null
  restricao_fim?: 'nao_depois' | 'exato' | null
  restricao_fim_em?: string | null
  coef_producao?: number
  qtd_equipes?: number
  calendario_id?: string | null
  derivar_predecessoras?: boolean
  aparencia?: Record<string, unknown> | null
  inicio_em?: string | null
  item_orcamentario_id?: string | null
}

export function useAtualizarTarefa(): ReturnType<
  typeof useMutation<void, Error, { planejamentoId: string; id: string; campos: CamposTarefa }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ id, campos }) => {
      await ok(sb().from('planejamento_tarefa').update(campos).eq('id', id))
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

/** Mesmos campos em várias tarefas (menu de contexto: ASAP, sentido…). */
export function useAtualizarTarefas(): ReturnType<
  typeof useMutation<
    void,
    Error,
    {
      planejamentoId: string
      itens: ({ id: string } & Pick<
        CamposTarefa,
        'asap' | 'sentido' | 'prioridade' | 'qtd_equipes' | 'coef_producao' | 'inicio_em'
      >)[]
    }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, itens }) => {
      await ok(
        sb().rpc('planejamento_tarefas_atualizar', {
          _planejamento_id: planejamentoId,
          _itens: itens
        })
      )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export interface NovaTarefa {
  item_orcamentario_id: string
  /** quantidade da tarefa sem locais (com locais, a soma deles vale) */
  quantidade: number | null
  nome_custom?: string | null
  /** tarefa-resumo de destino (null = raiz) */
  parent_id: string | null
  sentido?: 'crescente' | 'decrescente'
  locais?: LocalInput[]
}

export function useCriarTarefas(): ReturnType<
  typeof useMutation<
    string[],
    Error,
    { planejamentoId: string; tarefas: NovaTarefa[]; ordemInicial: number }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, tarefas, ordemInicial }) => {
      // tarefa + locais numa transação (RPC): com erro nos locais não sobra tarefa sem local
      const c = sb()
      const ids: string[] = []
      for (const [i, t] of tarefas.entries()) {
        const id = (await ok(
          c.rpc('planejamento_tarefa_criar', {
            _planejamento_id: planejamentoId,
            _campos: {
              item_orcamentario_id: t.item_orcamentario_id,
              quantidade: t.quantidade && t.quantidade > 0 ? t.quantidade : null,
              nome_custom: t.nome_custom ?? null,
              parent_id: t.parent_id,
              ordem: ordemInicial + i,
              sentido: t.sentido ?? 'crescente'
            },
            _locais: t.locais ?? []
          })
        )) as string
        ids.push(id)
      }
      return ids
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useCriarGrupo(): ReturnType<
  typeof useMutation<
    string,
    Error,
    { planejamentoId: string; nome: string; parent_id: string | null; nivel: number; ordem: number }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, nome, parent_id, nivel, ordem }) => {
      const r = await ok(
        sb()
          .from('planejamento_tarefa')
          .insert({
            planejamento_id: planejamentoId,
            tipo_no: 'grupo',
            nome_custom: nome,
            parent_id,
            nivel,
            ordem
          })
          .select('id')
          .single()
      )
      return (r as { id: string }).id
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useMoverTarefas(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { planejamentoId: string; ids: string[]; pai: string | null; antes: string | null }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, ids, pai, antes }) => {
      await ok(
        sb().rpc('planejamento_mover_tarefas', {
          _planejamento_id: planejamentoId,
          _ids: ids,
          _pai: pai,
          _antes: antes
        })
      )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useExcluirTarefas(): ReturnType<
  typeof useMutation<number, Error, { planejamentoId: string; ids: string[] }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, ids }) =>
      (await ok(
        sb().rpc('planejamento_excluir_tarefas', { _planejamento_id: planejamentoId, _ids: ids })
      )) as number,
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

// ── locais e equipes da tarefa ──────────────────────────────────────────────────────────────────────────────────

export interface LocalInput {
  /** id do local existente (mantém o id e as datas calculadas ao salvar); ausente = local novo */
  id?: string | null
  trecho_id: string | null
  /** área e "sem local": null */
  inicio_m: number | null
  fim_m: number | null
  quantidade: number
  qtd_origem: 'manual' | 'trecho'
}

export function useSalvarLocais(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { planejamentoId: string; tarefaId: string; locais: LocalInput[] }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ tarefaId, locais }) => {
      await ok(
        sb().rpc('planejamento_tarefa_locais_salvar', { _tarefa_id: tarefaId, _locais: locais })
      )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

// ── operações do ApeX sobre tarefas (RPCs da migração 0031) ──────────────────────────────────────────────────

/** Dividir por estaca (`SplitWorkSiteByStation`): devolve o id da tarefa nova (a parte alta). */
export function useDividirEstaca(): ReturnType<
  typeof useMutation<
    string,
    Error,
    { planejamentoId: string; tarefaId: string; trechoId: string; estacaM: number }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ tarefaId, trechoId, estacaM }) =>
      (await ok(
        sb().rpc('planejamento_tarefa_dividir_estaca', {
          _tarefa_id: tarefaId,
          _trecho_id: trechoId,
          _estaca_m: estacaM
        })
      )) as string,
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

/** Dividir por quantidade: `partes` = o que vai para a tarefa nova, por local (local_id null = tarefa sem locais). */
export function useDividirQuantidade(): ReturnType<
  typeof useMutation<
    string,
    Error,
    {
      planejamentoId: string
      tarefaId: string
      partes: { local_id: string | null; quantidade: number }[]
    }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ tarefaId, partes }) =>
      (await ok(
        sb().rpc('planejamento_tarefa_dividir_quantidade', {
          _tarefa_id: tarefaId,
          _partes: partes
        })
      )) as string,
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

/** Combinar tarefas do mesmo serviço e dos mesmos trechos: devolve a que fica. */
export function useCombinarTarefas(): ReturnType<
  typeof useMutation<string, Error, { planejamentoId: string; ids: string[] }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ ids }) =>
      (await ok(sb().rpc('planejamento_tarefas_combinar', { _ids: ids }))) as string,
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export interface OpcoesCriarDasQuantidades {
  /** sequencia = uma tarefa por sequência contígua (padrão); local = uma por local; janela = uma por janela de N m */
  modo: 'sequencia' | 'local' | 'janela'
  janela_m?: number | null
  sentido: 'crescente' | 'decrescente'
}

/** Criar tarefas a partir das quantidades por local (a importação de quantidades do DynaRoad). */
export function useCriarDasQuantidades(): ReturnType<
  typeof useMutation<
    string[],
    Error,
    {
      planejamentoId: string
      parentId: string | null
      trechos: string[]
      itens: string[]
      opcoes: OpcoesCriarDasQuantidades
    }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, parentId, trechos, itens, opcoes }) =>
      ((await ok(
        sb().rpc('planejamento_tarefas_criar_das_quantidades', {
          _planejamento_id: planejamentoId,
          _parent_id: parentId,
          _trechos: trechos,
          _itens: itens,
          _opcoes: opcoes
        })
      )) ?? []) as string[],
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

/** "Rename tasks automatically": "<serviço> <trecho> N" nas tarefas sem nome fixado (ou nas `ids`). */
export function useRenomearAuto(): ReturnType<
  typeof useMutation<number, Error, { planejamentoId: string; ids?: string[] | null }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, ids }) =>
      (await ok(
        sb().rpc('planejamento_tarefas_renomear_auto', {
          _planejamento_id: planejamentoId,
          _ids: ids ?? null
        })
      )) as number,
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

/** Mudar o trecho da tarefa (`SetRoadLine`): faixa remapeada; devolve os avisos (locais que viraram manuais). */
export function useMudarTrecho(): ReturnType<
  typeof useMutation<
    { locais: number; avisos: string[] },
    Error,
    { planejamentoId: string; tarefaId: string; trechoId: string | null }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ tarefaId, trechoId }) =>
      (await ok(
        sb().rpc('planejamento_tarefa_mudar_trecho', { _tarefa_id: tarefaId, _trecho_id: trechoId })
      )) as { locais: number; avisos: string[] },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useSalvarEquipesTarefa(): ReturnType<
  typeof useMutation<void, Error, { planejamentoId: string; tarefaId: string; equipes: string[] }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ tarefaId, equipes }) => {
      await ok(
        sb().rpc('planejamento_tarefa_equipes_salvar', { _tarefa_id: tarefaId, _equipes: equipes })
      )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

// ── dependências ────────────────────────────────────────────────────────────────────────────────────────────────

export interface CamposDependencia {
  tipo: TipoDependencia
  atraso_min: number | null
  atraso_max: number | null
  dias_uteis: boolean
  aparencia?: Record<string, unknown> | null
}

export function useSalvarDependencia(): ReturnType<
  typeof useMutation<
    void,
    Error,
    {
      planejamentoId: string
      id: string | null
      predecessora_id: string
      sucessora_id: string
      campos: CamposDependencia
    }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, id, predecessora_id, sucessora_id, campos }) => {
      const c = sb()
      if (id) await ok(c.from('planejamento_dependencia').update(campos).eq('id', id))
      else
        await ok(
          c
            .from('planejamento_dependencia')
            .insert({ planejamento_id: planejamentoId, predecessora_id, sucessora_id, ...campos })
        )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useExcluirDependencias(): ReturnType<
  typeof useMutation<void, Error, { planejamentoId: string; ids: string[] }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ ids }) => {
      await ok(sb().from('planejamento_dependencia').delete().in('id', ids))
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

// ── marcos e limites ────────────────────────────────────────────────────────────────────────────────────────────

export interface CamposMarco {
  nome: string
  descricao?: string | null
  inicio: string | null
  fim: string | null
  filtro_servicos: boolean
  servicos: string[]
  filtro_recursos: boolean
  recursos: string[]
  filtro_estacas: boolean
  faixas: { trecho_id: string; inicio_m: number; fim_m: number }[]
  incluidas: string[]
  excluidas: string[]
}

export function useSalvarMarco(): ReturnType<
  typeof useMutation<
    string,
    Error,
    { planejamentoId: string; id: string | null; campos: CamposMarco }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, id, campos }) => {
      const c = sb()
      if (id) {
        await ok(c.from('planejamento_marco').update(campos).eq('id', id))
        return id
      }
      const r = await ok(
        c
          .from('planejamento_marco')
          .insert({ planejamento_id: planejamentoId, ...campos })
          .select('id')
          .single()
      )
      return (r as { id: string }).id
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useExcluirMarco(): ReturnType<
  typeof useMutation<void, Error, { planejamentoId: string; id: string }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ id }) => {
      await ok(sb().from('planejamento_marco').delete().eq('id', id))
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useSalvarLimite(): ReturnType<
  typeof useMutation<
    void,
    Error,
    {
      planejamentoId: string
      id: string | null
      recurso_id: string
      grupo_id: string | null
      maximo: number
    }
  >
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, id, recurso_id, grupo_id, maximo }) => {
      const c = sb()
      if (id)
        await ok(
          c
            .from('planejamento_recurso_limite')
            .update({ recurso_id, grupo_id, maximo })
            .eq('id', id)
        )
      else
        await ok(
          c
            .from('planejamento_recurso_limite')
            .insert({ planejamento_id: planejamentoId, recurso_id, grupo_id, maximo })
        )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useExcluirLimite(): ReturnType<
  typeof useMutation<void, Error, { planejamentoId: string; id: string }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ id }) => {
      await ok(sb().from('planejamento_recurso_limite').delete().eq('id', id))
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

// ── plano ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CamposPlano {
  nome?: string
  data_referencia_inicio?: string
  prazo?: string | null
  calendario_id?: string | null
  modo?: 'programacao' | 'controle'
  /** data de controle (null = hoje) */
  data_date?: string | null
}

export function useAtualizarPlano(): ReturnType<
  typeof useMutation<void, Error, { planejamentoId: string; campos: CamposPlano }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, campos }) => {
      await ok(sb().from('planejamento').update(campos).eq('id', planejamentoId))
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

// ── regras entre serviços (`WorkTypeDependency` do ApeX) ───────────────────────────────────────────────────────────
// Criadas e editadas no próprio cronograma (diálogo da dependência "por estacas"): toda tarefa do serviço sucessor segue
// as do predecessor em cada estaca que dividem, com o atraso dado. Ficam na obra (valem para todos os planos).

export interface RegraServico {
  planejamentoId: string
  predecessor_id: string
  sucessor_id: string
}

export function useSalvarRegraServico(): ReturnType<
  typeof useMutation<void, Error, RegraServico & { atraso_dias: number }>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ planejamentoId, predecessor_id, sucessor_id, atraso_dias }) => {
      const c = sb()
      const p = await ok(c.from('planejamento').select('obra_id').eq('id', planejamentoId).single())
      await ok(
        c.from('servico_dependencia').upsert(
          {
            obra_id: (p as { obra_id: string }).obra_id,
            predecessor_id,
            sucessor_id,
            atraso_dias
          },
          { onConflict: 'predecessor_id,sucessor_id' }
        )
      )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}

export function useExcluirRegraServico(): ReturnType<
  typeof useMutation<void, Error, RegraServico>
> {
  const depois = useDepois()
  return useMutation({
    mutationFn: async ({ predecessor_id, sucessor_id }) => {
      await ok(
        sb()
          .from('servico_dependencia')
          .delete()
          .eq('predecessor_id', predecessor_id)
          .eq('sucessor_id', sucessor_id)
      )
    },
    onSettled: (_d, _e, v) => depois(v.planejamentoId)
  })
}
