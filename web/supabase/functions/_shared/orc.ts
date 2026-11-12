// `assertObraAccess(ctx, obra_id, { write })`: o caller pode ler/editar dados desta obra?
//
// A regra é a do banco (as mesmas funções das políticas de acesso), perguntada com a sessão do próprio caller:
//   - leitura: pode_ver_acompanhamento — god, adm da empresa, engenheiro e cliente da obra, apoio do engenheiro
//   - escrita: pode_editar_orcamento   — god, adm da empresa, engenheiro da obra
//
// Retorna Response 403/404 em caso de bloqueio, ou null se OK.

import type { CallerContext } from './auth.ts'
import { json } from './cors.ts'

export interface ObraAccessOptions {
  /** Se true, exige permissão de escrita (apoio e cliente bloqueados). */
  write?: boolean
}

export async function assertObraAccess(
  ctx: CallerContext,
  obraId: string,
  opts: ObraAccessOptions = {}
): Promise<Response | null> {
  const { data: obra } = await ctx.admin.from('obras').select('id').eq('id', obraId).maybeSingle()
  if (!obra) return json({ error: 'Obra não encontrada' }, 404)

  const regra = opts.write ? 'pode_editar_orcamento' : 'pode_ver_acompanhamento'
  const { data: pode, error } = await ctx.authed.rpc(regra, { _obra_id: obraId })
  if (error) return json({ error: `Permissão: ${error.message}` }, 500)
  if (pode !== true) {
    return json(
      { error: opts.write ? 'Sem permissão para alterar esta obra' : 'Você não tem acesso a esta obra' },
      403
    )
  }
  return null
}
