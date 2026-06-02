// POST /functions/v1/copiar-revisao-orcamento
//
// Cria uma "nova versão de trabalho" do orçamento de uma obra: limpa o estado
// LIVE (item_orcamentario, indireto_item, recurso, cpu+cpu_item) e, opcionalmente,
// repovoa com itens selecionados de uma revisão de origem (snapshot JSONB).
//
// Antes de apagar, AUTO-CRIA um snapshot "preservação" da obra atual (se houver
// dados) para que nada se perca — fica como revisão `rascunho` rotulada
// "Auto: pré-reset $TIMESTAMP".
//
// Body:
//   {
//     obra_id: string,
//     origem_revisao_id: string | null,           // null = começar do zero
//     rotulo?: string,
//     observacao?: string,
//     copiar?: {
//       planilha?: 'tudo' | string[] | null,      // IDs dos snapshot.itens
//       indireto?: 'tudo' | string[] | null,      // IDs dos snapshot.indireto
//       recursos?: 'tudo' | string[] | null,      // hoje: snapshot não captura recursos →
//                                                 // se 'tudo'/[], preserva recursos atuais
//       cpus?:     'tudo' | string[] | null       // similar a recursos
//     }
//   }
//
// Limitações conhecidas:
//   - `recurso`/`recurso_preco` e `cpu`/`cpu_item` NÃO estão hoje no snapshot
//     JSONB (snapshot_orcamento_atual só captura obras+itens+indireto+cpu_snapshots).
//     Quando copiar.recursos/cpus = 'tudo', a função PRESERVA os recursos/cpus
//     vivos atuais (não apaga). Quando = []/null, APAGA. Para futuro: incluir
//     no snapshot e copiar do JSONB.
//   - `cpu_snapshot` é blindado contra DELETE quando referenciado. Mantemos os
//     snapshots no banco (sucata histórica). Eles ficam órfãos após o reset.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

type Selecao = 'tudo' | string[] | null | undefined

interface Body {
  obra_id?: string
  origem_revisao_id?: string | null
  rotulo?: string
  observacao?: string
  copiar?: {
    planilha?: Selecao
    indireto?: Selecao
    recursos?: Selecao
    cpus?: Selecao
  }
}

interface ItemSnap {
  id: string
  obra_id: string
  parent_id: string | null
  nivel: number
  codigo: string
  descricao: string
  tipo: 'receita' | 'servico_grupo' | 'etapa'
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  servico_id: string | null
  cpu_snapshot_id: string | null
  indireto_id: string | null
  quantidade_referencia: number | null
  unidade_referencia: string | null
  qtd_ref_modo: 'manual' | 'heranca' | 'soma_filhos' | null
  qtd_ref_filhos: string[] | null
  ordem: number
}

interface IndiretoSnap {
  id: string
  obra_id: string
  parent_id: string | null
  codigo: string
  descricao: string
  tipo: string
  valor_total: number
  distribuicao_perc: number
  ordem: number
}

