// POST /functions/v1/copiar-planejamento
// Body: { origem_id: string, nome_novo: string, ajuste_data_inicio?: string }
// Permissão: God/Adm/Engenheiro com acesso à obra (write).
//
// Cria nova revisão de planejamento copiando todas as tarefas (incluindo
// grupos, marcos e N tarefas/item), dependências e alocações de equipe.
// Não copia status nem baseline. Mapeamento usa id pré-gerado (crypto.randomUUID)
// para suportar tipo_no='grupo'/'marco' (sem item_orcamentario_id) e múltiplas
// tarefas com o mesmo item_orcamentario_id.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface Body {
  origem_id?: string
  nome_novo?: string
  ajuste_data_inicio?: string
}

interface TarefaOrigem {
  id: string
  item_orcamentario_id: string | null
  trecho_id: string | null
  tipo_no: 'tarefa' | 'grupo' | 'marco'
  parent_id: string | null
  nivel: number
  codigo_eap: string | null
  nome_custom: string | null
  quantidade_alocada: number | null
  qtd_link: string | null
  data_inicio: string | null
  data_fim: string | null
  duracao_dias_uteis_calc: number | null
  data_inicio_manual: boolean
  notas: string | null
  ordem: number
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  unidade_espaco_display: string | null
  perfil_default: string
  usa_perfil_customizado: boolean
  schedule_mode: 'asap' | 'alap'
  constraint_type: 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | null
  constraint_date: string | null
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
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
  const origem_id = body.origem_id?.trim()
  const nome_novo = body.nome_novo?.trim()
  if (!origem_id) return json({ error: 'origem_id é obrigatório' }, 400)
  if (!nome_novo) return json({ error: 'nome_novo é obrigatório' }, 400)

  // 1) Carrega origem
  const { data: origem, error: origemErr } = await admin
    .from('planejamento')
    .select('id, obra_id, data_referencia_inicio, descricao')
    .eq('id', origem_id)
    .maybeSingle()
  if (origemErr || !origem) return json({ error: 'Planejamento origem não encontrado' }, 404)

  const accErr = await assertObraAccess(ctx, origem.obra_id, { write: true })
  if (accErr) return accErr

  // 2) Cria novo planejamento
  const { data: novo, error: novoErr } = await admin
    .from('planejamento')
    .insert({
      obra_id: origem.obra_id,
      nome: nome_novo,
      descricao: origem.descricao,
      is_baseline: false,
      status: 'rascunho',
      data_referencia_inicio: body.ajuste_data_inicio ?? origem.data_referencia_inicio,
      criado_por: caller.id
    })
    .select('id')
    .single()
  if (novoErr) {
    const msg = novoErr.message.includes('unique')
      ? `Já existe um planejamento com o nome "${nome_novo}" nesta obra.`
      : novoErr.message
    return json({ error: msg }, 400)
  }

  // 3) Carrega tarefas origem (todas — tarefa-folha, grupos e marcos)
  const { data: tarefasOrigemRaw, error: tarErr } = await admin
    .from('planejamento_tarefa')
    .select(
      'id, item_orcamentario_id, trecho_id, tipo_no, parent_id, nivel, ' +
        'codigo_eap, nome_custom, quantidade_alocada, qtd_link, ' +
        'data_inicio, data_fim, duracao_dias_uteis_calc, data_inicio_manual, ' +
        'notas, ordem, posicao_inicio_m, posicao_fim_m, unidade_espaco_display, ' +
        'perfil_default, usa_perfil_customizado, ' +
        'schedule_mode, constraint_type, constraint_date'
    )
    .eq('planejamento_id', origem_id)
  if (tarErr) {
    await admin.from('planejamento').delete().eq('id', novo.id)
    return json({ error: tarErr.message }, 500)
  }
  const tarefasOrigem = (tarefasOrigemRaw ?? []) as TarefaOrigem[]

  const mapaTarefas = new Map<string, string>()
  // Pre-gera UUIDs para o novo planejamento — chave por id origem (não por
  // item_orcamentario_id, que não é mais único com N tarefas/item).
  for (const t of tarefasOrigem) mapaTarefas.set(t.id, crypto.randomUUID())

