// POST /functions/v1/migrar-perfis-tarefas-existentes
// Body: { obra_id?: string, batch_size?: number, dry_run?: boolean }
//
// Permissão: God only (manutenção, ad-hoc).
//
// Backfill one-shot pós-deploy: gera perfil uniforme pra cada tarefa
// existente que tem data_inicio + data_fim mas perfil_semana vazio.
// Idempotente: tarefas com perfil já preenchido são skipped.
//
// Estratégia de erro: cada tarefa em SUA própria operação (sem agrupar
// em transação global). Erro numa tarefa NÃO aborta o batch — registra
// em errors[] e continua. Operador roda o resultado pra investigar
// exceções específicas.
//
// Timeout do Edge é 60s. Pra obras gigantes (1000+ tarefas), processa
// batch_size por chamada (default 50) e operador invoca múltiplas vezes
// (idempotente garante progresso sem duplicar).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import {
  type CalendarioCtx,
  gerarPerfilSemanal,
  makeCapacidadePorSemana,
  parseISO
} from '../_shared/cronograma-pure.ts'

interface Body {
  obra_id?: string
  batch_size?: number
  dry_run?: boolean
}

interface TarefaRow {
  id: string
  planejamento_id: string
  item_orcamentario_id: string
  data_inicio: string | null
  data_fim: string | null
  obra_id: string
  quantidade_referencia: number | null
  producao_diaria_qtde: number | null
  cpu_snapshot_id: string | null
  perfil_default: string
  qtd_equipes_total: number
}

interface ResumoMigracao {
  total_examinadas: number
  migradas: Array<{ tarefa_id: string; semanas_geradas: number }>
  skipped: Array<{ tarefa_id: string; motivo: string }>
  errors: Array<{ tarefa_id: string; erro: string }>
  dry_run: boolean
  duracao_ms: number
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god'])
  if (roleErr) return roleErr

  let body: Body = {}
  try {
    body = await req.json()
  } catch {
    // body opcional
  }
  const batch_size = Math.max(1, Math.min(500, body.batch_size ?? 50))
  const dry_run = body.dry_run === true
  const t0 = Date.now()

  // 1) Localizar tarefas elegíveis: com datas, com CPU, sem perfil ainda.
  // Query monta lista de candidatas; filtra "sem perfil" depois.
  let q = admin
    .from('vw_planejamento_tarefa_completa')
    .select(
      'id, planejamento_id, item_orcamentario_id, data_inicio, data_fim, obra_id, ' +
        'quantidade_referencia, producao_diaria_qtde, cpu_snapshot_id, perfil_default, ' +
        'equipes, is_baseline'
    )
    .not('data_inicio', 'is', null)
    .not('data_fim', 'is', null)
    .eq('is_baseline', false) // baseline é imutável; backfill seria via service_role mas trigger
                              // bloqueia. Operador refaz baseline depois se precisar.
    .limit(batch_size * 5) // overscan; vai filtrar depois

  if (body.obra_id) {
    q = q.eq('obra_id', body.obra_id)
  }

  const { data: candidatasRaw, error: candErr } = await q
  if (candErr) return json({ error: 'Falha ao listar candidatas', detalhe: candErr.message }, 500)

  // Filtra: skip tarefas que ja têm perfil
  const candidatas = (candidatasRaw ?? []).slice(0, batch_size)
  const tarefaIds = candidatas.map((t) => t.id as string)

  const { data: comPerfil } = await admin
    .from('planejamento_tarefa_perfil_semana')
    .select('tarefa_id')
    .in('tarefa_id', tarefaIds.length > 0 ? tarefaIds : ['00000000-0000-0000-0000-000000000000'])

  const idsComPerfil = new Set((comPerfil ?? []).map((p) => p.tarefa_id as string))

  const resumo: ResumoMigracao = {
    total_examinadas: candidatas.length,
    migradas: [],
    skipped: [],
    errors: [],
    dry_run,
    duracao_ms: 0
  }

