/**
 * Calendários da obra (os `Calendar` do ApeX): vários por obra, cada um com a semana padrão e as definições (feriados,
 * feriados móveis, folgas anuais e horários excepcionais), e os fatores de produtividade mensais da obra. Mudar um
 * calendário marca os planos em edição para recalcular (gatilhos); a entrada do cronograma é relida.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type {
  CalendarioEntrada,
  DefinicaoCalendario,
  DiaSemana,
  FatorMes,
  TipoDefinicao
} from '../motor/tipos'
import { CHAVE_CRONOGRAMA } from './calculo'
import { traduzirErro } from './edicao'

export interface DefinicaoRow extends DefinicaoCalendario {
  id: string
  calendario_id: string
  ordem: number
}

export interface CalendarioRow extends Omit<CalendarioEntrada, 'definicoes'> {
  obra_id: string
  ordem: number
  definicoes: DefinicaoRow[]
}

export interface FatorRow extends FatorMes {
  motivo: string | null
}

const chave = (obraId: string | null | undefined): unknown[] => [
  CHAVE_CRONOGRAMA,
  'calendarios',
  obraId
]

export function useCalendariosObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<{ calendarios: CalendarioRow[]; fatores: FatorRow[] }>> {
  return useQuery({
    queryKey: chave(obraId),
    enabled: !!obraId,
    queryFn: async () => {
      const c = supabase
      const [cals, defs, fat] = await Promise.all([
        c
          .from('calendario')
          .select('id, obra_id, nome, padrao, semana, ordem')
          .eq('obra_id', obraId!)
          .order('ordem')
          .order('nome'),
        c
          .from('calendario_definicao')
          .select(
            'id, calendario_id, tipo, nome, data_inicio, data_fim, todo_ano, dia_semana, semana, ordem, calendario!inner(obra_id)'
          )
          .eq('calendario.obra_id', obraId!)
          .order('ordem'),
        c
          .from('obra_produtividade_mes')
          .select('ano_mes, fator, motivo')
          .eq('obra_id', obraId!)
          .order('ano_mes')
      ])
      for (const r of [cals, defs, fat]) if (r.error) throw new Error(r.error.message)
      const ds = (defs.data ?? []) as unknown as (DefinicaoRow & { calendario: unknown })[]
      return {
        calendarios: ((cals.data ?? []) as unknown as Omit<CalendarioRow, 'definicoes'>[]).map(
          (k) => ({
            ...k,
            definicoes: ds
              .filter((d) => d.calendario_id === k.id)
              .map(({ calendario: _c, ...d }) => ({
                ...d,
                dia_semana: d.dia_semana === null ? null : Number(d.dia_semana)
              }))
          })
        ),
        fatores: (
          (fat.data ?? []) as { ano_mes: string; fator: number | string; motivo: string | null }[]
        ).map((f) => ({ ano_mes: String(f.ano_mes), fator: Number(f.fator), motivo: f.motivo }))
      }
    }
  })
}

function useDepois(obraId: string): () => Promise<void> {
  const qc = useQueryClient()
  return async () => {
    await qc.invalidateQueries({ queryKey: chave(obraId) })
    // os planos em edição foram marcados para recalcular: a entrada (com os calendários) é relida
    void qc.invalidateQueries({ queryKey: [CHAVE_CRONOGRAMA, 'entrada'] })
    void qc.invalidateQueries({ queryKey: ['planejamento'] })
  }
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(traduzirErroCalendario(error.message))
  return data
}

export function traduzirErroCalendario(msg: string): string {
  if (/chk_calendario_semana_trabalho/.test(msg))
    return 'O calendário precisa de ao menos um dia com horas de trabalho na semana.'
  if (/chk_calendario_semana|chk_caldef_campos/.test(msg))
    return 'Semana ou período inválido: confira os horários (HH:MM) e as horas (0 a 24).'
  if (/calendario_obra_id_nome_key|duplicate key/.test(msg))
    return 'Já existe um calendário com esse nome na obra.'
  if (/obra_produtividade_mes_pkey/.test(msg)) return 'Já existe um fator para esse mês.'
  return traduzirErro(msg)
}

export function useSalvarCalendario(obraId: string): ReturnType<
  typeof useMutation<
    string,
    Error,
    {
      id: string | null
      nome?: string
      semana?: DiaSemana[]
      padrao?: boolean
      copiarDe?: string | null
    }
  >
> {
  const depois = useDepois(obraId)
  return useMutation({
    mutationFn: async ({ id, nome, semana, padrao, copiarDe }) => {
      const c = supabase
      if (id) {
        const campos: Record<string, unknown> = {}
        if (nome !== undefined) campos.nome = nome
        if (semana !== undefined) campos.semana = semana
        if (padrao !== undefined) campos.padrao = padrao
        await ok(c.from('calendario').update(campos).eq('id', id))
        return id
      }
      const r = (await ok(
        c
          .from('calendario')
          .insert({ obra_id: obraId, nome, semana, padrao: !!padrao })
          .select('id')
          .single()
      )) as { id: string }
      if (copiarDe) {
        const defs = (await ok(
          c
            .from('calendario_definicao')
            .select('tipo, nome, data_inicio, data_fim, todo_ano, dia_semana, semana, ordem')
            .eq('calendario_id', copiarDe)
        )) as Record<string, unknown>[]
        if (defs.length)
          await ok(
            c.from('calendario_definicao').insert(defs.map((d) => ({ ...d, calendario_id: r.id })))
          )
      }
      return r.id
    },
    onSettled: () => depois()
  })
}

export function useExcluirCalendario(
  obraId: string
): ReturnType<typeof useMutation<void, Error, string>> {
  const depois = useDepois(obraId)
  return useMutation({
    mutationFn: async (id) => {
      await ok(supabase.from('calendario').delete().eq('id', id))
    },
    onSettled: () => depois()
  })
}

export interface DefinicaoInput {
  id: string | null
  calendario_id: string
  tipo: TipoDefinicao
  nome: string
  data_inicio: string | null
  data_fim: string | null
  todo_ano: boolean
  dia_semana: number | null
  semana: DiaSemana[] | null
  ordem?: number
}

export function useSalvarDefinicoes(
  obraId: string
): ReturnType<typeof useMutation<void, Error, DefinicaoInput[]>> {
  const depois = useDepois(obraId)
  return useMutation({
    mutationFn: async (lista) => {
      const c = supabase
      for (const { id, ...d } of lista) {
        if (id) await ok(c.from('calendario_definicao').update(d).eq('id', id))
        else await ok(c.from('calendario_definicao').insert(d))
      }
    },
    onSettled: () => depois()
  })
}

export function useExcluirDefinicao(
  obraId: string
): ReturnType<typeof useMutation<void, Error, string>> {
  const depois = useDepois(obraId)
  return useMutation({
    mutationFn: async (id) => {
      await ok(supabase.from('calendario_definicao').delete().eq('id', id))
    },
    onSettled: () => depois()
  })
}

export function useSalvarFator(
  obraId: string
): ReturnType<
  typeof useMutation<void, Error, { ano_mes: string; fator: number; motivo: string | null }>
> {
  const depois = useDepois(obraId)
  return useMutation({
    mutationFn: async (f) => {
      await ok(
        supabase
          .from('obra_produtividade_mes')
          .upsert({ obra_id: obraId, ...f }, { onConflict: 'obra_id,ano_mes' })
      )
    },
    onSettled: () => depois()
  })
}

export function useExcluirFator(
  obraId: string
): ReturnType<typeof useMutation<void, Error, string>> {
  const depois = useDepois(obraId)
  return useMutation({
    mutationFn: async (anoMes) => {
      await ok(
        supabase.from('obra_produtividade_mes').delete().eq('obra_id', obraId).eq('ano_mes', anoMes)
      )
    },
    onSettled: () => depois()
  })
}
