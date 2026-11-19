/** Recusas comuns do banco, em palavras de quem usa a tela. */
function recusaDoBanco(err: unknown, mensagem: string): string | undefined {
  const codigo = (err as { code?: unknown } | null)?.code
  if (codigo === '23505' || /duplicate key value/i.test(mensagem))
    return 'Já existe um registro com esse código ou nome.'
  if (codigo === '23503' || /violates foreign key/i.test(mensagem))
    return 'Há outros registros ligados a este; ajuste-os antes.'
  return undefined
}

/** Mensagem de um erro de gravação: vale para `Error` e para o erro do Supabase, que é um objeto comum. */
export function detalheDoErro(err: unknown): string | undefined {
  const m = err instanceof Error ? err.message : (err as { message?: unknown } | null)?.message
  if (typeof m !== 'string' || !m) return undefined
  return recusaDoBanco(err, m) ?? m
}
