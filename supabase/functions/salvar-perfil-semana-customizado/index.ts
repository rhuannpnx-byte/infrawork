// POST /functions/v1/salvar-perfil-semana-customizado
// Body: { tarefa_id: string, semanas: Array<{ semana_segunda: string; quantidade_planejada: number }> }
//
// Permissão (em ordem):
//   1) assertRole(caller, ['god', 'adm', 'engenheiro']) — apoio bloqueado hard.
//   2) Lookup tarefa.planejamento_id → planejamento.{obra_id, is_baseline, status}.
//   3) Bloqueia se planejamento.is_baseline = true (HTTP 409).
//   4) Bloqueia se planejamento.status === 'arquivado' (HTTP 409).
//   5) Aplica assertObraAccess(ctx, obra_id, { write: true }) — checa
//      pode_planejar_obra (god | adm same-empresa | eng com permissão).
//   6) Aceita status='rascunho' OU status='ativo'.
//
// Operação (transação implícita via constraint trigger DEFERRED):
//   1) DELETE existing perfil rows da tarefa.
//   2) INSERT novas rows (chunked se >1000).
//   3) UPDATE planejamento_tarefa SET usa_perfil_customizado = true.
//
// Constraint trigger DEFERRED valida soma no commit. Se diverge: 23514
// check_violation → HTTP 422 com mensagem clara.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface SemanaInput {
  semana_segunda: string
  quantidade_planejada: number
}

interface Body {
  tarefa_id?: string
  semanas?: SemanaInput[]
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
  const tarefa_id = body.tarefa_id?.trim()
  const semanas = body.semanas
  if (!tarefa_id) return json({ error: 'tarefa_id é obrigatório' }, 400)
  if (!Array.isArray(semanas)) return json({ error: 'semanas deve ser array' }, 400)

  // Validação básica do payload
  for (const s of semanas) {
    if (
      !s.semana_segunda ||
      typeof s.semana_segunda !== 'string' ||
      typeof s.quantidade_planejada !== 'number' ||
      !isFinite(s.quantidade_planejada) ||
      s.quantidade_planejada < 0
    ) {
      return json(
        {
          error: 'semanas inválidas',
          detalhe:
            'Cada item precisa de { semana_segunda: "YYYY-MM-DD", quantidade_planejada: number >= 0 }'
        },
        400
      )
    }
  }

  // Lookup tarefa + planejamento
  const { data: tarefa, error: tarErr } = await admin
    .from('planejamento_tarefa')
    .select('id, planejamento_id')
    .eq('id', tarefa_id)
    .maybeSingle()
  if (tarErr || !tarefa) return json({ error: 'Tarefa não encontrada' }, 404)

  const { data: plan, error: planErr } = await admin
    .from('planejamento')
    .select('id, obra_id, is_baseline, status')
    .eq('id', tarefa.planejamento_id as string)
    .maybeSingle()
  if (planErr || !plan) return json({ error: 'Planejamento da tarefa não encontrado' }, 404)

  if (plan.is_baseline) {
    return json(
      { error: 'Planejamento baseline é imutável. Crie nova revisão para editar.' },
      409
    )
  }
  if (plan.status === 'arquivado') {
    return json({ error: 'Planejamento arquivado não aceita edição de perfil.' }, 409)
  }

  const accErr = await assertObraAccess(ctx, plan.obra_id as string, { write: true })
  if (accErr) return accErr

  // DELETE perfis existentes da tarefa
  const { error: delErr } = await admin
    .from('planejamento_tarefa_perfil_semana')
    .delete()
    .eq('tarefa_id', tarefa_id)
  if (delErr) {
    return json({ error: 'Falha em DELETE perfil', detalhe: delErr.message }, 500)
  }

  // INSERT chunked. Constraint trigger DEFERRED valida soma no commit.
  if (semanas.length > 0) {
    const rows = semanas.map((s) => ({
      tarefa_id,
      semana_segunda: s.semana_segunda,
      quantidade_planejada: s.quantidade_planejada
    }))
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000)
      const { error: insErr } = await admin
        .from('planejamento_tarefa_perfil_semana')
        .insert(chunk)
      if (insErr) {
        // check_violation (23514) = soma diverge da tolerância → mensagem clara.
        // deno-lint-ignore no-explicit-any
        const msg = (insErr as any).message ?? 'erro desconhecido'
        // deno-lint-ignore no-explicit-any
        const code = (insErr as any).code ?? null
        if (code === '23514') {
          return json(
            {
              error:
                'Soma do perfil diverge de quantidade_referencia além da tolerância 0.1%.',
              detalhe: msg
            },
            422
          )
        }
        return json({ error: 'Falha em INSERT perfil', detalhe: msg }, 500)
      }
    }
  }

  // Marca a tarefa como customizada
  const { error: updErr } = await admin
    .from('planejamento_tarefa')
    .update({ usa_perfil_customizado: true })
    .eq('id', tarefa_id)
  if (updErr) {
    return json({ error: 'Falha em UPDATE flag customizado', detalhe: updErr.message }, 500)
  }

  return json({ ok: true, tarefa_id, semanas_salvas: semanas.length })
})
