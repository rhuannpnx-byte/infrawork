/** Mensagem de um erro de gravação: vale para `Error` e para o erro do Supabase, que é um objeto comum. */
export function detalheDoErro(err: unknown): string | undefined {
  if (err instanceof Error) return err.message || undefined
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === 'string' && m ? m : undefined
}
