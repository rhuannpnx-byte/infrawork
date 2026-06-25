// POST /functions/v1/documentacao-montar-dossie
// Body: { obra_id, fresh? }
//
// Monta o ObraDossier (1 JSON por obra) a partir das tabelas granulares e grava
// no cache obra_dossie. Sem `fresh`, devolve o cache se existir. Todo escalar do
// contrato traz proveniência (de campo_dossie) no mapa `proveniencia`.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { derivarFinanceiro, dedupEventos } from '../_shared/template.ts'

const CHECKLIST: Record<string, string[]> = {
  DNIT: ['01', '03', '04', '05', '06', '10', '11'],
  GOINFRA: ['01', '03', '04', '05', '06', '10', '11'],
  PREFEITURA: ['01', '03', '04', '05', '06', '10', '11'],
  SANEAGO: ['01', '03', '04', '05', '06', '10', '11'],
  PRIVADO: ['03', '04', '05', '10', '12']
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr
  const { admin } = ctx

  let body: { obra_id?: string; fresh?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  const acc = await assertObraAccess(ctx, obra_id, { write: false })
  if (acc) return acc

  // Cache (a menos que fresh).
  if (!body.fresh) {
    const { data: cache } = await admin
      .from('obra_dossie')
      .select('dossie')
      .eq('obra_id', obra_id)
      .maybeSingle()
    if (cache?.dossie && Object.keys(cache.dossie).length > 0) return json({ dossie: cache.dossie })
  }

  // Coleta granular.
  const [obraRow, perfilRow, contratoRow, campos, partes, rts, eventos, clausulas, nos, arestas, lacunas, tipos, docs, findingsRow] =
    await Promise.all([
      admin.from('obras').select('id, nome, codigo').eq('id', obra_id).maybeSingle(),
      admin.from('obra_perfil').select('*').eq('obra_id', obra_id).maybeSingle(),
      admin.from('contrato').select('*').eq('obra_id', obra_id).order('created_at').limit(1).maybeSingle(),
      admin.from('campo_dossie').select('caminho, valor_json, doc_id, pagina, confianca').eq('obra_id', obra_id),
      admin.from('parte').select('papel, nome, cnpj, doc_id').eq('obra_id', obra_id),
      admin.from('responsavel_tecnico').select('nome, crea, papel, art, doc_id').eq('obra_id', obra_id),
      admin.from('evento').select('tipo, data_norm, data_precisao, data_rotulo, rotulo, descricao, valor, delta, valor_resultante, doc_id').eq('obra_id', obra_id).order('data_norm', { nullsFirst: false }),
      admin.from('clausula').select('id, numero, titulo, categoria, texto, risco, observacao, analise, doc_id, pagina').eq('obra_id', obra_id),
      admin.from('no_grafo').select('no_id, tipo, label, sub, grupo_codigo, peso, doc_id').eq('obra_id', obra_id),
      admin.from('aresta').select('de, para, rel').eq('obra_id', obra_id),
      admin.from('lacuna').select('categoria, severidade, tipo, mensagem, data_limite, doc_id').eq('obra_id', obra_id),
      admin.from('tipo_documento').select('codigo, nome'),
      admin
        .from('documento')
        .select('id, tipo_codigo, categoria, grupo_codigo, aderencia_score, aderencia_grupo_sugerido, especie, nome, titulo, assinado, vigente, validade, version_cluster, documento_versao(storage_bucket, storage_key, mime, texto_layer, ocr, vigente)')
        .eq('obra_id', obra_id),
      admin
        .from('documentacao_finding')
        .select('regra_id, severidade, campo, mensagem, esperado, encontrado, fonte')
        .eq('obra_id', obra_id)
        .eq('aberto', true)
    ])

  const perfil = perfilRow.data
  const contrato = contratoRow.data
  const tipoNome = new Map(
    ((tipos.data ?? []) as Array<{ codigo: string; nome: string }>).map((t) => [t.codigo, t.nome])
  )

  // proveniência: caminho → {doc_id, pagina, confianca}; valores: caminho → valor_json
  const proveniencia: Record<string, unknown> = {}
  const valores: Record<string, unknown> = {}
  for (const c of (campos.data ?? []) as Array<{ caminho: string; valor_json: unknown; doc_id: string; pagina: number; confianca: number }>) {
    proveniencia[c.caminho] = { doc_id: c.doc_id, pagina: c.pagina, confianca: c.confianca }
    valores[c.caminho] = c.valor_json
  }
  // Escalares vêm do campo_dossie resolvido (âncora); fallback p/ a linha contrato.
  const cv = (k: string): unknown => valores[`contrato.${k}`] ?? (contrato ? contrato[k] : null) ?? null

  const documentos = ((docs.data ?? []) as Array<Record<string, unknown>>).map((d) => {
    const versoes = (d.documento_versao ?? []) as Array<Record<string, unknown>>
    const vig = versoes.find((v) => v.vigente) ?? versoes[0] ?? null
    return {
      doc_id: d.id,
      tipo_codigo: d.tipo_codigo,
      categoria: d.categoria ?? d.tipo_codigo,
      grupo_codigo: d.grupo_codigo ?? d.tipo_codigo,
      aderencia_score: d.aderencia_score ?? null,
      aderencia_grupo_sugerido: d.aderencia_grupo_sugerido ?? null,
      tipo_nome: tipoNome.get(String(d.tipo_codigo)) ?? null,
      especie: d.especie,
      nome: d.nome ?? d.titulo,
      titulo: d.titulo,
      assinado: d.assinado,
      vigente: d.vigente,
      validade: d.validade,
      version_cluster: d.version_cluster,
      storage_bucket: vig?.storage_bucket ?? null,
      storage_key: vig?.storage_key ?? null,
      mime: vig?.mime ?? null,
      texto_layer: vig?.texto_layer ?? false,
      ocr: vig?.ocr ?? false
    }
  })

  const checklist = CHECKLIST[perfil?.perfil_orgao ?? 'DNIT'] ?? CHECKLIST.DNIT
  const presentes = new Set(documentos.filter((d) => d.vigente).map((d) => d.tipo_codigo))
  const cobertura = checklist.length
    ? checklist.filter((c) => presentes.has(c)).length / checklist.length
    : 0

  // Eventos já vêm deduplicados (com rótulo) do resolver — a timeline usa como
  // estão (preserva eventos distintos no mesmo dia, com precisão de data).
  const eventosUnq = (eventos.data ?? []) as Array<Record<string, unknown>>

  // Financeiro derivado da cadeia de apostilamentos via deltas (antifrágil):
  // P0 = resultante₁ − delta₁ · vigente = P0 + Σ reajustes + Σ aditivos.
  // Dedup ESTRITO (sem rótulo) — evita dupla-contagem do mesmo apostilamento.
  const apost = dedupEventos(eventosUnq.filter((e) => e.tipo === 'apostilamento'), false)
  const aditivos = dedupEventos(eventosUnq.filter((e) => e.tipo === 'aditivo'), false)
  const p0Extraido =
    typeof valores['contrato.valor_p0'] === 'number'
      ? (valores['contrato.valor_p0'] as number)
      : typeof contrato?.valor_p0 === 'number'
        ? contrato.valor_p0
        : null
  const fin = derivarFinanceiro(
    apost as Array<{ data_norm?: string | null; delta?: number | null; valor_resultante?: number | null }>,
    aditivos as Array<{ delta?: number | null }>,
    p0Extraido
  )
  const p0 = fin.p0
  const valorVigente = fin.vigente
  const pctReajuste = fin.pctReajuste
  const pctAditado = fin.pctAditado

  const dossie = {
    obra: {
      obra_id,
      codigo: perfil?.codigo_obra ?? obraRow.data?.codigo ?? null,
      nome: perfil?.nome_exibicao ?? obraRow.data?.nome ?? null,
      orgao: perfil?.orgao ?? null,
      perfil_orgao: perfil?.perfil_orgao ?? null,
      natureza: perfil?.natureza ?? null,
      regime: perfil?.regime ?? null
    },
    contrato:
      contrato || valores['contrato.numero']
        ? {
            numero: cv('numero'),
            contratante: valores['contrato.contratante'] ?? null,
            processo: cv('processo'),
            sei: cv('sei'),
            edital: cv('edital'),
            lei: cv('lei'),
            objeto: cv('objeto'),
            natureza: cv('natureza'),
            regime: cv('regime'),
            cnae: valores['contrato.cnae'] ?? null,
            indice_reajuste: valores['contrato.indice_reajuste'] ?? null,
            valor_p0: p0,
            valor_vigente: valorVigente,
            pct_aditado: pctAditado,
            pct_reajuste: pctReajuste,
            data_base: cv('data_base'),
            assinatura: cv('assinatura'),
            publicacao: cv('publicacao'),
            prazo_exec_dias: cv('prazo_exec_dias'),
            prazo_vig_dias: cv('prazo_vig_dias'),
            inicio_exec: cv('inicio_exec'),
            termino_exec: cv('termino_exec'),
            termino_vig: cv('termino_vig'),
            fiscal: cv('fiscal'),
            consorcio: contrato?.consorcio ?? null
          }
        : null,
    partes: partes.data ?? [],
    responsaveis_tecnicos: rts.data ?? [],
    eventos: eventosUnq,
    financeiro: contrato
      ? { p0, valor_total: valorVigente, pct_aditado: pctAditado, pct_reajuste: pctReajuste }
      : null,
    clausulas: clausulas.data ?? [],
    grafo: { nos: nos.data ?? [], arestas: arestas.data ?? [] },
    documentos,
    lacunas: lacunas.data ?? [],
    findings: findingsRow.data ?? [],
    proveniencia,
    meta: {
      schema_version: 2,
      gerado_em: new Date().toISOString(),
      cobertura_essencial_pct: cobertura
    }
  }

  const obra_hash = await sha256Hex(JSON.stringify(dossie))
  await admin.from('obra_dossie').upsert(
    {
      obra_id,
      dossie,
      obra_hash,
      schema_version: 2,
      cobertura_essencial_pct: cobertura,
      gerado_em: new Date().toISOString()
    },
    { onConflict: 'obra_id' }
  )

  return json({ dossie })
})
