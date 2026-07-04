// Estimativa de consumo de INSUMOS (materiais + diesel) por período, a partir da
// composição (CPU) × produção apontada. NÃO é medição real de estoque/abastecimento.
//
// FONTE DA COMPOSIÇÃO — mesma que alimenta o agrupador do orçamento:
//   1) PRIMÁRIO: o snapshot congelado do item orçamentário ao qual a produção foi
//      casada (acompanhamento_servico_match.item_orcamentario_id →
//      item_orcamentario.cpu_snapshot_id → cpu_snapshot.payload). É EXATAMENTE a
//      composição que o orçamento usou para custear o serviço-grupo. Assim a
//      estimativa bate com o que o usuário vê no orçamento, mesmo que a CPU tenha
//      sido editada in-place depois do snapshot.
//   2) FALLBACK (sem snapshot): composição ao vivo, como o sistema resolve —
//      agregador (servico_cpu_link) ou legado (CPU vigente do serviço).
//
// Conversão unidade-CPU → unidade-serviço via aplicarFator (semântica do sistema):
// operacao 'dividir' (default) divide pelo fator; 'multiplicar' multiplica.
//
//   • Material: consumo por unidade-CPU (col "consumo material", ou quantidade/dia
//     ÷ produção/dia) → aplicarFator → × quantidade realizada.
//   • Diesel:   litros/dia ÷ produção/dia → aplicarFator → × quantidade realizada.

import { supabase } from '../supabase.js'

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()
}

type Operacao = 'dividir' | 'multiplicar'

/** Converte um valor por unidade-CPU para por unidade-serviço, como o sistema:
 *  'multiplicar' → v × fator; 'dividir' (default) → v ÷ fator. */
function aplicarFator(v: number, fator: number, operacao: Operacao): number {
  const f = Number(fator) || 1
  if (!isFinite(f) || f === 0) return 0
  return operacao === 'multiplicar' ? v * f : v / f
}

export interface ConsumoItem {
  recurso: string
  unidade: string
  quantidade_estimada: number
}

export interface ConsumoResultado {
  periodo: { inicio: string; fim: string }
  diesel_litros_estimado: number
  materiais: ConsumoItem[]
  por_servico: Array<{
    servico: string
    qtd_realizada: number
    unidade: string
    diesel_litros: number
    materiais: ConsumoItem[]
    fonte: 'orcamento' | 'ao_vivo'
  }>
  servicos_sem_composicao: string[]
  observacao: string
}

// Item cru de composição normalizado (venha do snapshot ou do vivo).
interface RawItem {
  grupo: string
  quantidade: number
  cmpu: number | null // consumo_material_por_unid
  nome: string
  unidade: string
}

// Uma unidade-CPU da composição de um serviço.
interface Unidade {
  fator: number
  operacao: Operacao
  prodDia: number
  itens: RawItem[]
}

