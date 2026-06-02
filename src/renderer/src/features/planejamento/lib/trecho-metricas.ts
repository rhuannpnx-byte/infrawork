// trecho-metricas — resolução de métricas vinculadas (qtd_link).
//
// A tarefa armazena `qtd_link` como NOME de uma coluna do template ativo do
// trecho (ex: "Área pavimentada"). Aqui resolvemos:
//   * `listMetricas(template)` — opções pro popover de vincular
//   * `computeLinkedQtd(task, template)` — valor calculado para qtd_alocada
//
// Cálculo de `computeLinkedQtd`:
//   1. Localiza a coluna pelo nome.
//   2. Para cada segmento do template, calcula a fração de interseção entre
//      [task.posicao_inicio_m, task.posicao_fim_m] e [seg.posicao_inicio_m,
//      seg.posicao_fim_m].
//   3. Multiplica o valor da célula (segmento × coluna) pela fração e soma.
//
// Quando a tarefa não tem posição, retorna NULL — UI deve mostrar "—".

import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

export interface MetricaTemplate {
  /** Identificador estável (= coluna.nome). */
  key: string
  /** Label = coluna.nome (já legível). */
  label: string
  /** Unidade da coluna (ex: 'm²', 'm³', 'km'). */
  unidade: string
  /** Soma de todos os valores desta coluna em todos os segmentos. */
  totalGeral: number
}

/**
 * Lista as métricas disponíveis num template ativo. Retorna [] se o template
 * não tem colunas/segmentos/células ainda.
 */
export function listMetricas(
  template: TrechoQuantidadeVersaoCompleta | null
): MetricaTemplate[] {
  if (!template) return []
  return template.colunas.map((col) => {
    let total = 0
    for (const seg of template.segmentos) {
      const v = seg.valores[col.id]
      if (typeof v === 'number' && Number.isFinite(v)) total += v
    }
    return {
      key: col.nome,
      label: col.nome,
      unidade: col.unidade,
      totalGeral: Math.round(total * 100) / 100
    }
  })
}

/**
 * Computa o valor de qtd_alocada para uma tarefa com qtd_link setado.
 * Retorna NULL se faltam dados (sem posição, sem template, sem coluna).
 */
export function computeLinkedQtd(
  task: {
    qtd_link: string | null
    posicao_inicio_m: number | null
    posicao_fim_m: number | null
  },
  template: TrechoQuantidadeVersaoCompleta | null
): number | null {
  if (!task.qtd_link) return null
  if (task.posicao_inicio_m == null || task.posicao_fim_m == null) return null
  if (!template) return null

  // Localiza coluna pelo nome (estável entre versões — useNovaVersao clona nome)
  const col = template.colunas.find((c) => c.nome === task.qtd_link)
  if (!col) return null

  const taskIni = Math.min(task.posicao_inicio_m, task.posicao_fim_m)
  const taskFim = Math.max(task.posicao_inicio_m, task.posicao_fim_m)
  if (taskFim <= taskIni) {
    // Tarefa pontual — retorna 0 (não há comprimento pra distribuir)
    return 0
  }

  let total = 0
  for (const seg of template.segmentos) {
    const segIni = Math.min(seg.posicao_inicio_m, seg.posicao_fim_m)
    const segFim = Math.max(seg.posicao_inicio_m, seg.posicao_fim_m)
    const segLen = segFim - segIni
    if (segLen <= 0) continue

    // Interseção [max(iniA,iniB), min(fimA,fimB)]
    const interIni = Math.max(taskIni, segIni)
    const interFim = Math.min(taskFim, segFim)
    const interLen = interFim - interIni
    if (interLen <= 0) continue

    const valor = seg.valores[col.id]
    if (typeof valor !== 'number' || !Number.isFinite(valor)) continue

    // Fração do segmento contida na tarefa
    const fracao = interLen / segLen
    total += valor * fracao
  }

  return Math.round(total * 100) / 100
}

/** Verifica se há template + colunas disponíveis pra vincular. */
export function hasMetricasDisponiveis(
  template: TrechoQuantidadeVersaoCompleta | null
): boolean {
  return !!template && template.colunas.length > 0
}
