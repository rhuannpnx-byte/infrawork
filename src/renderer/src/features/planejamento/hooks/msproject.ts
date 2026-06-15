// Orquestração da troca de cronograma com o MS Project (XML PDI).
//   - exportarCronogramaXml: monta o XML (cronograma-msproject) e grava via IPC.
//   - aplicarImportacao: materializa as tarefas mapeadas num planejamento
//     (novo ou existente), cria dependências e dispara o recálculo CPM.
//
// Inserts diretos via supabase-js (mesma estratégia dos hooks de tarefa). O
// edge `calcular-cronograma` recalcula datas/CPM/perfil ao final (decisão:
// "recalcular pelo CPM").

import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  DependenciaTipo,
  PlanejamentoDependencia,
  PlanejamentoTarefaCompleta
} from '@/types/planejamento'
import { buildMsProjectXml } from '../lib/cronograma-msproject'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

// ─── Export ──────────────────────────────────────────────────────────────
export interface ExportarCronogramaInput {
  projectName: string
  filenameBase: string
  tarefas: PlanejamentoTarefaCompleta[]
  dependencias: PlanejamentoDependencia[]
  bitmask?: number
}

export async function exportarCronogramaXml(
  input: ExportarCronogramaInput
): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }> {
  const xml = buildMsProjectXml({
    projectName: input.projectName,
    tarefas: input.tarefas,
    dependencias: input.dependencias,
    bitmask: input.bitmask
  })
  return window.infrawork.cronograma.exportXml({ xml, filenameBase: input.filenameBase })
}

// ─── Import (aplicação) ────────────────────────────────────────────────────
// Tabela oficial do MS Project: 0=FF, 1=FS, 2=SF, 3=SS (SF/SS fora da ordem
// intuitiva — precisa casar com TIPO_TO_MSP no serializer).
const MSP_TYPE_TO_TIPO: Record<number, DependenciaTipo> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' }

/** Mapeamento de uma tarefa-folha do MSP → entidades do sistema. */
export interface LeafMap {
  itemId: string
  trechoId: string
  quantidade: number
  equipeIds: string[]
}

export interface AplicarImportacaoParams {
  obraId: string
  destino:
    | { mode: 'novo'; nome: string; dataReferencia: string }
    | { mode: 'existente'; planejamentoId: string }
  /** Tarefas do MSP em ordem de documento. */
  tasks: MspTask[]
  /** uid → mapeamento (apenas folhas). */
  mapeamento: Map<number, LeafMap>
}

export interface AplicarImportacaoResult {
  planejamentoId: string
  tarefasCriadas: number
  dependenciasCriadas: number
  avisos: string[]
  erros: string[]
}

interface GrupoStackItem {
  newId: string
  nivel: 1 | 2 | 3
  mspLevel: number
}

