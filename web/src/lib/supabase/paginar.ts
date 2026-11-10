/**
 * A API do Supabase (PostgREST) devolve no máximo 1000 linhas por chamada e corta o resto sem avisar — `.limit(10000)`
 * não passa disso. Para listas que crescem (produção, viagens, perfis do cronograma), lê página a página até acabar.
 *
 * A consulta precisa de ordem estável, terminando numa coluna única (ex.: `.order('id')`), senão as páginas podem
 * repetir ou pular linhas.
 */
export const PAGINA_API = 1000

export async function lerTodas<T = Record<string, unknown>>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
  limite = Infinity
): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; de < limite; de += PAGINA_API) {
    const ate = Math.min(de + PAGINA_API, limite) - 1
    const { data, error } = await consulta(de, ate)
    if (error) throw error
    const linhas = (Array.isArray(data) ? data : []) as T[]
    out.push(...linhas)
    if (linhas.length < ate - de + 1) break
  }
  return out
}
