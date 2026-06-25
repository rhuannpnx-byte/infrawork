// POST /functions/v1/documentacao-validar
// Body: { obra_id }
//
// Roda as regras R-XX (validar-regras.ts) sobre o estado resolvido da obra e
// grava os findings. Deve rodar APÓS o resolver e ANTES de emitir o TAP.
// pode_emitir_definitivo = nenhum BLOCKER aberto.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { num } from '../_shared/template.ts'
import { validarTap, podeEmitirDefinitivo, type VDado } from '../_shared/validar-regras.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr
  const { admin } = ctx

  let body: { obra_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const [campos, contratoRow, eventos, partes, clausulas] = await Promise.all([
    admin.from('campo_dossie').select('caminho, valor_json, doc_id, pagina, confianca').eq('obra_id', obra_id),
    admin.from('contrato').select('*').eq('obra_id', obra_id).order('created_at').limit(1).maybeSingle(),
    admin.from('evento').select('tipo, data_norm, delta, valor_resultante, rotulo').eq('obra_id', obra_id),
    admin.from('parte').select('papel, nome, cnpj').eq('obra_id', obra_id),
    admin.from('clausula').select('texto').eq('obra_id', obra_id)
  ])

  const valores: Record<string, unknown> = {}
  const proveniencia: VDado['proveniencia'] = {}
  for (const c of (campos.data ?? []) as Array<{ caminho: string; valor_json: unknown; doc_id: string; pagina: number; confianca: number }>) {
    valores[c.caminho] = c.valor_json
    proveniencia[c.caminho] = { doc_id: c.doc_id, pagina: c.pagina, confianca: c.confianca }
  }
  const ctr = contratoRow.data
  const v = (k: string): unknown => valores[`contrato.${k}`] ?? (ctr ? ctr[k] : null) ?? null
  const s = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)

  const dado: VDado = {
    contrato: {
      numero: s(v('numero')),
      contratante: s(valores['contrato.contratante']),
      objeto: s(v('objeto')),
      processo: s(v('processo')),
      edital: s(v('edital')),
      lei: s(v('lei')),
      regime: s(v('regime')),
      cnae: s(valores['contrato.cnae']),
      indice_reajuste: s(valores['contrato.indice_reajuste']),
      valor_p0: num(v('valor_p0')),
      valor_vigente: num(ctr?.valor_vigente) ?? num(v('valor_p0')),
      data_base: s(v('data_base')),
      assinatura: s(v('assinatura')),
      publicacao: s(v('publicacao')),
      prazo_exec_dias: num(v('prazo_exec_dias')),
      prazo_vig_dias: num(v('prazo_vig_dias')),
      inicio_exec: s(v('inicio_exec')),
      termino_exec: s(v('termino_exec')),
      termino_vig: s(v('termino_vig'))
    },
    partes: ((partes.data ?? []) as Array<{ papel: string; nome: string; cnpj: string | null }>).map((p) => ({
      papel: p.papel,
      nome: p.nome,
      cnpj: p.cnpj
    })),
    eventos: ((eventos.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
      tipo: String(e.tipo),
      data_norm: (e.data_norm as string) ?? null,
      delta: num(e.delta),
      valor_resultante: num(e.valor_resultante),
      rotulo: (e.rotulo as string) ?? null
    })),
    textos: [
      ...((clausulas.data ?? []) as Array<{ texto: string | null }>).map((c) => c.texto ?? ''),
      ...((partes.data ?? []) as Array<{ nome: string }>).map((p) => p.nome),
      ...Object.values(valores).filter((x) => typeof x === 'string').map((x) => x as string)
    ],
    proveniencia,
    hoje: new Date().toISOString().slice(0, 10)
  }

  const findings = validarTap(dado)

  // validar é dono dos findings numerados (mantém o R-CONF do resolver).
  await admin.from('documentacao_finding').delete().eq('obra_id', obra_id).neq('regra_id', 'R-CONF')
  if (findings.length) {
    await admin.from('documentacao_finding').insert(
      findings.map((x) => ({
        obra_id,
        regra_id: x.regra_id,
        severidade: x.severidade,
        campo: x.campo ?? null,
        mensagem: x.mensagem,
        esperado: x.esperado ?? null,
        encontrado: x.encontrado ?? null,
        aberto: true
      }))
    )
  }

  return json({
    findings,
    pode_emitir_definitivo: podeEmitirDefinitivo(findings),
    blockers: findings.filter((x) => x.severidade === 'BLOCKER').length,
    warns: findings.filter((x) => x.severidade === 'WARN').length
  })
})
