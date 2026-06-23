// Diff entre o plano anterior e o novo (após um refino do agente), para o
// painel central destacar "ao vivo" o que mudou:
//   - added: receitas que entraram num grupo (ou trocaram de serviço) → verde
//   - removedByServico: receitas que SAÍRAM de cada serviço → fantasma vermelho
//
// A identidade de um grupo, para fins de diff, é o `servico_id` (um serviço =
// um grupo). Assim "mover receita do CBUQ para a Base" aparece como removida no
// CBUQ e adicionada na Base.

import type { GrupoSugerido, ReceitaSugerida } from '@/types/agrupamento'

export interface DiffResult {
  /** Ids de receitas que entraram/trocaram de grupo neste turno. */
  added: Set<string>
  /** servico_id → receitas que deixaram aquele grupo neste turno. */
  removedByServico: Map<string, ReceitaSugerida[]>
}

export const DIFF_TTL_MS = 2800

function servicoPorReceita(grupos: GrupoSugerido[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const g of grupos) for (const r of g.receitas) m.set(r.id, g.servico_id)
  return m
}

export function diffPlanos(prev: GrupoSugerido[], next: GrupoSugerido[]): DiffResult {
  const prevServ = servicoPorReceita(prev)
  const nextServ = servicoPorReceita(next)

  // Adicionadas: presentes no novo, mas em serviço diferente do anterior
  // (inclui receitas que não estavam em nenhum grupo antes).
  const added = new Set<string>()
  for (const g of next) {
    for (const r of g.receitas) {
      if (prevServ.get(r.id) !== g.servico_id) added.add(r.id)
    }
  }

  // Removidas por serviço: estavam num serviço no plano anterior e não estão
  // mais nele no novo (saíram do grupo ou foram para outro serviço).
  const removedByServico = new Map<string, ReceitaSugerida[]>()
  for (const g of prev) {
    for (const r of g.receitas) {
      if (nextServ.get(r.id) === g.servico_id) continue
      const arr = removedByServico.get(g.servico_id) ?? []
      arr.push(r)
      removedByServico.set(g.servico_id, arr)
    }
  }

  return { added, removedByServico }
}
