import type { FormaTanque, Tanque } from './lib/tanque'

export type TipoAtivo = 'tanque' | 'deposito'
export type StatusEstoque = 'normal' | 'baixo' | 'zerado' | 'negativo' | 'sem_saldo'
export type LeituraPor = 'cheio' | 'vazio'

/** Uma linha de `vw_estoque_saldo`: o ativo com o saldo, o nível, o status e a última leitura. */
export interface AtivoEstoque {
  id: string
  obra_id: string
  tipo: TipoAtivo
  nome: string
  recurso_id: string
  material: string
  unidade: string
  capacidade: number
  estoque_minimo: number
  lat: number
  lng: number
  ativo: boolean
  obs: string | null
  forma: FormaTanque | null
  /** as medidas do tanque, como foram digitadas (o mesmo objeto de `Tanque`) */
  dimensoes: Tanque | null
  leitura_por: LeituraPor
  altura_referencia_cm: number | null
  densidade_kg_l: number | null
  tabela_versao: number | null
  /** null = ainda sem leitura nem movimento */
  saldo: number | null
  /** saldo ÷ capacidade (pode passar de 1 ou ficar negativo) */
  nivel: number | null
  ultimo_momento: string | null
  leitura_momento: string | null
  leitura_quantidade: number | null
  leitura_diferenca: number | null
  leitura_cm: number | null
  nivel_cm: number | null
  saidas_14d: number
  autonomia_dias: number | null
  status: StatusEstoque
}

/** Uma linha de `vw_estoque_extrato`: movimento ou leitura, com o saldo depois dela. */
export interface LinhaExtrato {
  id: string
  ativo_id: string
  origem: 'movimento' | 'leitura'
  tipo: 'entrada' | 'saida' | 'leitura'
  momento: string
  ordem: number
  quantidade: number
  quantidade_informada: number | null
  unidade_informada: string | null
  densidade_kg_l: number | null
  documento: string | null
  terceiro: string | null
  obs: string | null
  criado_por: string | null
  leitura_cm: number | null
  nivel_cm: number | null
  temperatura_c: number | null
  ajusta_saldo: boolean
  saldo: number
  diferenca: number | null
}

/** O que o cadastro grava em `estoque_ativo`. */
export interface AtivoInput {
  obra_id: string
  tipo: TipoAtivo
  nome: string
  recurso_id: string
  unidade: string
  capacidade: number
  estoque_minimo: number
  lat: number
  lng: number
  ativo: boolean
  obs: string | null
  forma: FormaTanque | null
  dimensoes: Tanque | null
  leitura_por: LeituraPor
  altura_referencia_cm: number | null
  densidade_kg_l: number | null
  tabela: number[] | null
  tabela_versao: number | null
}

export interface MovimentoInput {
  ativo_id: string
  tipo: 'entrada' | 'saida'
  momento: string
  quantidade: number
  quantidade_informada: number | null
  unidade_informada: string | null
  densidade_kg_l: number | null
  documento: string | null
  terceiro: string | null
  obs: string | null
}

export interface LeituraInput {
  ativo_id: string
  momento: string
  /** tanque: o número lido na régua; o banco calcula a altura do líquido e os litros */
  leitura_cm: number | null
  /** depósito: a quantidade medida no monte */
  quantidade: number | null
  temperatura_c: number | null
  ajusta_saldo: boolean
  obs: string | null
}

/** Ordem de gravidade, para ordenar a lista e escolher a cor do marcador. */
export const GRAVIDADE_STATUS: Record<StatusEstoque, number> = {
  negativo: 0,
  zerado: 1,
  baixo: 2,
  sem_saldo: 3,
  normal: 4
}
