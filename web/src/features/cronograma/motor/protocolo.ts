/** Mensagens entre a interface e o Web Worker do motor. */
import type { TimingBands } from '@apex/engine'
import type { ComandoEdicao, MudancasEdicao } from './edicao'
import type { ResultadoSerial } from './serial'
import type { PlanoEntrada } from './tipos'

export type Pedido =
  | { id: number; tipo: 'modelo'; bytes: Uint8Array }
  | { id: number; tipo: 'calcular'; entrada: PlanoEntrada }
  | { id: number; tipo: 'faixas'; planoId: string; tarefaId: string }
  | { id: number; tipo: 'editar'; planoId: string; comando: ComandoEdicao }

export type Resposta =
  | { id: number; ok: false; erro: string }
  | { id: number; ok: true; tipo: 'modelo' }
  | {
      id: number
      ok: true
      tipo: 'calcular'
      resultado: ResultadoSerial
      payload: Record<string, unknown> | null
      duracaoMs: number
    }
  | { id: number; ok: true; tipo: 'faixas'; faixas: TimingBands | null }
  | { id: number; ok: true; tipo: 'editar'; resultado: ResultadoSerial; mudancas: MudancasEdicao }