export async function aplicarImportacao(
  params: AplicarImportacaoParams
): Promise<AplicarImportacaoResult> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  const { obraId, destino, tasks, mapeamento } = params
  const avisos: string[] = []
  const erros: string[] = []

  // 1. Planejamento destino.
  let planejamentoId: string
  if (destino.mode === 'novo') {
    const { data, error } = await supabase
      .from('planejamento')
      .insert({
        obra_id: obraId,
        nome: destino.nome.trim(),
        data_referencia_inicio: destino.dataReferencia,
        status: 'ativo'
      })
      .select('id')
      .single()
    if (error) throw error
    planejamentoId = data.id as string
  } else {
    planejamentoId = destino.planejamentoId
  }

  // 2. Insere nós em ordem de documento, mantendo pilha de grupos (≤ nível 2).
  const uidToNew = new Map<number, string>()
  const equipeRows: Array<{ tarefa_id: string; equipe_id: string; qtd_equipes: number }> = []
  const grupoStack: GrupoStackItem[] = []
  let ordem = 0
  let criadas = 0

  for (const t of tasks) {
    while (grupoStack.length && grupoStack[grupoStack.length - 1].mspLevel >= t.outlineLevel) {
      grupoStack.pop()
    }
    const parent = grupoStack.length ? grupoStack[grupoStack.length - 1] : null
    const parentId = parent?.newId ?? null

    if (t.summary) {
      // Grupo — só materializa até nível 2; mais profundo vira passthrough.
      if (grupoStack.length >= 2) continue
      const nivel = (grupoStack.length + 1) as 1 | 2 | 3
      const { data, error } = await supabase
        .from('planejamento_tarefa')
        .insert({
          planejamento_id: planejamentoId,
          tipo_no: 'grupo',
          nivel,
          parent_id: parentId,
          nome_custom: t.name,
          ordem: ordem++
        })
        .select('id')
        .single()
      if (error) { erros.push(`Grupo "${t.name}": ${error.message}`); continue }
      const newId = data.id as string
      uidToNew.set(t.uid, newId)
      grupoStack.push({ newId, nivel, mspLevel: t.outlineLevel })
      criadas++
      continue
    }

    const nivel = (parent ? Math.min(parent.nivel + 1, 3) : 1) as 1 | 2 | 3

    if (t.milestone) {
      const { data, error } = await supabase
        .from('planejamento_tarefa')
        .insert({
          planejamento_id: planejamentoId,
          tipo_no: 'marco',
          nivel,
          parent_id: parentId,
          nome_custom: t.name,
          data_inicio: t.startISO,
          data_fim: t.startISO,
          duracao_dias_uteis_calc: 0,
          data_inicio_manual: true,
          ordem: ordem++
        })
        .select('id')
        .single()
      if (error) { erros.push(`Marco "${t.name}": ${error.message}`); continue }
      uidToNew.set(t.uid, data.id as string)
      criadas++
      continue
    }

    // Tarefa-folha — exige mapeamento.
    const m = mapeamento.get(t.uid)
    if (!m) { erros.push(`Tarefa "${t.name}" sem mapeamento — ignorada.`); continue }
    const { data, error } = await supabase
      .from('planejamento_tarefa')
      .insert({
        planejamento_id: planejamentoId,
        tipo_no: 'tarefa',
        item_orcamentario_id: m.itemId,
        trecho_id: m.trechoId,
        quantidade_alocada: m.quantidade,
        nivel,
        parent_id: parentId,
        ordem: ordem++
      })
      .select('id')
      .single()
    if (error) { erros.push(`Tarefa "${t.name}": ${error.message}`); continue }
    const newId = data.id as string
    uidToNew.set(t.uid, newId)
    for (const eq of m.equipeIds) equipeRows.push({ tarefa_id: newId, equipe_id: eq, qtd_equipes: 1 })
    criadas++
  }

  // 3. Equipes alocadas.
  if (equipeRows.length) {
    const { error } = await supabase.from('planejamento_tarefa_equipe').insert(equipeRows)
    if (error) avisos.push(`Equipes não alocadas: ${error.message}`)
  }

  // 4. Dependências (dedup pred→succ).
  const depRows: Array<{
    planejamento_id: string
    predecessora_id: string
    sucessora_id: string
    tipo: DependenciaTipo
    lag_dias: number
  }> = []
  const vistos = new Set<string>()
  for (const t of tasks) {
    const succId = uidToNew.get(t.uid)
    if (!succId) continue
    for (const p of t.predecessors) {
      const predId = uidToNew.get(p.predUid)
      if (!predId || predId === succId) continue
      const key = `${predId}>${succId}`
      if (vistos.has(key)) continue
      vistos.add(key)
      depRows.push({
        planejamento_id: planejamentoId,
        predecessora_id: predId,
        sucessora_id: succId,
        tipo: MSP_TYPE_TO_TIPO[p.mspType] ?? 'FS',
        lag_dias: Math.round(p.lagDias)
      })
    }
  }
  let dependenciasCriadas = 0
  if (depRows.length) {
    const { error } = await supabase.from('planejamento_dependencia').insert(depRows)
    if (error) avisos.push(`Dependências não criadas: ${error.message}`)
    else dependenciasCriadas = depRows.length
  }

  // 5. Recálculo CPM (datas/perfil). Ciclo → vira aviso, tarefas já existem.
  try {
    await adminApi.calcularCronograma({ planejamento_id: planejamentoId, force: true })
  } catch (e) {
    avisos.push(
      `Recálculo não concluiu: ${e instanceof Error ? e.message : String(e)}. ` +
        'Abra o cronograma e clique em Recalcular após revisar dependências.'
    )
  }

  return { planejamentoId, tarefasCriadas: criadas, dependenciasCriadas, avisos, erros }
}
