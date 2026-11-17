export type CameraDaSimulacao = 'parada' | 'pista' | 'frente'

export interface OpcoesSimulacao {
  /** Segundos que a reprodução leva do começo ao fim do período. */
  duracao: number
  camera: CameraDaSimulacao
  /** Data, semana e percentuais escritos na cena. */
  texto: boolean
}

export const SIMULACAO_PADRAO: OpcoesSimulacao = { duracao: 60, camera: 'parada', texto: true }
