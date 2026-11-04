/**
 * Cálculo do cronograma de um plano pelo motor do ApeX, no Web Worker, e gravação dos resultados.
 *
 * Fluxo: a entrada (retrato do plano) vem do banco; o worker calcula; se o resultado gravado não corresponde à
 * entrada (calculo_rev ≠ dados_rev, ou recálculo pendente por orçamento/calendário), grava por
 * planejamento_gravar_calculo — que recusa resultado de dados antigos (a entrada é relida e o ciclo recomeça).
 * Depois de gravar, os inícios gravados viram os inícios desejados; o recálculo seguinte chega ao mesmo resultado
 * (ponto fixo), então não grava de novo.
 *
 * Enquanto uma nova entrada é calculada, a tela mostra o resultado anterior (ou a prévia de um comando das visões).
 */
import { useEffect, useMemo } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { carregarPlanoEntrada } from '../dados'
import { calcularNoWorker, faixasNoWorker } from '../motor/cliente'
import type { TimingBands } from '@apex/engine'
import { desserializar } from '../motor/serial'
import type { ResultadoCalculo } from '../motor/calculo'
import type { PlanoEntrada } from '../motor/tipos'
import { usePreviaStore } from './previa'

export const CHAVE_CRONOGRAMA = 'cronograma'

/** última gravação pedida por plano (várias telas abertas no mesmo plano não gravam duas vezes) */
const ultimaGravacao = new Map<string, string>()

/** FNV-1a de 32 bits (identifica a entrada sem guardar o texto inteiro) */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** Invalida a entrada do cronograma (o cálculo e a gravação seguem sozinhos). */
export function invalidarCronograma(
  qc: QueryClient,
  planejamentoId?: string | null
): Promise<void> {
  return qc.invalidateQueries({
    queryKey: planejamentoId
      ? [CHAVE_CRONOGRAMA, 'entrada', planejamentoId]
      : [CHAVE_CRONOGRAMA, 'entrada']
  })
}

export function usePlanoEntrada(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<PlanoEntrada>> {
  return useQuery({
    queryKey: [CHAVE_CRONOGRAMA, 'entrada', planejamentoId],
    enabled: !!planejamentoId,
    queryFn: () => carregarPlanoEntrada(planejamentoId!),
    staleTime: 5_000,
    placeholderData: (anterior, q) => (q?.queryKey[2] === planejamentoId ? anterior : undefined)
  })
}

/** Chave estável da entrada (o resultado só muda se a entrada mudar). */
export function assinatura(e: PlanoEntrada): string {
  return JSON.stringify({
    ...e,
    plano: { ...e.plano, calculo_rev: undefined, recalculo_pendente: undefined }
  })
}

export interface CalculoCronograma {
  entrada: PlanoEntrada | undefined
  resultado: ResultadoCalculo | undefined
  /** assinatura da entrada mostrada (a dos comandos das visões) */
  sig: string | null
  carregando: boolean
  calculando: boolean
  gravando: boolean
  erro: Error | null
  /** os resultados no banco correspondem à entrada atual */
  gravado: boolean
  duracaoMs: number | null
  /** o resultado na tela é a prévia de um comando, ainda não confirmada pelo banco */
  previa: boolean
  /** faixas de restrição do arraste de uma tarefa (`TimingConstraintCalculator`) */
  faixas: (tarefaId: string) => Promise<TimingBands | null>
}

export function useCalculoCronograma(planejamentoId: string | null | undefined): CalculoCronograma {
  const qc = useQueryClient()
  const entradaQ = usePlanoEntrada(planejamentoId)
  const entrada = entradaQ.data
  const sig = useMemo(() => (entrada ? assinatura(entrada) : null), [entrada])
  const calcQ = useQuery({
    queryKey: [CHAVE_CRONOGRAMA, 'calculo', planejamentoId, sig],
    enabled: !!entrada && !!sig,
    queryFn: () => calcularNoWorker(entrada!),
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData
  })
  const calculado = useMemo(
    () => (calcQ.data ? desserializar(calcQ.data.resultado) : undefined),
    [calcQ.data]
  )

  // prévia de comando: vale até o cálculo de uma entrada nova (a gravada) chegar
  const previa = usePreviaStore((s) => (planejamentoId ? s.porPlano[planejamentoId] : undefined))
  const pendentes = usePreviaStore((s) => (planejamentoId ? (s.pendentes[planejamentoId] ?? 0) : 0))
  const limparPrevia = usePreviaStore((s) => s.limpar)
  const calculoAtual = !!calcQ.data && !calcQ.isPlaceholderData
  useEffect(() => {
    if (previa && planejamentoId && sig && previa.sig !== sig && calculoAtual && pendentes === 0)
      limparPrevia(planejamentoId)
  }, [previa, planejamentoId, sig, calculoAtual, limparPrevia, pendentes])
  const usarPrevia = !!previa && (previa.sig === sig || !calculoAtual || pendentes > 0)

  // gravação dos resultados (uma por revisão dos dados, mesmo com várias telas abertas no plano)
  const gravar = useMutation({
    mutationFn: async ({ plano, payload }: { plano: string; payload: Record<string, unknown> }) => {
      const { data, error } = await supabase!.rpc('planejamento_gravar_calculo', {
        _planejamento_id: plano,
        _dados: payload
      })
      if (error) throw new Error(error.message)
      return data as { ok: boolean; motivo?: string }
    },
    onSuccess: async (r, v) => {
      if (!r.ok && r.motivo === 'desatualizado') ultimaGravacao.delete(v.plano)
      await invalidarCronograma(qc, v.plano)
      // resultados gravados alimentam a curva S, o histograma, o acompanhamento…
      void qc.invalidateQueries({ queryKey: ['planejamento'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
    },
    onError: (_e, v) => void ultimaGravacao.delete(v.plano)
  })
  const precisaGravar =
    !!entrada &&
    calculoAtual &&
    !entrada.plano.is_baseline &&
    !!calcQ.data?.payload &&
    (entrada.plano.calculo_rev !== entrada.plano.dados_rev ||
      entrada.plano.recalculo_pendente === true)
  const mutarGravar = gravar.mutate

  useEffect(() => {
    if (!precisaGravar || !entrada || !calcQ.data?.payload) return
    if (!SUPABASE_ENABLED || !supabase) return
    const plano = entrada.plano.id
    const chave = `${entrada.plano.dados_rev}:${hash(sig ?? '')}`
    if (ultimaGravacao.get(plano) === chave) return
    ultimaGravacao.set(plano, chave)
    mutarGravar({ plano, payload: calcQ.data.payload })
  }, [precisaGravar, entrada, calcQ.data, sig, mutarGravar])

  return {
    entrada,
    resultado: usarPrevia ? previa!.resultado : calculado,
    sig,
    carregando: entradaQ.isLoading,
    calculando: calcQ.isFetching,
    gravando: gravar.isPending,
    erro: (entradaQ.error as Error | null) ?? (calcQ.error as Error | null) ?? gravar.error,
    gravado:
      !!entrada &&
      (entrada.plano.is_baseline ||
        (entrada.plano.calculo_rev === entrada.plano.dados_rev &&
          !entrada.plano.recalculo_pendente)),
    duracaoMs: calcQ.data?.duracaoMs ?? null,
    previa: usarPrevia,
    faixas: (tarefaId) =>
      planejamentoId
        ? faixasNoWorker(planejamentoId, tarefaId).catch(() => null)
        : Promise.resolve(null)
  }
}