  if (tarefasOrigem.length > 0) {
    // Ordena por nivel ASC para garantir que parents sejam inseridos antes
    // dos children (trigger fn_tarefa_validar_nivel valida parent já existir).
    // Dentro do mesmo nivel, ordem por ordem do row (estabilidade visual).
    const tarefasOrdenadas = [...tarefasOrigem].sort((a, b) => {
      if (a.nivel !== b.nivel) return a.nivel - b.nivel
      return a.ordem - b.ordem
    })

    // Inserir em batches por nivel — cada nivel completo antes do próximo,
    // garantindo que parent já existe quando children são inseridos. Trigger
    // de qtd_alocada é DEFERRABLE → valida no commit.
    for (let nivel = 1; nivel <= 3; nivel++) {
      const nivelTarefas = tarefasOrdenadas.filter((t) => t.nivel === nivel)
      if (nivelTarefas.length === 0) continue
      const insertPayload = nivelTarefas.map((t) => ({
        id: mapaTarefas.get(t.id)!,
        planejamento_id: novo.id,
        item_orcamentario_id: t.item_orcamentario_id,
        trecho_id: t.trecho_id,
        tipo_no: t.tipo_no,
        parent_id: t.parent_id ? (mapaTarefas.get(t.parent_id) ?? null) : null,
        nivel: t.nivel,
        codigo_eap: t.codigo_eap,
        nome_custom: t.nome_custom,
        quantidade_alocada: t.quantidade_alocada,
        qtd_link: t.qtd_link,
        data_inicio: t.data_inicio,
        data_fim: t.data_fim,
        duracao_dias_uteis_calc: t.duracao_dias_uteis_calc,
        data_inicio_manual: t.data_inicio_manual,
        notas: t.notas,
        ordem: t.ordem,
        posicao_inicio_m: t.posicao_inicio_m,
        posicao_fim_m: t.posicao_fim_m,
        unidade_espaco_display: t.unidade_espaco_display,
        perfil_default: t.perfil_default,
        usa_perfil_customizado: t.usa_perfil_customizado,
        schedule_mode: t.schedule_mode,
        constraint_type: t.constraint_type,
        constraint_date: t.constraint_date
      }))
      const { error: insErr } = await admin
        .from('planejamento_tarefa')
        .insert(insertPayload)
      if (insErr) {
        await admin.from('planejamento').delete().eq('id', novo.id)
        return json({ error: insErr.message }, 500)
      }
    }
  }

