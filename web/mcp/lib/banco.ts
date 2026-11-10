/** Leitura e escrita como o usuário, sempre paginando (a API devolve no máximo 1000 linhas por chamada). */
import { ctxAtual } from '../contexto'

export type Op =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is' | 'not_is'
export interface Filtro {
  coluna: string
  op: Op
  valor: unknown
}

const PASSO = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any

function aplicar(q: Q, filtros: Filtro[]): Q {
  for (const f of filtros) {
    if (f.op === 'in') q = q.in(f.coluna, f.valor as unknown[])
    else if (f.op === 'is') q = q.is(f.coluna, f.valor)
    else if (f.op === 'not_is') q = q.not(f.coluna, 'is', f.valor)
    else q = q[f.op](f.coluna, f.valor)
  }
  return q
}

/** Lê até `limite` linhas, em páginas de 1000. */
export async function ler<T = Record<string, unknown>>(
  tabela: string,
  opts: {
    colunas?: string
    filtros?: Filtro[]
    ordem?: { coluna: string; asc?: boolean }[]
    limite?: number
  } = {}
): Promise<T[]> {
  const sb = ctxAtual().sb
  const limite = opts.limite ?? 50_000
  const out: T[] = []
  // páginas só são estáveis com ordem total: desempata por id (tabela/view sem id lê sem desempate)
  let desempate = !(opts.ordem ?? []).some((o) => o.coluna === 'id')
  for (let de = 0; de < limite; de += PASSO) {
    let q: Q = sb.from(tabela).select(opts.colunas ?? '*')
    q = aplicar(q, opts.filtros ?? [])
    for (const o of opts.ordem ?? []) q = q.order(o.coluna, { ascending: o.asc ?? true })
    if (desempate) q = q.order('id')
    const ate = Math.min(de + PASSO, limite) - 1
    const { data, error } = await q.range(de, ate)
    if (
      error &&
      desempate &&
      de === 0 &&
      /\bid\b.*does not exist|42703/.test(`${error.message} ${error.code}`)
    ) {
      desempate = false
      de -= PASSO
      continue
    }
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < ate - de + 1) break
  }
  return out
}

export const eq = (coluna: string, valor: unknown): Filtro => ({ coluna, op: 'eq', valor })

/** Insert/update/upsert/delete com o erro do banco repassado. */
export async function gravar<T = Record<string, unknown>>(
  tabela: string,
  op: 'insert' | 'update' | 'upsert' | 'delete',
  dados: Record<string, unknown> | Record<string, unknown>[] | null,
  filtros: Filtro[] = [],
  opts: { onConflict?: string } = {}
): Promise<T[]> {
  const sb = ctxAtual().sb
  let q: Q
  if (op === 'insert') q = sb.from(tabela).insert(dados as never)
  else if (op === 'upsert')
    q = sb.from(tabela).upsert(dados as never, { onConflict: opts.onConflict })
  else if (op === 'update') q = aplicar(sb.from(tabela).update(dados as never), filtros)
  else q = aplicar(sb.from(tabela).delete(), filtros)
  if ((op === 'update' || op === 'delete') && filtros.length === 0)
    throw new Error(`${op} em ${tabela} sem filtro não é permitido.`)
  const { data, error } = await q.select()
  if (error) throw new Error(`${tabela}: ${error.message}`)
  return (data ?? []) as T[]
}

export async function contar(tabela: string, filtros: Filtro[]): Promise<number> {
  const q = aplicar(ctxAtual().sb.from(tabela).select('*', { count: 'exact', head: true }), filtros)
  const { count, error } = await q
  if (error) throw new Error(`${tabela}: ${error.message}`)
  return count ?? 0
}
