// Catálogo das capacidades: o que pode ser ligado ou desligado por empresa. É assim que o mesmo sistema atende
// empresas com soluções diferentes — nunca com um "se a empresa for X" no código.
//
// A tabela `empresa_capacidade` só guarda o que foge do padrão daqui; empresa sem linha nenhuma usa os padrões.
// Capacidade nova: entra aqui (chave, rótulo, descrição, padrão) e, se o banco precisar conferir, usa
// `empresa_tem(empresa, chave, padrão)` com o mesmo padrão.

export interface DefinicaoCapacidade {
  rotulo: string
  /** o que muda para a empresa quando está ligada */
  descricao: string
  /** valor de quem não tem linha na tabela */
  padrao: boolean
}

export const CAPACIDADES = {
  integracao_siga: {
    rotulo: 'Integração com o SIGA',
    descricao:
      'A produção e as fotos da empresa vêm do SIGA e o que é lançado no InfraWork é gravado lá.',
    padrao: false
  }
} as const satisfies Record<string, DefinicaoCapacidade>

export type Capacidade = keyof typeof CAPACIDADES

export const CHAVES_CAPACIDADE = Object.keys(CAPACIDADES) as Capacidade[]

/** O valor gravado (ou a falta dele) como ligado/desligado: mesma regra de `empresa_tem` no banco. */
export function capacidadeLigada(chave: Capacidade, valor: unknown): boolean {
  if (valor === undefined) return CAPACIDADES[chave].padrao
  if (valor === null) return false
  return typeof valor === 'boolean' ? valor : true
}