  let depsCopiadas = 0
  if (mapaTarefas.size > 0) {
    // 4) Copia dependências (remapeando IDs via mapaTarefas)
    const { data: deps, error: depErr } = await admin
      .from('planejamento_dependencia')
      .select('*')
      .eq('planejamento_id', origem_id)
    if (depErr) {
      await admin.from('planejamento').delete().eq('id', novo.id)
      return json({ error: depErr.message }, 500)
    }

    const depsNovas = (deps ?? [])
      .map((d) => {
        const pred = mapaTarefas.get(d.predecessora_id)
        const suc = mapaTarefas.get(d.sucessora_id)
        if (!pred || !suc) return null
        return {
          planejamento_id: novo.id,
          predecessora_id: pred,
          sucessora_id: suc,
          tipo: d.tipo,
          lag_dias: d.lag_dias
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (depsNovas.length > 0) {
      const { error: depInsErr } = await admin.from('planejamento_dependencia').insert(depsNovas)
      if (depInsErr) {
        await admin.from('planejamento').delete().eq('id', novo.id)
        return json({ error: depInsErr.message }, 500)
      }
      depsCopiadas = depsNovas.length
    }

    // 5) Copia alocações de equipe
    const tarefaIdsOrigem = Array.from(mapaTarefas.keys())
    const { data: alocs } = await admin
      .from('planejamento_tarefa_equipe')
      .select('*')
      .in('tarefa_id', tarefaIdsOrigem)

    const alocsNovas = (alocs ?? [])
      .map((a) => {
        const novaTarefa = mapaTarefas.get(a.tarefa_id)
        if (!novaTarefa) return null
        return {
          tarefa_id: novaTarefa,
          equipe_id: a.equipe_id,
          qtd_equipes: a.qtd_equipes
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (alocsNovas.length > 0) {
      await admin.from('planejamento_tarefa_equipe').insert(alocsNovas)
    }

    // 6) Copia perfis semanais (preservando shape e quantidades). Le da LIVE
    //    revisão origem (planejamento_tarefa_perfil_semana), NUNCA do
    //    planejamento_baseline_snapshot.payload — snapshot é historico imutável,
    //    cópia rotineira partir dele criaria divergência sutil entre
    //    revisão ativa e snapshot.
    const { data: perfisOrigem } = await admin
      .from('planejamento_tarefa_perfil_semana')
      .select('tarefa_id, semana_segunda, quantidade_planejada')
      .in('tarefa_id', tarefaIdsOrigem)

    const perfisNovos = (perfisOrigem ?? [])
      .map((p) => {
        const novaTarefa = mapaTarefas.get(p.tarefa_id as string)
        if (!novaTarefa) return null
        return {
          tarefa_id: novaTarefa,
          semana_segunda: p.semana_segunda as string,
          quantidade_planejada: Number(p.quantidade_planejada)
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (perfisNovos.length > 0) {
      // INSERT em chunks (constraint trigger valida soma no commit).
      for (let i = 0; i < perfisNovos.length; i += 1000) {
        const chunk = perfisNovos.slice(i, i + 1000)
        const { error: perfErr } = await admin
          .from('planejamento_tarefa_perfil_semana')
          .insert(chunk)
        if (perfErr) {
          // rollback: deletar o planejamento_id novo (cascades pra tarefa,
          // deps, alocs, perfis já inseridos).
          await admin.from('planejamento').delete().eq('id', novo.id)
          return json({ error: 'Falha em copiar perfis: ' + perfErr.message }, 500)
        }
      }
    }

    // 7) Copia config de tarefas-indiretas (1:1 com planejamento_tarefa).
    //    Cache (custo_total_calc, receita_total_calc, etc.) é regenerado no
    //    próximo recalc — copiamos só a config (campos editáveis pelo usuário).
    const { data: indConfigsOrigem } = await admin
      .from('planejamento_tarefa_indireto')
      .select(
        'tarefa_id, custo_periodicidade, custo_unitario, receita_modo, ' +
          'receita_unitaria, receita_percentual, offset_dias_antes, offset_dias_depois, ' +
          'receita_extrapola, aplica_taxas, taxa_regime_id'
      )
      .in('tarefa_id', tarefaIdsOrigem)

    const indConfigsNovas = (indConfigsOrigem ?? [])
      .map((c) => {
        const novaTarefa = mapaTarefas.get(c.tarefa_id as string)
        if (!novaTarefa) return null
        return {
          tarefa_id: novaTarefa,
          custo_periodicidade: c.custo_periodicidade,
          custo_unitario: c.custo_unitario,
          receita_modo: c.receita_modo,
          receita_unitaria: c.receita_unitaria,
          receita_percentual: c.receita_percentual,
          offset_dias_antes: c.offset_dias_antes,
          offset_dias_depois: c.offset_dias_depois,
          receita_extrapola: c.receita_extrapola,
          aplica_taxas: c.aplica_taxas,
          taxa_regime_id: c.taxa_regime_id
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (indConfigsNovas.length > 0) {
      const { error: indErr } = await admin
        .from('planejamento_tarefa_indireto')
        .insert(indConfigsNovas)
      if (indErr) {
        await admin.from('planejamento').delete().eq('id', novo.id)
        return json({ error: 'Falha em copiar config indireta: ' + indErr.message }, 500)
      }
    }
  }

  return json({
    ok: true,
    novo_id: novo.id,
    tarefas_copiadas: mapaTarefas.size,
    dependencias_copiadas: depsCopiadas
  })
  } catch (e) {
    // Captura uncaught throw e empacota com CORS headers. Sem isso, o Deno
    // runtime retorna 500 nativo sem CORS → navegador classifica como CORS
    // error e nao mostra a mensagem real.
    console.error('[copiar-planejamento] uncaught', e)
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack?.slice(0, 2000) : undefined
    return json({ error: 'Erro interno em copiar-planejamento', detalhe: msg, stack }, 500)
  }
})
