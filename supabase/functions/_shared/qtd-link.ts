// qtd-link — cálculo server-side de quantidade_alocada para tarefas com
// qtd_link vinculado a métrica do template do trecho.
//
// Espelha src/renderer/src/features/planejamento/lib/trecho-metricas.ts:
//   * `qtd_link` é o NOME de uma coluna do template ativo do trecho
//   * Para cada segmento, calcula fração de interseção entre
//     [task.posicao_inicio_m, task.posicao_fim_m] e [seg.pos_ini, seg.pos_fim]
//   * Soma valor (segmento × coluna) × fração
//
// Edge function calcular-cronograma usa pra atualizar quantidade_alocada
// das tarefas vinculadas antes do forward pass. Se a posição/trecho mudou,
// próximo recalc reflete a qtd correta sem operador precisar editar.

export interface TemplateColuna {
  id: string
  nome: string
  unidade: string
}

export interface TemplateSegmento {
  id: string
  posicao_inicio_m: number
  posicao_fim_m: number
  /** Map coluna_id → valor. */
  valores: Record<string, number>
}

export interface TemplateAtivo {
  versao_id: string
  colunas: TemplateColuna[]
  segmentos: TemplateSegmento[]
}

export interface TarefaParaQtdLink {
  id: string
  trecho_id: string | null
  qtd_link: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
}

/**
 * Calcula quantidade_alocada para uma tarefa com qtd_link.
 * Retorna NULL se faltam dados (sem template, sem posição, coluna inexistente).
 */
export function computeLinkedQtd(
  tarefa: TarefaParaQtdLink,
  template: TemplateAtivo | null
): number | null {
  if (!tarefa.qtd_link) return null
  if (tarefa.posicao_inicio_m == null || tarefa.posicao_fim_m == null) return null
  if (!template) return null

  const col = template.colunas.find((c) => c.nome === tarefa.qtd_link)
  if (!col) {
    console.warn(
      `[computeLinkedQtd ${tarefa.id}] coluna "${tarefa.qtd_link}" nao existe no template ` +
      `(disponiveis: ${template.colunas.map((c) => c.nome).join(', ')})`
    )
    return null
  }

  const taskIni = Math.min(tarefa.posicao_inicio_m, tarefa.posicao_fim_m)
  const taskFim = Math.max(tarefa.posicao_inicio_m, tarefa.posicao_fim_m)
  if (taskFim <= taskIni) {
    console.warn(`[computeLinkedQtd ${tarefa.id}] taskFim <= taskIni (${taskFim} <= ${taskIni})`)
    return 0
  }

  let total = 0
  let segsAvaliados = 0
  let segsComIntersecao = 0
  let segsComValor = 0
  for (const seg of template.segmentos) {
    segsAvaliados++
    const segIni = Math.min(seg.posicao_inicio_m, seg.posicao_fim_m)
    const segFim = Math.max(seg.posicao_inicio_m, seg.posicao_fim_m)
    const segLen = segFim - segIni
    if (segLen <= 0) continue

    const interIni = Math.max(taskIni, segIni)
    const interFim = Math.min(taskFim, segFim)
    const interLen = interFim - interIni
    if (interLen <= 0) continue
    segsComIntersecao++

    const valor = seg.valores[col.id]
    if (typeof valor !== 'number' || !Number.isFinite(valor)) continue
    segsComValor++

    const fracao = interLen / segLen
    total += valor * fracao
  }

  const resultado = Math.round(total * 100) / 100
  console.log(
    `[computeLinkedQtd ${tarefa.id}] qtd_link="${tarefa.qtd_link}" ` +
    `task=[${taskIni}, ${taskFim}] col_id=${col.id} ` +
    `segs(aval/inter/valor)=${segsAvaliados}/${segsComIntersecao}/${segsComValor} ` +
    `total=${total} → resultado=${resultado}`
  )
  return resultado
}
