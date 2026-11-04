/**
 * Comandos de edição das visões (os do Gantt e do tempo-caminho do ApeX) aplicados ao projeto calculado no worker.
 *
 * Cada comando roda como no ApeX (`setBeginTime`, `setEndTime`, `addUserDependency`, `packSchedule`), devolve o
 * resultado já recalculado (prévia imediata na tela) e o que precisa ser gravado no banco para que o próximo cálculo,
 * feito a partir do banco, chegue ao mesmo lugar:
 * - mover o início (tarefa não ASAP): o início desejado = `inicio_em`;
 * - mover o fim: o **número de equipes** (inteiro) que mais se aproxima da duração pedida. No ApeX o fim arrastado
 *   reescreve o coeficiente da taxa de produção (`setEndTime` → `m_dWachCoeff`); no InfraWork a produção é a da
 *   composição × equipes, então o arraste nunca mexe na produtividade (DECISOES D-21). A prévia é um recálculo com
 *   as equipes novas (`recalcularComEquipes`, no worker);
 * - nova dependência: a linha em `planejamento_dependencia`;
 * - compactar: as prioridades e o início desejado de todas as tarefas = início do projeto.
 */
import { Calendar } from '@apex/calendar'
import {
  addUserDependency,
  DEP,
  packSchedule,
  setBeginTime,
  TimingEditError,
  wouldCreateCycle,
  type DependencyArgs
} from '@apex/engine'
import type { Entity } from '@apex/model'
import { extrairResultado, type PlanoCalculado, type ResultadoCalculo } from './calculo'
import { segParaTimestamp } from './tempo'
import type { PlanoEntrada, TipoDependencia } from './tipos'

export type ComandoEdicao =
  | { tipo: 'inicio'; tarefaId: string; em: number }
  /** término desejado → número de equipes (a duração vem da composição × equipes) */
  | { tipo: 'fim'; tarefaId: string; em: number }
  | {
      tipo: 'dependencia'
      predecessora: string
      sucessora: string
      dep: TipoDependencia
      atraso_min: number | null
      atraso_max: number | null
      dias_uteis: boolean
    }
  | { tipo: 'compactar' }

export interface MudancaTarefa {
  id: string
  inicio_em?: string
  qtd_equipes?: number
  prioridade?: number
}

export const MAX_EQUIPES = 50

/**
 * Equipes para o término desejado: a duração (horas de trabalho no calendário da tarefa) é inversamente proporcional
 * ao número de equipes, então `n' = round(n · duração atual / duração pedida)`, entre 1 e 50. É uma estimativa: esperas
 * por dependências não encolhem com mais equipes (o recálculo mostra o término real).
 */
export function equipesParaTermino(
  r: ResultadoCalculo,
  e: PlanoEntrada,
  tarefaId: string,
  em: number
): number | null {
  const t = e.tarefas.find((x) => x.id === tarefaId)
  const res = r.tarefas.get(tarefaId)
  if (!t || !res) return null
  const spec = r.calendarios[res.calendario_id] ?? r.calendarios[r.calendarioPadraoId]
  if (!spec) return null
  const cal = new Calendar(spec)
  const atual = cal.AS2WS(res.fim) - cal.AS2WS(res.inicio)
  const pedida = cal.AS2WS(em) - cal.AS2WS(res.inicio)
  if (!(atual > 0)) return null
  if (!(pedida > 0)) return MAX_EQUIPES
  const n = Math.max(1, Math.round(t.qtd_equipes || 1))
  return Math.max(1, Math.min(MAX_EQUIPES, Math.round((n * atual) / pedida)))
}

export interface MudancasEdicao {
  tarefas: MudancaTarefa[]
  dependencias: {
    predecessora_id: string
    sucessora_id: string
    tipo: TipoDependencia
    atraso_min: number | null
    atraso_max: number | null
    dias_uteis: boolean
  }[]
  /** o comando não mudou nada, com o motivo (mostrado ao usuário) */
  aviso?: string
}

