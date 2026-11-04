/**
 * Cliente do Web Worker do motor: uma instância por aba do navegador, pedidos numerados, o modelo padrão do ApeX
 * (`default.dr5`) carregado uma vez.
 */
import modeloUrl from './modelo/default.dr5?url'
import type { TimingBands } from '@apex/engine'
import type { ComandoEdicao, MudancasEdicao } from './edicao'
import type { Pedido, Resposta } from './protocolo'
import type { ResultadoSerial } from './serial'
import type { PlanoEntrada } from './tipos'

type Distribuir<T> = T extends unknown ? Omit<T, 'id'> : never
type PedidoSemId = Distribuir<Pedido>

let worker: Worker | null = null
let pronto: Promise<void> | null = null
let seq = 0
const pendentes = new Map<number, { ok: (r: Resposta) => void; erro: (e: Error) => void }>()

function enviar(p: PedidoSemId): Promise<Resposta> {
  const id = ++seq
  return new Promise((ok, erro) => {
    pendentes.set(id, { ok, erro })
    worker!.postMessage({ ...p, id } as Pedido)
  })
}

function iniciar(): Promise<void> {
  if (pronto) return pronto
  worker = new Worker(new URL('./motor.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<Resposta>) => {
    const p = pendentes.get(ev.data.id)
    if (!p) return
    pendentes.delete(ev.data.id)
    if (ev.data.ok) p.ok(ev.data)
    else p.erro(new Error(ev.data.erro))
  }
  worker.onerror = (ev) => {
    const e = new Error(ev.message || 'falha no worker do motor')
    for (const p of pendentes.values()) p.erro(e)
    pendentes.clear()
  }
  pronto = (async () => {
    const r = await fetch(modeloUrl)
    if (!r.ok) throw new Error('não foi possível carregar o modelo do motor')
    const bytes = new Uint8Array(await r.arrayBuffer())
    await enviar({ tipo: 'modelo', bytes })
  })()
  pronto.catch(() => {
    pronto = null
  })
  return pronto
}

export interface CalculoNoWorker {
  resultado: ResultadoSerial
  payload: Record<string, unknown> | null
  duracaoMs: number
}

export async function calcularNoWorker(entrada: PlanoEntrada): Promise<CalculoNoWorker> {
  await iniciar()
  const r = await enviar({ tipo: 'calcular', entrada })
  if (!r.ok || r.tipo !== 'calcular') throw new Error('resposta inesperada do motor')
  return { resultado: r.resultado, payload: r.payload, duracaoMs: r.duracaoMs }
}

export async function faixasNoWorker(
  planoId: string,
  tarefaId: string
): Promise<TimingBands | null> {
  await iniciar()
  const r = await enviar({ tipo: 'faixas', planoId, tarefaId })
  if (!r.ok || r.tipo !== 'faixas') throw new Error('resposta inesperada do motor')
  return r.faixas
}

export interface EdicaoNoWorker {
  resultado: ResultadoSerial
  mudancas: MudancasEdicao
}

/** Aplica um comando das visões ao último cálculo do plano: prévia do resultado e o que gravar no banco. */
export async function editarNoWorker(
  planoId: string,
  comando: ComandoEdicao
): Promise<EdicaoNoWorker> {
  await iniciar()
  const r = await enviar({ tipo: 'editar', planoId, comando })
  if (!r.ok || r.tipo !== 'editar') throw new Error('resposta inesperada do motor')
  return { resultado: r.resultado, mudancas: r.mudancas }
}
