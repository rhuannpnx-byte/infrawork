// POST /functions/v1/copiar-planejamento
// Body: { origem_id: string, nome_novo: string, ajuste_data_inicio?: string }
// Permissão: God/Adm/Engenheiro com acesso à obra (write).
//
// Cria nova revisão de planejamento copiando todas as tarefas, dependências
// e alocações de equipe. Não copia status nem baseline. Dispara recálculo.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface Body {
  origem_id?: string
  nome_novo?: string
  ajuste_data_inicio?: string
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

  // 3) Copia tarefas (mapa origem→novo)
  const { data: tarefasOrigem, error: tarErr } = await admin
    .from('planejamento_tarefa')
    .select('*')
    .eq('planejamento_id', origem_id)
  if (tarErr) {
    await admin.from('planejamento').delete().eq('id', novo.id)
    return json({ error: tarErr.message }, 500)
  }

  const mapaTarefas = new Map<string, string>()
  if ((tarefasOrigem ?? []).length > 0) {
    const insertPayload = (tarefasOrigem ?? []).map((t) => ({
      planejamento_id: novo.id,
      item_orcamentario_id: t.item_orcamentario_id,
      data_inicio: t.data_inicio,
      data_fim: t.data_fim,
      duracao_dias_uteis_calc: t.duracao_dias_uteis_calc,
      data_inicio_manual: t.data_inicio_manual,
      notas: t.notas,
      ordem: t.ordem,
      // Eixo espacial + perfil — copiados pra preservar configuração da revisão.
      posicao_inicio_m: t.posicao_inicio_m,
      posicao_fim_m: t.posicao_fim_m,
      unidade_espaco_display: t.unidade_espaco_display,
      perfil_default: t.perfil_default,
      usa_perfil_customizado: t.usa_perfil_customizado
    }))
    const { data: novasTarefas, error: insErr } = await admin
      .from('planejamento_tarefa')
      .insert(insertPayload)
      .select('id, item_orcamentario_id')
    if (insErr) {
      await admin.from('planejamento').delete().eq('id', novo.id)
      return json({ error: insErr.message }, 500)
    }
    // Mapear: origem.item_orcamentario_id → novo.id
    const origemPorItem = new Map<string, string>()
    for (const t of tarefasOrigem!) origemPorItem.set(t.item_orcamentario_id, t.id)
    for (const nt of novasTarefas ?? []) {
      const origemTId = origemPorItem.get(nt.item_orcamentario_id)
      if (origemTId) mapaTarefas.set(origemTId, nt.id)
    }
  }

  let depsCopiadas = 0
  if (mapaTarefas.size > 0) {
    // 4) Copia dependências (remapeando IDs)
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
    const tarefaIdsOrigem = Array.from(mapaTarefas.keys())
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
  }

  return json({
    ok: true,
    novo_id: novo.id,
    tarefas_copiadas: mapaTarefas.size,
    dependencias_copiadas: depsCopiadas
  })
})
