/** Filtro da visão por plano (persistido no store) e a entrada filtrada que as visões recebem. */
import { useCallback, useMemo } from 'react'
import { useCronogramaUi } from '../store'
import { aplicarFiltro, FILTRO_VAZIO, filtroAtivo, type FiltroVisao } from '../visoes/filtro'
import type { CalculoCronograma } from './calculo'

export function useFiltroVisao(calc: CalculoCronograma): {
  filtro: FiltroVisao
  setFiltro: (f: FiltroVisao) => void
  ativo: boolean
  /** o cálculo com a entrada filtrada (os diálogos continuam com o cálculo inteiro) */
  calcFiltrado: CalculoCronograma
} {
  const planoId = calc.entrada?.plano.id ?? ''
  const filtro = useCronogramaUi((s) => s.filtros[planoId]) ?? FILTRO_VAZIO
  const definir = useCronogramaUi((s) => s.setFiltro)
  const setFiltro = useCallback((f: FiltroVisao) => definir(planoId, f), [definir, planoId])
  const ativo = filtroAtivo(filtro)
  const calcFiltrado = useMemo(
    () =>
      ativo && calc.entrada ? { ...calc, entrada: aplicarFiltro(calc.entrada, filtro) } : calc,
    [calc, filtro, ativo]
  )
  return { filtro, setFiltro, ativo, calcFiltrado }
}
