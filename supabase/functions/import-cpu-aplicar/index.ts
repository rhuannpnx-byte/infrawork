// POST /functions/v1/import-cpu-aplicar
//
// Recebe um lote de CPUs parseadas da planilha TecPav v1.8 e cria, dentro
// da obra alvo:
//   1. Serviço (se não existir por nome) — codigo gerado IMP-NNN
//   2. Recursos (find-or-create por (grupo, nome) — preço inicial 0)
//   3. CPU (versão 1, marcada vigente)
//   4. cpu_items (com horas/qtd/consumo/índice conforme grupo)
//
// Não cria preços novos para recursos que já existem (mantém o vigente).
// Recursos novos nascem sem preço (preco_vigente = null no preview);
// o usuário precisa ajustar depois no catálogo.
//
// Após criar tudo, dispara o trigger de recálculo da CPU via UPDATE no-op
// para garantir custo_unit_calc preenchido.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

type CpuItemGrupo = 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'
type RecursoGrupo = 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'

const CPU_ITEM_TO_RECURSO: Record<CpuItemGrupo, RecursoGrupo> = {
  EQUIPAMENTO: 'MVE',
  COMBUSTIVEL: 'COMBUSTIVEL',
  MO: 'MO',
  MATERIAL: 'MATERIAL'
}

interface ParsedCpuItem {
  grupo: CpuItemGrupo
  row_origem: number
  recurso_nome: string
  recurso_unidade: string | null
  quantidade: number | null
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number | null
  consumo_material_por_unid: number | null
}

interface ParsedCpu {
  aba_nome: string
  servico_nome: string
  servico_unidade: string | null
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  itens: ParsedCpuItem[]
  incompleta: boolean
  warnings: string[]
}

interface ParsedRecursoCatalogo {
  grupo: RecursoGrupo
  nome: string
  unidade: string | null
  custo_unitario: number | null
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
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