function selecionar(sel: Selecao, allIds: string[]): string[] {
  if (sel === 'tudo') return allIds
  if (Array.isArray(sel)) return sel
  return []
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)

  const accErr = await assertObraAccess(ctx, obra_id, { write: true })
  if (accErr) return accErr

  const copiar = body.copiar ?? {}
  const origem_revisao_id = body.origem_revisao_id?.trim() || null

  // ─── 0. Pre-check: planejamentos referenciando itens do orçamento ────────
  // planejamento_tarefa.item_orcamentario_id é FK ON DELETE RESTRICT.
  // Se houver QUALQUER tarefa vinculada a algum item desta obra, o delete
  // dispara erro de constraint. Bloqueamos a operação antes de mexer em nada.
  const { count: tarefasCount, error: tarefasErr } = await admin
    .from('planejamento_tarefa')
    .select('id, planejamento!inner(obra_id)', { count: 'exact', head: true })
    .eq('planejamento.obra_id', obra_id)
  if (tarefasErr) {
    return json({ error: 'Falha ao verificar planejamentos', detalhe: tarefasErr.message }, 500)
  }
  if ((tarefasCount ?? 0) > 0) {
    const { count: planCount } = await admin
      .from('planejamento')
      .select('id', { count: 'exact', head: true })
      .eq('obra_id', obra_id)
    return json(
      {
        error:
          `Não é possível resetar o orçamento: existem ${planCount ?? 0} planejamento(s) com ` +
          `${tarefasCount} tarefa(s) vinculadas a itens do orçamento. ` +
          `Apague esses planejamentos (ou suas tarefas) antes de criar uma nova versão.`,
        detalhe: 'planejamento_tarefa.item_orcamentario_id é FK ON DELETE RESTRICT.',
        planejamentos_count: planCount ?? 0,
        tarefas_count: tarefasCount ?? 0
      },
      409
    )
  }

  // ─── 1. Auto-snapshot do estado atual (preservação) ──────────────────────
  // Se há qualquer dado live, cria revisão rascunho via snapshot_orcamento_atual.
  let snapshotPreservacaoId: string | null = null
  const { count: liveCount } = await admin
    .from('item_orcamentario')
    .select('id', { count: 'exact', head: true })
    .eq('obra_id', obra_id)

  if ((liveCount ?? 0) > 0) {
    const { data: snapJson, error: snapErr } = await admin.rpc('snapshot_orcamento_atual', {
      _obra_id: obra_id
    })
    if (snapErr) return json({ error: 'Falha ao snapshotar estado atual', detalhe: snapErr.message }, 500)

    const totais = (snapJson as { totais?: { custo_direto: number; venda_total: number } })?.totais ?? {
      custo_direto: 0,
      venda_total: 0
    }
    const { data: nova, error: insRevErr } = await admin
      .from('revisao_orcamento')
      .insert({
        obra_id,
        rotulo: `Auto: pré-reset ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        status: 'rascunho',
        snapshot: snapJson,
        custo_total: totais.custo_direto,
        venda_total: totais.venda_total,
        observacao: 'Preservação automática antes de reset por copiar-revisao-orcamento.',
        criada_por: caller.id
      })
      .select('id')
      .single()
    if (insRevErr) return json({ error: 'Falha ao criar revisão de preservação', detalhe: insRevErr.message }, 500)
    snapshotPreservacaoId = nova.id
  }

  // ─── 2. Carrega snapshot da revisão de origem (se especificada) ──────────
  let origemSnap: {
    itens: ItemSnap[]
    indireto: IndiretoSnap[]
  } | null = null
  if (origem_revisao_id) {
    const { data: rev, error: revErr } = await admin
      .from('revisao_orcamento')
      .select('id, obra_id, snapshot')
      .eq('id', origem_revisao_id)
      .maybeSingle()
    if (revErr || !rev) return json({ error: 'Revisão de origem não encontrada' }, 404)
    if (rev.obra_id !== obra_id) {
      return json({ error: 'Revisão de origem pertence a outra obra' }, 400)
    }
    const snap = rev.snapshot as { itens?: ItemSnap[]; indireto?: IndiretoSnap[] }
    origemSnap = {
      itens: snap?.itens ?? [],
      indireto: snap?.indireto ?? []
    }
  }

  // ─── 3. Limpa estado live ────────────────────────────────────────────────
  // Ordem: itens → indireto → cpu_item → cpu → recurso_preco → recurso.
  // cpu_snapshot é blindado contra DELETE: fica como sucata após órfão.
  const apagarRecursos = copiar.recursos !== 'tudo' && !(Array.isArray(copiar.recursos) && copiar.recursos.length > 0)
  const apagarCpus = copiar.cpus !== 'tudo' && !(Array.isArray(copiar.cpus) && copiar.cpus.length > 0)

  // 3a. Item orçamentário (cascade já remove memoria/comentario/anexo via FK).
  const { error: delItemErr } = await admin
    .from('item_orcamentario')
    .delete()
    .eq('obra_id', obra_id)
  if (delItemErr) {
    return json({ error: 'Falha ao apagar planilha', detalhe: delItemErr.message }, 500)
  }

  // 3b. Indireto.
  const { error: delIndErr } = await admin
    .from('indireto_item')
    .delete()
    .eq('obra_id', obra_id)
  if (delIndErr) return json({ error: 'Falha ao apagar indireto', detalhe: delIndErr.message }, 500)

  // 3c. CPUs (se solicitado apagar — quando o user não escolheu manter).
  if (apagarCpus) {
    // cpu_item cascata via FK. Apaga cpu da obra.
    const { error: delCpuErr } = await admin.from('cpu').delete().eq('obra_id', obra_id)
    if (delCpuErr) return json({ error: 'Falha ao apagar CPUs', detalhe: delCpuErr.message }, 500)
  }

  // 3d. Recursos (se solicitado apagar).
  if (apagarRecursos) {
    const { error: delRecErr } = await admin.from('recurso').delete().eq('obra_id', obra_id)
    if (delRecErr) return json({ error: 'Falha ao apagar recursos', detalhe: delRecErr.message }, 500)
  }

  // ─── 4. Copia itens selecionados do snapshot de origem ───────────────────
  let itensCopiados = 0
  let indiretosCopiados = 0

  if (origemSnap) {
    // 4a. INDIRETOS primeiro (precisam existir antes do plan_orc que pode referenciá-los via indireto_id).
    const idsAllInd = origemSnap.indireto.map((i) => i.id)
    const indSel = selecionar(copiar.indireto, idsAllInd)
    const indSet = new Set(indSel)
    const indireto_id_map = new Map<string, string>()
    const indirectInsert = origemSnap.indireto
      .filter((i) => indSet.has(i.id))
      .map((i) => {
        const newId = crypto.randomUUID()
        indireto_id_map.set(i.id, newId)
        return {
          id: newId,
          obra_id,
          parent_id: i.parent_id ? indireto_id_map.get(i.parent_id) ?? null : null,
          codigo: i.codigo,
          descricao: i.descricao,
          tipo: i.tipo,
          valor_total: i.valor_total,
          distribuicao_perc: i.distribuicao_perc,
          ordem: i.ordem
        }
      })
    // Insere ordenado por nivel pra parents existirem antes.
    // Nota: snapshot não traz `nivel`, ordeno por parent_id null first.
    indirectInsert.sort((a, b) => (a.parent_id === null ? -1 : 1) - (b.parent_id === null ? -1 : 1))
    if (indirectInsert.length > 0) {
      const { error: indErr } = await admin.from('indireto_item').insert(indirectInsert)
      if (indErr) return json({ error: 'Falha ao inserir indireto', detalhe: indErr.message }, 500)
      indiretosCopiados = indirectInsert.length
    }

    // 4b. PLAN ORC. Insere por nível (1 → 2 → 3 → ...) pra parent existir antes.
    const idsAllItem = origemSnap.itens.map((i) => i.id)
    const itemSel = selecionar(copiar.planilha, idsAllItem)
    const itemSet = new Set(itemSel)
    // Filtra os selecionados E preserva os ancestrais (não pode ter "órfão sem pai").
    // Adiciona pais até a raiz.
    const idsParaCopiar = new Set<string>()
    const itemById = new Map(origemSnap.itens.map((i) => [i.id, i]))
    for (const id of itemSet) {
      let cur: ItemSnap | undefined = itemById.get(id)
      while (cur) {
        idsParaCopiar.add(cur.id)
        cur = cur.parent_id ? itemById.get(cur.parent_id) : undefined
      }
    }

    const item_id_map = new Map<string, string>()
    for (const i of origemSnap.itens) {
      if (idsParaCopiar.has(i.id)) item_id_map.set(i.id, crypto.randomUUID())
    }

    const orderedNiveis = Array.from(
      new Set(
        origemSnap.itens
          .filter((i) => idsParaCopiar.has(i.id))
          .map((i) => i.nivel)
          .sort((a, b) => a - b)
      )
    )
    for (const nivel of orderedNiveis) {
      const lote = origemSnap.itens
        .filter((i) => idsParaCopiar.has(i.id) && i.nivel === nivel)
        .map((i) => ({
          id: item_id_map.get(i.id)!,
          obra_id,
          parent_id: i.parent_id ? item_id_map.get(i.parent_id) ?? null : null,
          nivel: i.nivel,
          codigo: i.codigo,
          descricao: i.descricao,
          tipo: i.tipo,
          unidade: i.unidade,
          quantidade: i.quantidade,
          venda_unitaria: i.venda_unitaria,
          servico_id: i.servico_id,
          // cpu_snapshot_id: só preserva se ainda existe no banco (ou se cpus foram preservados).
          cpu_snapshot_id: apagarCpus ? null : i.cpu_snapshot_id,
          indireto_id: i.indireto_id ? indireto_id_map.get(i.indireto_id) ?? null : null,
          quantidade_referencia: i.quantidade_referencia,
          unidade_referencia: i.unidade_referencia,
          qtd_ref_modo: i.qtd_ref_modo,
          qtd_ref_filhos: i.qtd_ref_filhos,
          ordem: i.ordem
        }))
      if (lote.length > 0) {
        const { error: itemErr } = await admin.from('item_orcamentario').insert(lote)
        if (itemErr) {
          return json(
            { error: `Falha ao inserir nível ${nivel} da planilha`, detalhe: itemErr.message },
            500
          )
        }
        itensCopiados += lote.length
      }
    }
  }

  return json({
    ok: true,
    obra_id,
    snapshot_preservacao_id: snapshotPreservacaoId,
    itens_copiados: itensCopiados,
    indiretos_copiados: indiretosCopiados,
    cpus_preservadas: !apagarCpus,
    recursos_preservados: !apagarRecursos,
    rotulo: body.rotulo ?? null
  })
})
