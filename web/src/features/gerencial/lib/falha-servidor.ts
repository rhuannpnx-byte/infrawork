/**
 * Falha de gravação dita para o usuário: sem o nome da função do servidor na frente e com as recusas conhecidas
 * em português. `repetido` é a frase para o registro que já existe (código, CNPJ ou e-mail em uso).
 */
export function falhaDoServidor(erro: unknown, repetido?: string): string {
  const bruta = erro instanceof Error ? erro.message : ''
  if (!bruta) return 'Tente de novo.'
  if (/failed to fetch|networkerror|load failed/i.test(bruta))
    return 'Sem conexão com o servidor. Confira a internet e tente de novo.'
  if (
    repetido &&
    /duplicate key|unique constraint|already been registered|already exists/i.test(bruta)
  )
    return repetido
  return bruta.replace(/^[a-z]+(?:-[a-z]+)+: /, '')
}
