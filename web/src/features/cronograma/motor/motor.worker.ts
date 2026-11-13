/**
 * Web Worker do motor do cronograma (ApeX). Monta e calcula fora da thread da interface e guarda o último projeto
 * de cada plano para as consultas e os comandos das visões (faixas do arraste, edição com prévia).
 */
import { timingBands } from '@apex/engine'
import { calcularPlano, payloadGravacao, type PlanoCalculado } from './calculo'
import { aplicarComando, equipesParaTermino, MAX_EQUIPES } from './edicao'
import { serializar } from './serial'
import type { Pedido, Resposta } from './protocolo'
import type { PlanoEntrada } from './tipos'

let modelo: Uint8Array | null = null
const projetos = new Map<string, { entrada: PlanoEntrada; calc: PlanoCalculado }>()

function responder(r: Resposta): void {
  ;(self as unknown as Worker).postMessage(r)
}

self.onmessage = (ev: MessageEvent<Pedido>) => {
  const m = ev.data
  try {
    if (m.tipo === 'modelo') {
      modelo = m.bytes
      responder({ id: m.id, ok: true, tipo: 'modelo' })
      return
    }
    if (m.tipo === 'calcular') {
      if (!modelo) throw new Error('modelo do ApeX não carregado no worker')
      const t0 = performance.now()
      const calc = calcularPlano(m.entrada, modelo)
      projetos.set(m.entrada.plano.id, { entrada: m.entrada, calc })
      responder({
        id: m.id,
        ok: true,
        tipo: 'calcular',
        resultado: serializar(calc.resultado),
        payload: m.entrada.plano.is_baseline ? null : payloadGravacao(m.entrada, calc.resultado),
        duracaoMs: performance.now() - t0
      })
      return
    }
    if (m.tipo === 'faixas') {
      const x = projetos.get(m.planoId)
      const t = x?.calc.entidades.get(m.tarefaId)
      responder({
        id: m.id,
        ok: true,
        tipo: 'faixas',
        faixas: x && t ? (timingBands(x.calc.projeto, t) ?? null) : null
      })
      return
    }
    if (m.tipo === 'editar') {
      const x = projetos.get(m.planoId)
      if (!x) throw new Error('Plano ainda não calculado')
      if (m.comando.tipo === 'fim') {
        // término → número de equipes: muda a entrada e recalcula (a produtividade da composição não muda)
        const cmd = m.comando
        const t = x.entrada.tarefas.find((y) => y.id === cmd.tarefaId)
        const n = equipesParaTermino(x.calc.resultado, x.entrada, cmd.tarefaId, cmd.em)
        const atual = Math.max(1, Math.round(t?.qtd_equipes || 1))
        if (!t || n === null || n === atual) {
          responder({
            id: m.id,
            ok: true,
            tipo: 'editar',
            resultado: serializar(x.calc.resultado),
            mudancas: {
              tarefas: [],
              dependencias: [],
              aviso:
                n === MAX_EQUIPES || n === 1
                  ? `A tarefa já está com ${atual} ${atual === 1 ? 'equipe' : 'equipes'}: a duração vem da produção da composição × equipes (entre 1 e ${MAX_EQUIPES}).`
                  : `Esse término ainda dá ${atual} ${atual === 1 ? 'equipe' : 'equipes'}: a duração vem da produção da composição × equipes. Arraste mais para mudar o número de equipes.`
            }
          })
          return
        }
        if (!modelo) throw new Error('modelo do ApeX não carregado no worker')
        const entrada = {
          ...x.entrada,
          tarefas: x.entrada.tarefas.map((y) =>
            y.id === cmd.tarefaId ? { ...y, qtd_equipes: n } : y
          )
        }
        const calc = calcularPlano(entrada, modelo)
        projetos.set(m.planoId, { entrada, calc })
        responder({
          id: m.id,
          ok: true,
          tipo: 'editar',
          resultado: serializar(calc.resultado),
          mudancas: { tarefas: [{ id: cmd.tarefaId, qtd_equipes: n }], dependencias: [] }
        })
        return
      }
      const mudancas = aplicarComando(x.entrada, x.calc, m.comando)
      responder({
        id: m.id,
        ok: true,
        tipo: 'editar',
        resultado: serializar(x.calc.resultado),
        mudancas
      })
      return
    }
  } catch (e) {
    // o comando pode ter deixado o projeto pela metade: o próximo cálculo remonta
    if (m.tipo === 'editar') projetos.delete(m.planoId)
    responder({ id: m.id, ok: false, erro: e instanceof Error ? e.message : String(e) })
  }
}
