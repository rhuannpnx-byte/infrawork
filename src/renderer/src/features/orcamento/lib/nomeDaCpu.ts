// Helper compartilhado: nome legível pra uma CPU.
//
// Prioridade (após desacoplamento CPU↔servico):
//   1. cpu.nome — nome próprio da CPU (entidade técnica autônoma).
//   2. servico-dono → "{codigo} · {nome}" (CPUs antigas vinculadas).
//   3. Tenta extrair de notas — fallback pra CPUs antes do backfill rodar.
//   4. Fallback `CPU {id-prefix}`.

export function nomeDaCpu(cpu: {
  nome?: string | null
  notas?: string | null
  servico?: { codigo?: string | null; nome?: string | null; unidade?: string | null } | null
  id: string
}): string {
  if (cpu.nome && cpu.nome.trim() !== '') return cpu.nome
  if (cpu.servico?.nome) {
    const cod = cpu.servico.codigo ? `${cpu.servico.codigo} · ` : ''
    return `${cod}${cpu.servico.nome}`
  }
  const notas = cpu.notas ?? ''
  const mNovo = notas.match(/nome original:\s*"([^"]+)"/)
  if (mNovo) return mNovo[1]
  const mAntigo = notas.match(/^Importada de\s+([^—(]+?)(?:\s*[—(]|$)/)
  if (mAntigo) return mAntigo[1].trim()
  return `CPU ${cpu.id.slice(0, 8)}`
}
