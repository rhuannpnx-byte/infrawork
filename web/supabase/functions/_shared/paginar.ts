/**
 * A API (PostgREST) devolve no máximo 1000 linhas por chamada, também para a service role. Lê página a página até
 * acabar. A consulta precisa de ordem estável terminando numa coluna única (ex.: `.order('id')`).
 * Mesma regra de web/src/lib/supabase/paginar.ts.
 */
const PAGINA = 1000

export async function lerTodas<T = Record<string, unknown>>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) return { data: out, error: error as { message: string } }
    const linhas = (Array.isArray(data) ? data : []) as T[]
    out.push(...linhas)
    if (linhas.length < PAGINA) return { data: out, error: null }
  }
}
