// POST /functions/v1/documentacao-reavaliar-lacunas
// Body: { obra_id }
//
// Gap engine (SEM LLM): compara o acervo com o checklist do perfil de órgão e
// sinaliza lacunas de (A) presença, (B) vencimento ≤90d, (C) teto de aditamento
// e (D) assinatura. Recomputa a tabela `lacuna` por inteiro e a cobertura.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

// Checklist de categorias essenciais por perfil de órgão.
const CHECKLIST: Record<string, string[]> = {
  DNIT: ['01', '03', '04', '05', '06', '10', '11'],
  GOINFRA: ['01', '03', '04', '05', '06', '10', '11'],
  PREFEITURA: ['01', '03', '04', '05', '06', '10', '11'],
  SANEAGO: ['01', '03', '04', '05', '06', '10', '11'],
  PRIVADO: ['03', '04', '05', '10', '12']
}

// Só estes documentos PRECISAM de assinatura (edital, proposta, licença, CNO,
// segurança etc. não se "assinam" como um contrato → não geram lacuna de assinatura).
const ASSINAVEIS = new Set(['03', '04', '05', '07'])

function diasAte(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z').getTime()
  return Math.round((d - Date.now()) / 86400000)
}

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

  // Perfil da obra → checklist.
  const { data: perfil } = await admin
    .from('obra_perfil')
    .select('perfil_orgao, consorcio')
    .eq('obra_id', obra_id)
    .maybeSingle()
  const checklist = [...(CHECKLIST[perfil?.perfil_orgao ?? 'DNIT'] ?? CHECKLIST.DNIT)]
  // Obra em consórcio → documentos do consórcio passam a ser esperados.
  if (perfil?.consorcio === true && !checklist.includes('13')) checklist.push('13')

  // Catálogo (nome + vence) e documentos vigentes da obra.
  const { data: tipos } = await admin.from('tipo_documento').select('codigo, nome, vence')
  const tipoById = new Map(
    ((tipos ?? []) as Array<{ codigo: string; nome: string; vence: boolean }>).map((t) => [t.codigo, t])
  )
  const { data: docs } = await admin
    .from('documento')
    .select('id, tipo_codigo, assinado, validade, vigente')
    .eq('obra_id', obra_id)
  const documentos = (docs ?? []) as Array<{
    id: string
    tipo_codigo: string
    assinado: boolean
    validade: string | null
    vigente: boolean
  }>
  const presentes = new Set(documentos.filter((d) => d.vigente).map((d) => d.tipo_codigo))

  const lacunas: Array<Record<string, unknown>> = []

  // (A) presença
  for (const cat of checklist) {
    if (!presentes.has(cat)) {
      lacunas.push({
        obra_id,
        categoria: cat,
        severidade: 'alta',
        tipo: 'ausente',
        mensagem: `${tipoById.get(cat)?.nome ?? cat} não localizado no acervo.`
      })
    }
  }
  // (B) vencimento ≤90d
  for (const d of documentos) {
    if (!d.vigente) continue
    if (tipoById.get(d.tipo_codigo)?.vence && d.validade) {
      const dias = diasAte(d.validade)
      if (dias <= 90) {
        lacunas.push({
          obra_id,
          categoria: d.tipo_codigo,
          severidade: dias <= 30 ? 'alta' : dias <= 60 ? 'media' : 'baixa',
          tipo: 'vencimento',
          mensagem:
            dias < 0
              ? `${tipoById.get(d.tipo_codigo)?.nome ?? d.tipo_codigo} vencido há ${-dias} dias.`
              : `${tipoById.get(d.tipo_codigo)?.nome ?? d.tipo_codigo} vence em ${dias} dias.`,
          data_limite: d.validade,
          doc_id: d.id
        })
      }
    }
  }
  // (D) assinatura — só p/ documentos que de fato se assinam, e UMA lacuna por
  // categoria (sem repetir por documento). Evita o ruído de "edital sem assinatura".
  for (const cat of ASSINAVEIS) {
    if (!presentes.has(cat)) continue
    const doCat = documentos.filter((d) => d.vigente && d.tipo_codigo === cat)
    const semAssin = doCat.filter((d) => !d.assinado)
    if (semAssin.length && semAssin.length === doCat.length) {
      // nenhum assinado → provavelmente minutas/sem assinatura
      lacunas.push({
        obra_id,
        categoria: cat,
        severidade: 'media',
        tipo: 'assinatura',
        mensagem:
          doCat.length === 1
            ? `${tipoById.get(cat)?.nome ?? cat} consta sem assinatura.`
            : `Nenhum dos ${doCat.length} documentos de ${tipoById.get(cat)?.nome ?? cat} consta assinado.`,
        doc_id: semAssin[0].id
      })
    }
  }
  // (C) teto de aditamento
  const { data: ctr } = await admin
    .from('contrato')
    .select('pct_aditado')
    .eq('obra_id', obra_id)
    .limit(1)
    .maybeSingle()
  if (ctr && Number(ctr.pct_aditado) >= 0.225) {
    lacunas.push({
      obra_id,
      categoria: '07',
      severidade: 'alta',
      tipo: 'teto',
      mensagem: `Aditamento em ${(Number(ctr.pct_aditado) * 100).toFixed(1)}% — próximo do teto legal (25%/50%).`
    })
  }

  // Recomputa a tabela por inteiro.
  await admin.from('lacuna').delete().eq('obra_id', obra_id)
  if (lacunas.length) await admin.from('lacuna').insert(lacunas)

  const presentesEssenciais = checklist.filter((c) => presentes.has(c)).length
  const cobertura = checklist.length ? presentesEssenciais / checklist.length : 0

  // Atualiza a cobertura no cache do dossiê (se já existir).
  await admin
    .from('obra_dossie')
    .update({ cobertura_essencial_pct: cobertura })
    .eq('obra_id', obra_id)

  return json({ lacunas, cobertura_essencial_pct: cobertura })
})
