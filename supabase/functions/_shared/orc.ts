// Helpers compartilhados das Edge Functions do módulo Orçamento (Fase 2+).
//
// `assertObraAccess(ctx, obra_id, { write })` checa que o caller pode
// ler/editar dados de uma obra específica.
//   - God:        sempre passa
//   - Adm:        passa se a obra é da empresa do caller
//   - Engenheiro: passa se tem permissão direta na obra (write OU read)
//   - Apoio:      passa em read (via has_obra_permissao do engenheiro);
//                 bloqueia em write
//
// Retorna Response 403/404 em caso de bloqueio, ou null se OK.

import type { CallerContext } from './auth.ts'
import { json } from './cors.ts'

export interface ObraAccessOptions {
  /** Se true, exige permissão de escrita (apoio bloqueado). */
  write?: boolean
}

export async function assertObraAccess(
  ctx: CallerContext,
  obraId: string,
  opts: ObraAccessOptions = {}
): Promise<Response | null> {
  const { caller, admin } = ctx
  const write = opts.write ?? false

  // 1) Obra existe?
  const { data: obra } = await admin
    .from('obras')
    .select('id, empresa_id')
    .eq('id', obraId)
    .maybeSingle()
  if (!obra) return json({ error: 'Obra não encontrada' }, 404)

  // 2) God sempre passa
  if (caller.role === 'god') return null

  // 3) Adm: precisa estar na mesma empresa
  if (caller.role === 'adm') {
    if (caller.empresa_id !== obra.empresa_id) {
      return json({ error: 'Obra fora da sua empresa' }, 403)
    }
    return null
  }

  // 4) Engenheiro: precisa ter permissão direta
  if (caller.role === 'engenheiro') {
    if (caller.empresa_id !== obra.empresa_id) {
      return json({ error: 'Obra fora da sua empresa' }, 403)
    }
    const { data: perm } = await admin
      .from('obra_permissoes')
      .select('id')
      .eq('obra_id', obraId)
      .eq('user_id', caller.id)
      .maybeSingle()
    if (!perm) return json({ error: 'Você não tem acesso a esta obra' }, 403)
    return null
  }

  // 4b) Cliente: espelha o engenheiro (permissão direta), porém SOMENTE leitura.
  if (caller.role === 'cliente') {
    if (write) {
      return json({ error: 'Cliente não pode editar dados da obra' }, 403)
    }
    if (caller.empresa_id !== obra.empresa_id) {
      return json({ error: 'Obra fora da sua empresa' }, 403)
    }
    const { data: perm } = await admin
      .from('obra_permissoes')
      .select('id')
      .eq('obra_id', obraId)
      .eq('user_id', caller.id)
      .maybeSingle()
    if (!perm) return json({ error: 'Você não tem acesso a esta obra' }, 403)
    return null
  }

  // 5) Apoio: só leitura via engenheiro_id, bloqueado em escrita
  if (caller.role === 'apoio') {
    if (write) {
      return json({ error: 'Apoio não pode editar orçamento' }, 403)
    }
    if (!caller.engenheiro_id) {
      return json({ error: 'Apoio sem engenheiro vinculado' }, 403)
    }
    const { data: perm } = await admin
      .from('obra_permissoes')
      .select('id')
      .eq('obra_id', obraId)
      .eq('user_id', caller.engenheiro_id)
      .maybeSingle()
    if (!perm) return json({ error: 'Você não tem acesso a esta obra' }, 403)
    return null
  }

  return json({ error: 'Papel não autorizado' }, 403)
}