  // 2) Pré-carrega contexto de calendário/exceções/fatores por obra
  //    (cache: 1 vez por obra, não 1 vez por tarefa).
  const ctxPorObra = new Map<string, CalendarioCtx>()

  async function getCtxObra(obraId: string): Promise<CalendarioCtx> {
    const cached = ctxPorObra.get(obraId)
    if (cached) return cached
    const [calRes, excRes, fatRes] = await Promise.all([
      admin
        .from('obra_calendario')
        .select('dias_uteis_bitmask')
        .eq('obra_id', obraId)
        .maybeSingle(),
      admin.from('obra_calendario_excecao').select('data, eh_util').eq('obra_id', obraId),
      admin.from('obra_produtividade_mes').select('ano_mes, fator').eq('obra_id', obraId)
    ])
    const excecoes = new Map<string, boolean>()
    for (const e of excRes.data ?? []) {
      excecoes.set(e.data as string, !!e.eh_util)
    }
    const fatorMes = new Map<string, number>()
    for (const f of fatRes.data ?? []) {
      fatorMes.set((f.ano_mes as string).slice(0, 7), Number(f.fator))
    }
    const c: CalendarioCtx = {
      bitmask: calRes.data?.dias_uteis_bitmask ?? 31,
      excecoes,
      fatorMes
    }
    ctxPorObra.set(obraId, c)
    return c
  }

  // 3) Processa cada tarefa em try/catch individual.
  for (const cand of candidatas) {
    const tid = cand.id as string
    try {
      if (idsComPerfil.has(tid)) {
        resumo.skipped.push({ tarefa_id: tid, motivo: 'ja_tem_perfil' })
        continue
      }
      const qtd = Number(cand.quantidade_referencia ?? 0)
      const prod = Number(cand.producao_diaria_qtde ?? 0)
      const eqs = ((cand.equipes ?? []) as Array<{ qtd_equipes?: number }>).reduce(
        (acc, e) => acc + Math.max(1, Number(e?.qtd_equipes ?? 1)),
        0
      )
      const valida =
        !!cand.cpu_snapshot_id && prod > 0 && qtd > 0 && eqs > 0
      if (!valida) {
        resumo.skipped.push({ tarefa_id: tid, motivo: 'invalida' })
        continue
      }
      if (!cand.data_inicio || !cand.data_fim) {
        resumo.skipped.push({ tarefa_id: tid, motivo: 'sem_datas' })
        continue
      }

      const ccObra = await getCtxObra(cand.obra_id as string)
      const cap = makeCapacidadePorSemana(prod, eqs, ccObra)
      const r = gerarPerfilSemanal({
        quantidadeTotal: qtd,
        dataInicio: parseISO(cand.data_inicio as string),
        capacidadePorSemana: cap,
        perfil: (cand.perfil_default as string) as never as
          | 'uniforme'
          | 'rampa-subida'
          | 'rampa-descida'
          | 'sino'
          | 'front-loaded'
          | 'back-loaded'
      })

      if (dry_run) {
        resumo.migradas.push({ tarefa_id: tid, semanas_geradas: r.semanas.length })
        continue
      }

      // Insert chunked. Constraint DEFERRED valida soma no commit.
      const rows = r.semanas
        .filter((s) => s.quantidadePlanejada >= 0)
        .map((s) => ({
          tarefa_id: tid,
          semana_segunda: s.semanaSegunda,
          quantidade_planejada: s.quantidadePlanejada
        }))
      if (rows.length === 0) {
        resumo.skipped.push({ tarefa_id: tid, motivo: 'perfil_vazio' })
        continue
      }
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500)
        const { error: insErr } = await admin
          .from('planejamento_tarefa_perfil_semana')
          .insert(chunk)
        if (insErr) {
          throw new Error(`insert chunk ${i}: ${insErr.message}`)
        }
      }
      resumo.migradas.push({ tarefa_id: tid, semanas_geradas: rows.length })
    } catch (e) {
      resumo.errors.push({ tarefa_id: tid, erro: (e as Error).message })
    }
  }

  resumo.duracao_ms = Date.now() - t0
  return json({ ok: true, ...resumo })
})
