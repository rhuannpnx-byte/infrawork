/**
 * Resultado do cálculo em forma serializável (o Web Worker devolve por postMessage): os Maps viram listas.
 */
import type { ResultadoCalculo, TarefaResultado } from './calculo'
import type { ResultadoIndireto } from './indiretos'

export interface ResultadoSerial {
  tarefas: TarefaResultado[]
  perfilDia: [string, [string, number][]][]
  perfilSemana: [string, [string, number][]][]
  indiretos: ResultadoIndireto[]
  ordem: string[]
  automaticas: ResultadoCalculo['automaticas']
  avisos: string[]
  inicioProjeto: number
  fimProjeto: number | null
  prazoProjeto: number
  calendarios: ResultadoCalculo['calendarios']
  calendarioPadraoId: string
  marcos: ResultadoCalculo['marcos']
  recursos: ResultadoCalculo['recursos']
  controle?: ResultadoCalculo['controle']
}

export function serializar(r: ResultadoCalculo): ResultadoSerial {
  return {
    tarefas: [...r.tarefas.values()],
    perfilDia: [...r.perfilDia].map(([k, m]) => [k, [...m]]),
    perfilSemana: [...r.perfilSemana].map(([k, m]) => [k, [...m]]),
    indiretos: r.indiretos,
    ordem: r.ordem,
    automaticas: r.automaticas,
    avisos: r.avisos,
    inicioProjeto: r.inicioProjeto,
    fimProjeto: r.fimProjeto,
    prazoProjeto: r.prazoProjeto,
    calendarios: r.calendarios,
    calendarioPadraoId: r.calendarioPadraoId,
    marcos: r.marcos,
    recursos: r.recursos,
    ...(r.controle ? { controle: r.controle } : {})
  }
}

export function desserializar(s: ResultadoSerial): ResultadoCalculo {
  return {
    tarefas: new Map(s.tarefas.map((t) => [t.id, t])),
    perfilDia: new Map(s.perfilDia.map(([k, l]) => [k, new Map(l)])),
    perfilSemana: new Map(s.perfilSemana.map(([k, l]) => [k, new Map(l)])),
    indiretos: s.indiretos,
    ordem: s.ordem,
    automaticas: s.automaticas,
    avisos: s.avisos,
    inicioProjeto: s.inicioProjeto,
    fimProjeto: s.fimProjeto,
    prazoProjeto: s.prazoProjeto,
    calendarios: s.calendarios,
    calendarioPadraoId: s.calendarioPadraoId,
    marcos: s.marcos,
    recursos: s.recursos,
    ...(s.controle ? { controle: s.controle } : {})
  }
}
