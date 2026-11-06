/**
 * Cronograma pelo motor do ApeX, como o web faz: carrega a entrada do banco, calcula e grava por
 * planejamento_gravar_calculo (que recusa resultado de dados antigos — aí relê e calcula de novo).
 */
import { carregarPlanoEntrada } from '@/features/cronograma/dados'
import {
  calcularPlano,
  payloadGravacao,
  type ResultadoCalculo
} from '@/features/cronograma/motor/calculo'
import type { PlanoEntrada } from '@/features/cronograma/motor/tipos'
import modelo from '@/features/cronograma/motor/modelo/default.dr5'
import { rpc } from '../contexto'

const MODELO = modelo as unknown as Uint8Array

export interface Recalculo {
  entrada: PlanoEntrada
  resultado: ResultadoCalculo
  gravado: boolean
  tentativas: number
}

/** Calcula o plano e grava (até 3 tentativas se os dados mudarem no meio). Linha de base não grava. */
export async function recalcularPlano(planejamentoId: string): Promise<Recalculo> {
  let ultimoErro = ''
  for (let t = 1; t <= 3; t++) {
    const entrada = await carregarPlanoEntrada(planejamentoId)
    const { resultado } = calcularPlano(entrada, MODELO)
    if (entrada.plano.is_baseline) return { entrada, resultado, gravado: false, tentativas: t }
    const g = await rpc<{ ok: boolean; motivo?: string }>('planejamento_gravar_calculo', {
      _planejamento_id: planejamentoId,
      _dados: payloadGravacao(entrada, resultado)
    })
    if (g?.ok) return { entrada, resultado, gravado: true, tentativas: t }
    ultimoErro = JSON.stringify(g)
  }
  throw new Error(
    `O cálculo não pôde ser gravado (os dados do plano mudaram durante o cálculo): ${ultimoErro}`
  )
}

/** Calcula sem gravar (prévia / leitura de linha de base). */
export async function calcularSemGravar(planejamentoId: string) {
  const entrada = await carregarPlanoEntrada(planejamentoId)
  return { entrada, ...calcularPlano(entrada, MODELO) }
}