  let body: {
    obra_id?: string
    cpus?: ParsedCpu[]
    recursos_catalogo?: ParsedRecursoCatalogo[]
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obra_id = body.obra_id?.trim()
  const cpusInput = body.cpus ?? []
  const catalogoInput = body.recursos_catalogo ?? []
  if (!obra_id) return json({ error: 'obra_id obrigatório' }, 400)
  if (!Array.isArray(cpusInput) || cpusInput.length === 0) {
    return json({ error: 'Nenhuma CPU selecionada para importação' }, 400)
  }

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const t0 = Date.now()

  // ── Pré-carrega recursos da obra (dedup por grupo+nome) ──────────────
  // CPUs importadas agora entram SEM servico-dono — o usuário promove para
  // servicos via UI quando desejar. Por isso não precisamos mais carregar
  // servicosExistentes aqui.
  const { data: recursosExistentes } = await admin
    .from('recurso')
    .select('id, grupo, nome, unidade')
    .eq('obra_id', obra_id)

  const recursoPorChave = new Map<string, string>()
  for (const r of recursosExistentes ?? []) {
    const key = `${r.grupo}|${normalize(r.nome as string)}`
    recursoPorChave.set(key, r.id as string)
  }

  // Quais recursos existentes JÁ têm pelo menos um preço cadastrado?
  // Ajuda a decidir se devemos backfill com o preço do Cadastro_Recursos.
  const recursosComPreco = new Set<string>()
  const idsExistentes = (recursosExistentes ?? []).map((r) => r.id as string)
  if (idsExistentes.length > 0) {
    const { data: precos } = await admin
      .from('recurso_preco')
      .select('recurso_id')
      .in('recurso_id', idsExistentes)
    for (const p of precos ?? []) recursosComPreco.add(p.recurso_id as string)
  }

  // Index do Cadastro_Recursos vindo da planilha: (grupo|nome) → catálogo.
  const catalogoIdx = new Map<string, ParsedRecursoCatalogo>()
  for (const c of catalogoInput) {
    catalogoIdx.set(`${c.grupo}|${normalize(c.nome)}`, c)
  }

  const hoje = new Date().toISOString().slice(0, 10)

  const stats = {
    cpus_criadas: 0,
    cpus_puladas: 0,
    servicos_criados: 0,
    servicos_reutilizados: 0,
    recursos_criados: 0,
    recursos_reutilizados: 0,
    precos_criados: 0,
    cpu_items_criados: 0
  }
  const warnings: string[] = []
  const erros: string[] = []

  for (const cpu of cpusInput) {
    try {
      // CPUs importadas entram SEM servico-dono — entidade técnica autônoma.
      // O nome vem direto na coluna `cpu.nome`. O usuário pode promover a CPU
      // em servico depois pela UI.

      const nomeCpu = cpu.servico_nome
      const proximaVersao = 1

      const { data: novaCpu, error: cpuErr } = await admin
        .from('cpu')
        .insert({
          obra_id,
          servico_id: null,
          versao: proximaVersao,
          nome: nomeCpu,
          producao_diaria_qtde: cpu.producao_diaria_qtde || 0,
          producao_diaria_unidade: cpu.producao_diaria_unidade ?? 'DIA',
          notas: `Importada de ${cpu.aba_nome}${
            cpu.incompleta ? ' (marcada como incompleta)' : ''
          }`,
          is_vigente: true
        })
        .select('id')
        .single()
      if (cpuErr || !novaCpu) {
        erros.push(`CPU "${cpu.servico_nome}": ${cpuErr?.message ?? 'falha'}`)
        stats.cpus_puladas++
        continue
      }
      stats.cpus_criadas++
      if (cpu.incompleta) warnings.push(`"${cpu.servico_nome}" foi marcada como incompleta.`)
      for (const w of cpu.warnings) warnings.push(`${cpu.aba_nome}: ${w}`)

      // 3. Cria recursos faltantes + cpu_items
      let ordem = 0
      for (const it of cpu.itens) {
        const recursoGrupo = CPU_ITEM_TO_RECURSO[it.grupo]
        const recKey = `${recursoGrupo}|${normalize(it.recurso_nome)}`
        const cat = catalogoIdx.get(recKey)
        let recurso_id = recursoPorChave.get(recKey)
        if (!recurso_id) {
          const { data: novoRec, error: recErr } = await admin
            .from('recurso')
            .insert({
              obra_id,
              grupo: recursoGrupo,
              nome: it.recurso_nome,
              unidade: it.recurso_unidade ?? cat?.unidade ?? 'un',
              ativo: true,
              fonte: 'importacao_tecpav',
              observacao: `Criado pela importação de CPU (aba ${cpu.aba_nome}, row ${it.row_origem})`
            })
            .select('id')
            .single()
          if (recErr || !novoRec) {
            erros.push(
              `Recurso "${it.recurso_nome}" (${recursoGrupo}): ${recErr?.message ?? 'falha'}`
            )
            continue
          }
          recurso_id = novoRec.id as string
          recursoPorChave.set(recKey, recurso_id)
          stats.recursos_criados++

          // Recurso novo + preço no Cadastro_Recursos → cria recurso_preco.
          if (cat && cat.custo_unitario !== null && cat.custo_unitario > 0) {
            const { error: precoErr } = await admin.from('recurso_preco').insert({
              recurso_id,
              custo_unitario: cat.custo_unitario,
              vigencia_inicio: hoje,
              origem: 'importacao_tecpav',
              observacao: `Importado de Cadastro_Recursos`
            })
            if (precoErr) {
              warnings.push(`Preço de "${it.recurso_nome}": ${precoErr.message}`)
            } else {
              stats.precos_criados++
              recursosComPreco.add(recurso_id)
            }
          } else if (cat && (cat.custo_unitario === null || cat.custo_unitario === 0)) {
            warnings.push(
              `"${it.recurso_nome}" sem preço no Cadastro_Recursos — cadastre manualmente.`
            )
          }
        } else {
          stats.recursos_reutilizados++
          // Recurso existente SEM preço cadastrado + preço no catálogo → backfill.
          if (
            !recursosComPreco.has(recurso_id) &&
            cat &&
            cat.custo_unitario !== null &&
            cat.custo_unitario > 0
          ) {
            const { error: precoErr } = await admin.from('recurso_preco').insert({
              recurso_id,
              custo_unitario: cat.custo_unitario,
              vigencia_inicio: hoje,
              origem: 'importacao_tecpav',
              observacao: `Backfill de preço (recurso existia sem preço) — Cadastro_Recursos`
            })
            if (precoErr) {
              warnings.push(`Preço (backfill) de "${it.recurso_nome}": ${precoErr.message}`)
            } else {
              stats.precos_criados++
              recursosComPreco.add(recurso_id)
            }
          }
        }

        // Constraint chk_cpu_item_horas: EQUIPAMENTO e MO exigem horas_dia NOT NULL.
        // Default = 0 quando blank na planilha — replica EXATAMENTE o
        // comportamento do Excel, onde fórmula K = I × J × Nº com Nº blank
        // avalia para 0 (Excel trata null em aritmética como 0). Default = 1
        // estaria errado porque adiciona custo de linhas que a planilha não
        // contava (ex.: Cam. espargidor em CPU_CapaCBUQ tinha H=blank).
        const horasDia =
          it.horas_dia ?? (it.grupo === 'EQUIPAMENTO' || it.grupo === 'MO' ? 0 : null)

        const cpuItemPayload = {
          cpu_id: novaCpu.id as string,
          grupo: it.grupo,
          recurso_id,
          quantidade: it.quantidade ?? 0,
          horas_dia: horasDia,
          consumo_combustivel_lh: it.consumo_combustivel_lh,
          indice_produtividade: it.indice_produtividade ?? 1,
          consumo_material_por_unid: it.consumo_material_por_unid,
          ordem: ordem++
        }

        const { error: itemErr } = await admin.from('cpu_item').insert(cpuItemPayload)
        if (itemErr) {
          erros.push(
            `cpu_item ${cpu.aba_nome}/row${it.row_origem} (${it.recurso_nome}): ${itemErr.message}`
          )
          continue
        }
        stats.cpu_items_criados++
      }

      // 4. Dispara recálculo da CPU (no-op UPDATE)
      await admin
        .from('cpu')
        .update({ notas: `Importada de ${cpu.aba_nome}` })
        .eq('id', novaCpu.id)
    } catch (err) {
      erros.push(`"${cpu.servico_nome}": ${err instanceof Error ? err.message : String(err)}`)
      stats.cpus_puladas++
    }
  }

  const duracao_ms = Date.now() - t0
  return json({
    ok: erros.length === 0 || stats.cpus_criadas > 0,
    stats,
    warnings: warnings.slice(0, 200),
    erros: erros.slice(0, 200),
    duracao_ms
  })
})
