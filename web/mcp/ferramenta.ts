/**
 * Definição de uma ferramenta do MCP. Cada ferramenta declara o que cobre no banco (tabelas, views, RPCs e Edge
 * Functions) — é o que o teste de cobertura (cobertura.test.ts) confere contra as migrações, para o MCP não ficar
 * para trás quando o sistema muda.
 */
import { z } from 'zod'

export interface Cobertura {
  tabelas?: string[]
  rpcs?: string[]
  funcoes?: string[]
}

export interface Ferramenta<S extends z.ZodRawShape = z.ZodRawShape> {
  nome: string
  titulo: string
  descricao: string
  entrada: S
  /** só lê (os clientes podem chamar sem pedir permissão ao usuário) */
  leitura?: boolean
  /** apaga ou mexe em muita coisa: a 1ª chamada devolve o impacto; só grava com confirmar=true */
  destrutiva?: boolean
  cobre: Cobertura
  executar: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>
}

export const ferramenta = <S extends z.ZodRawShape>(f: Ferramenta<S>): Ferramenta<S> => f

/** Campo padrão das ações destrutivas. */
export const CONFIRMAR = z
  .boolean()
  .optional()
  .describe(
    'Passe true só depois de mostrar ao usuário o impacto devolvido pela chamada sem confirmar.'
  )

export interface PedidoConfirmacao {
  precisa_confirmar: true
  acao: string
  impacto: unknown
  instrucao: string
}

/** Sem confirmar=true, devolve o impacto e não grava nada. */
export function pedirConfirmacao(
  confirmar: boolean | undefined,
  acao: string,
  impacto: unknown
): PedidoConfirmacao | null {
  if (confirmar === true) return null
  return {
    precisa_confirmar: true,
    acao,
    impacto,
    instrucao:
      'Nada foi alterado. Mostre o impacto ao usuário e, se ele concordar, chame de novo com confirmar: true.'
  }
}

/** Erro de uso da ferramenta (argumento faltando para a ação escolhida). */
export function exigir<T>(v: T | null | undefined, campo: string, acao: string): T {
  if (v === undefined || v === null || v === '')
    throw new Error(`A ação "${acao}" precisa do campo "${campo}".`)
  return v
}