function num(v: unknown): number {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

/** Extrai as unidades-CPU (fator/operacao/prodDia/itens) de um payload de snapshot.
 *  Cobre os dois formatos: legado (cpu + itens) e agregador (cpus[]). */
function unidadesDoSnapshot(payload: unknown): Unidade[] {
  const p = (payload ?? {}) as Record<string, unknown>
  const mapItens = (arr: unknown): RawItem[] =>
    ((arr as Record<string, unknown>[]) ?? [])
      .filter((it) => it && (it.grupo === 'MATERIAL' || it.grupo === 'COMBUSTIVEL'))
      .map((it) => {
        const rec = (it.recurso as { nome?: string; unidade?: string } | null) ?? {}
        return {
          grupo: it.grupo as string,
          quantidade: num(it.quantidade),
          cmpu: it.consumo_material_por_unid == null ? null : num(it.consumo_material_por_unid),
          nome: rec.nome ?? '—',
          unidade: rec.unidade ?? ''
        }
      })

  if (p.modo === 'agregador' && Array.isArray(p.cpus)) {
    return (p.cpus as Record<string, unknown>[]).map((c) => {
      const cpu = (c.cpu as Record<string, unknown>) ?? {}
      return {
        fator: num(c.fator) || 1,
        operacao: (c.operacao as string) === 'multiplicar' ? 'multiplicar' : 'dividir',
        prodDia: num(cpu.producao_diaria_qtde),
        itens: mapItens(c.itens)
      }
    })
  }
  // Legado: 1 CPU única, sem fator.
  const cpu = (p.cpu as Record<string, unknown>) ?? {}
  return [
    {
      fator: 1,
      operacao: 'dividir',
      prodDia: num(cpu.producao_diaria_qtde),
      itens: mapItens(p.itens)
    }
  ]
}

/** Insumo por 1 unidade produzida do serviço (já com fator/operacao aplicados). */
function contribuicoes(u: Unidade): Array<{ diesel: boolean; recurso: string; unidade: string; porUnidServico: number }> {
  const out: Array<{ diesel: boolean; recurso: string; unidade: string; porUnidServico: number }> = []
  for (const it of u.itens) {
    let porUnidCpu = 0
    let diesel = false
    if (it.grupo === 'COMBUSTIVEL') {
      if (!norm(it.nome).includes('diesel')) continue
      porUnidCpu = it.quantidade > 0 && u.prodDia > 0 ? it.quantidade / u.prodDia : 0
      diesel = true
    } else {
      // MATERIAL: usa consumo_material_por_unid quando informado; senão qtd/dia ÷ prod/dia.
      porUnidCpu = it.cmpu != null ? it.cmpu : u.prodDia > 0 ? it.quantidade / u.prodDia : 0
    }
    if (porUnidCpu <= 0) continue
    out.push({
      diesel,
      recurso: it.nome,
      unidade: it.unidade || (diesel ? 'L' : ''),
      porUnidServico: aplicarFator(porUnidCpu, u.fator, u.operacao)
    })
  }
  return out
}

export async function estimarConsumo(
  obraId: string,
  dataInicio: string,
  dataFim: string
): Promise<ConsumoResultado> {
  // 1) produção realizada no período, agrupada pelo SERVIÇO casado. Guarda também o
  //    item_orcamentario_id (para achar o snapshot que alimenta o agrupador).
  const { data: prod } = await supabase
    .from('vw_acompanhamento_producao_enriquecida')
    .select(
      'servico_planejamento_id, item_orcamentario_id, servico_display_nome, qtd, qtd_convertida, servico_unidade'
    )
    .eq('obra_id', obraId)
    .gte('data', dataInicio)
    .lte('data', dataFim)
  const porServico = new Map<
    string | null,
    { nome: string; qtd: number; unidade: string; itemId: string | null }
  >()
  for (const p of prod ?? []) {
    const sid = (p.servico_planejamento_id as string | null) ?? null
    const nome = (p.servico_display_nome as string) || 'Serviço'
    const cur =
      porServico.get(sid) ??
      {
        nome,
        qtd: 0,
        unidade: (p.servico_unidade as string) || '',
        itemId: (p.item_orcamentario_id as string | null) ?? null
      }
    cur.qtd += num(p.qtd_convertida ?? p.qtd)
    if (!cur.itemId && p.item_orcamentario_id) cur.itemId = p.item_orcamentario_id as string
    porServico.set(sid, cur)
  }

  const servicoIds = [...porServico.keys()].filter(Boolean) as string[]

  // 2) PRIMÁRIO — snapshot que alimenta o agrupador do orçamento, por item.
  const unidadesPorServico = new Map<string, Unidade[]>()
  const fontePorServico = new Map<string, 'orcamento' | 'ao_vivo'>()
  const itemIds = [...new Set([...porServico.values()].map((v) => v.itemId).filter(Boolean))] as string[]
  const snapshotPorItem = new Map<string, Unidade[]>()
  if (itemIds.length) {
    const { data: itens } = await supabase
      .from('item_orcamentario')
      .select('id, cpu_snapshot:cpu_snapshot_id(payload)')
      .in('id', itemIds)
    for (const it of itens ?? []) {
      const snap = it.cpu_snapshot as { payload?: unknown } | null
      if (snap?.payload) {
        const u = unidadesDoSnapshot(snap.payload)
        if (u.some((x) => x.itens.length > 0)) snapshotPorItem.set(it.id as string, u)
      }
    }
  }
  for (const [sid, v] of porServico) {
    if (!sid) continue
    const u = v.itemId ? snapshotPorItem.get(v.itemId) : undefined
    if (u) {
      unidadesPorServico.set(sid, u)
      fontePorServico.set(sid, 'orcamento')
    }
  }

  // 3) FALLBACK — composição ao vivo para serviços sem snapshot utilizável.
  const semSnapshot = servicoIds.filter((s) => !unidadesPorServico.has(s))
  if (semSnapshot.length) {
    // 3a) agregador: servico_cpu_link (fator + operacao)
    const linksPorServico = new Map<string, Array<{ cpuId: string; fator: number; operacao: Operacao }>>()
    const cpuIds = new Set<string>()
    const { data: links } = await supabase
      .from('servico_cpu_link')
      .select('servico_id, cpu_id, fator, operacao')
      .in('servico_id', semSnapshot)
    for (const l of links ?? []) {
      const sid = l.servico_id as string
      const arr = linksPorServico.get(sid) ?? []
      arr.push({
        cpuId: l.cpu_id as string,
        fator: num(l.fator) || 1,
        operacao: (l.operacao as string) === 'multiplicar' ? 'multiplicar' : 'dividir'
      })
      linksPorServico.set(sid, arr)
      cpuIds.add(l.cpu_id as string)
    }
    // 3b) legado: serviços ainda sem link → CPU vigente própria
    const semLink = semSnapshot.filter((s) => !linksPorServico.has(s))
    if (semLink.length) {
      const { data: cpusVig } = await supabase
        .from('cpu')
        .select('id, servico_id')
        .eq('obra_id', obraId)
        .eq('is_vigente', true)
        .in('servico_id', semLink)
      for (const c of cpusVig ?? []) {
        linksPorServico.set(c.servico_id as string, [
          { cpuId: c.id as string, fator: 1, operacao: 'dividir' }
        ])
        cpuIds.add(c.id as string)
      }
    }
    // 3c) carrega prodDia + itens das CPUs vivas envolvidas
    const prodDiaPorCpu = new Map<string, number>()
    const itensPorCpu = new Map<string, RawItem[]>()
    if (cpuIds.size) {
      const ids = [...cpuIds]
      const { data: cpus } = await supabase
        .from('cpu')
        .select('id, producao_diaria_qtde')
        .in('id', ids)
      for (const c of cpus ?? []) prodDiaPorCpu.set(c.id as string, num(c.producao_diaria_qtde))
      const { data: cpuItens } = await supabase
        .from('cpu_item')
        .select('cpu_id, grupo, quantidade, consumo_material_por_unid, recurso:recurso_id(nome, unidade)')
        .in('cpu_id', ids)
        .in('grupo', ['MATERIAL', 'COMBUSTIVEL'])
      for (const it of cpuItens ?? []) {
        const rec = (it.recurso as { nome?: string; unidade?: string } | null) ?? {}
        const arr = itensPorCpu.get(it.cpu_id as string) ?? []
        arr.push({
          grupo: it.grupo as string,
          quantidade: num(it.quantidade),
          cmpu: it.consumo_material_por_unid == null ? null : num(it.consumo_material_por_unid),
          nome: rec.nome ?? '—',
          unidade: rec.unidade ?? ''
        })
        itensPorCpu.set(it.cpu_id as string, arr)
      }
    }
    for (const sid of semSnapshot) {
      const links = linksPorServico.get(sid)
      if (!links || !links.length) continue
      const u: Unidade[] = links.map((l) => ({
        fator: l.fator,
        operacao: l.operacao,
        prodDia: prodDiaPorCpu.get(l.cpuId) ?? 0,
        itens: itensPorCpu.get(l.cpuId) ?? []
      }))
      if (u.some((x) => x.itens.length > 0)) {
        unidadesPorServico.set(sid, u)
        fontePorServico.set(sid, 'ao_vivo')
      }
    }
  }

  // 4) cruza produção × composição.
  const matTotal = new Map<string, { recurso: string; unidade: string; qtd: number }>()
  let dieselTotal = 0
  const por_servico: ConsumoResultado['por_servico'] = []
  const semComp = new Set<string>()
  for (const [sid, v] of porServico) {
    const unidades = sid ? unidadesPorServico.get(sid) : undefined
    if (!unidades || !unidades.length) {
      semComp.add(v.nome)
      continue
    }
    const fonte = (sid && fontePorServico.get(sid)) || 'ao_vivo'
    let dieselServ = 0
    const matServ = new Map<string, ConsumoItem>()
    for (const u of unidades) {
      for (const c of contribuicoes(u)) {
        const q = v.qtd * c.porUnidServico
        if (c.diesel) {
          dieselServ += q
        } else {
          const k = `${norm(c.recurso)}|${c.unidade}`
          const cur = matServ.get(k) ?? { recurso: c.recurso, unidade: c.unidade, quantidade_estimada: 0 }
          cur.quantidade_estimada += q
          matServ.set(k, cur)
          const g = matTotal.get(k) ?? { recurso: c.recurso, unidade: c.unidade, qtd: 0 }
          g.qtd += q
          matTotal.set(k, g)
        }
      }
    }
    dieselTotal += dieselServ
    por_servico.push({
      servico: v.nome,
      qtd_realizada: Math.round(v.qtd * 100) / 100,
      unidade: v.unidade,
      diesel_litros: Math.round(dieselServ),
      fonte,
      materiais: [...matServ.values()].map((m) => ({
        recurso: m.recurso,
        unidade: m.unidade,
        quantidade_estimada: Math.round(m.quantidade_estimada * 100) / 100
      }))
    })
  }
  por_servico.sort((a, b) => b.diesel_litros - a.diesel_litros)

  const materiais: ConsumoItem[] = [...matTotal.values()]
    .map((m) => ({ recurso: m.recurso, unidade: m.unidade, quantidade_estimada: Math.round(m.qtd * 100) / 100 }))
    .sort((a, b) => b.quantidade_estimada - a.quantidade_estimada)

  const nota =
    'ESTIMATIVA (não é medição de estoque/abastecimento): consumo por unidade da composição × produção apontada. ' +
    'A composição vem do MESMO snapshot que alimenta o agrupador do orçamento (fonte "orcamento"); ' +
    'quando um serviço não tem snapshot, cai para a composição ao vivo (fonte "ao_vivo"). ' +
    'Serviços em servicos_sem_composicao não têm composição vinculada para estimar — NÃO diga que o serviço não existe, apenas que não há composição para estimar o consumo.'

  return {
    periodo: { inicio: dataInicio, fim: dataFim },
    diesel_litros_estimado: Math.round(dieselTotal),
    materiais,
    por_servico,
    servicos_sem_composicao: [...semComp],
    observacao: nota
  }
}