/** Mensagens dos erros de edição do motor (textos do original em português). */
export const MENSAGENS_EDICAO: Record<string, string> = {
  BEGIN_TIME_GREATER_THAN_END_TIME: 'O início é posterior ao término.',
  CIRCULAR_DEPENDENCY:
    'A dependência não pôde ser adicionada porque levaria a uma dependência circular.',
  SAME_TASK: 'A dependência precisa ligar duas tarefas diferentes.'
}

export class EdicaoErro extends Error {}

const TIPO_DEP: Record<TipoDependencia, number> = {
  FS: DEP.FINISH_START,
  SS: DEP.START_START,
  FF: DEP.FINISH_FINISH,
  SF: DEP.START_FINISH,
  EST: DEP.BY_STATIONS
}

function tarefa(calc: PlanoCalculado, id: string): Entity {
  const t = calc.entidades.get(id)
  if (!t) throw new EdicaoErro('Tarefa fora do cálculo (sem serviço, indireto ou sem produção).')
  return t
}

function traduzir(e: unknown): Error {
  if (e instanceof TimingEditError) return new EdicaoErro(MENSAGENS_EDICAO[e.code] ?? e.message)
  return e instanceof Error ? e : new Error(String(e))
}

/** Aplica o comando ao projeto (no lugar) e devolve as mudanças a gravar; o resultado é relido de `calc.projeto`. */
export function aplicarComando(
  e: PlanoEntrada,
  calc: PlanoCalculado,
  cmd: ComandoEdicao
): MudancasEdicao {
  const p = calc.projeto
  const out: MudancasEdicao = { tarefas: [], dependencias: [] }
  try {
    switch (cmd.tipo) {
      case 'inicio': {
        const t = tarefa(calc, cmd.tarefaId)
        if (t.get('m_bASAP') === true)
          throw new EdicaoErro(
            'A tarefa é "o mais cedo possível": desligue essa opção para fixar o início.'
          )
        p.edit('Editar início', () => setBeginTime(p, t, cmd.em))
        out.tarefas.push({ id: cmd.tarefaId, inicio_em: segParaTimestamp(cmd.em) })
        break
      }
      case 'fim':
        // tratado no worker (`recalcularComEquipes`): muda a entrada e recalcula
        throw new EdicaoErro('Comando de término deve ser aplicado pela entrada (equipes).')
      case 'dependencia': {
        const a = tarefa(calc, cmd.predecessora)
        const b = tarefa(calc, cmd.sucessora)
        if (wouldCreateCycle(p, a.oid, b.oid)) throw new TimingEditError('CIRCULAR_DEPENDENCY')
        const args: DependencyArgs = {
          hasMinDelay: cmd.atraso_min !== null,
          minDelay: cmd.atraso_min ?? 0,
          hasMaxDelay: cmd.atraso_max !== null,
          maxDelay: cmd.atraso_max ?? 0,
          workDays: cmd.dias_uteis,
          color: 0x0000ff,
          lineWidth: 1,
          visibleTD: true,
          visibleGantt: true,
          visibleMap: true
        }
        p.edit('Nova dependência', () => addUserDependency(p, a, b, TIPO_DEP[cmd.dep], args))
        out.dependencias.push({
          predecessora_id: cmd.predecessora,
          sucessora_id: cmd.sucessora,
          tipo: cmd.dep,
          atraso_min: cmd.atraso_min,
          atraso_max: cmd.atraso_max,
          dias_uteis: cmd.dias_uteis
        })
        break
      }
      case 'compactar': {
        const { priorities } = packSchedule(p)
        const idDeOid = new Map([...calc.entidades].map(([id, t]) => [t.oid, id]))
        const inicio = segParaTimestamp(calc.resultado.inicioProjeto)
        for (const [oid, prio] of priorities) {
          const id = idDeOid.get(oid)
          if (id) out.tarefas.push({ id, prioridade: prio, inicio_em: inicio })
        }
        break
      }
    }
  } catch (err) {
    throw traduzir(err)
  }
  const { resultado } = extrairResultado(e, p, calc.obra, calc.relatorio)
  // o controle (realizado e previsão) da prévia é o do último cálculo; o recálculo a partir do banco o refaz
  calc.resultado = calc.resultado.controle
    ? { ...resultado, controle: calc.resultado.controle }
    : resultado
  return out
}
