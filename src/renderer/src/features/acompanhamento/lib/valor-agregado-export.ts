// Coleta de dados auxiliares para o export .xlsx do Valor Agregado:
//   - memórias de cálculo POR FILHO do agregador (aplica o % diário do
//     agregador sobre a quantidade contratual de cada filho)
//   - fotos do período (baixa os bytes e converte p/ base64 p/ embutir no xlsx)

import { adminApi } from '@/lib/supabase/functions'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import type { EapGrupo, CurvaSDiaRow } from './valor-agregado-calc'

export interface MemoriaDiaExport {
  data: string
  /** Produção do agregador no dia (unidade do agregador). */
  aggQtd: number
  /** % de avanço do agregador no dia (aggQtd / quantidade_referencia). */
  pct: number
  /** Quantidade do filho no dia = pct × quantidade contratual do filho. */
  qtd: number
  /** Valor do dia = qtd × venda unitária do filho. */
  valor: number
  /** Estaca(s) do dia (estaca_inicial/estaca_final da produção). */
  estaca: string
  /** Material(is) do dia (payload_bruto SIGA: nome + qtd + unidade). */
  material: string
  /** Observação(ões) do dia (campo obs da produção). */
  observacao: string
  /** Frentes/equipes do dia (contexto da produção). */
  contexto: string
}

export interface MemoriaServicoExport {
  /** Código do filho (vira o nome da aba). */
  codigo: string
  descricao: string
  unidade: string
  agregadorCodigo: string
  agregadorDescricao: string
  agregadorUnidade: string
  qtdContratual: number
  vendaUnitaria: number
  dias: MemoriaDiaExport[]
}

export interface FotoExportItem {
  base64: string
  extension: 'jpeg' | 'png'
  data: string
  servico: string
  frente: string
  obs: string
}

function nz(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Gera uma memória de cálculo POR FILHO (receita) de cada agregador com
 * produção no período. Para cada dia, o % de avanço do agregador
 * (produção_dia / quantidade_referencia) é aplicado à quantidade contratual
 * do filho. Numericamente consistente com a Medição (mesma fonte: curva-S).
 */
export function montarMemoriasFilhos(
  grupos: EapGrupo[],
  curvaSRows: CurvaSDiaRow[],
  producao: ProducaoEnriquecida[],
  /** Material por id de produção (payload_bruto SIGA) — ver carregarMateriaisProducao. */
  materialPorId: Map<string, string>,
  servicoItemId: string | null,
  de: string,
  ate: string
): MemoriaServicoExport[] {
  // Produção diária do agregador (mesma fonte da Medição) dentro do período.
  const aggDia = new Map<string, Map<string, number>>()
  for (const r of curvaSRows) {
    if (r.data < de || r.data > ate) continue
    const real = nz(r.realizado_dia)
    if (real <= 0) continue
    let m = aggDia.get(r.item_orcamentario_id)
    if (!m) {
      m = new Map()
      aggDia.set(r.item_orcamentario_id, m)
    }
    m.set(r.data, (m.get(r.data) ?? 0) + real)
  }

  // Contexto (frentes/equipes/estaca/material/obs) por item/dia, vindo da
  // produção enriquecida + material do payload_bruto (mapa por id de produção).
  interface CtxDia {
    frentes: Set<string>
    equipes: Set<string>
    estacas: Set<string>
    materiais: Set<string>
    obs: Set<string>
  }
  const ctx = new Map<string, Map<string, CtxDia>>()
  for (const p of producao) {
    const id = p.item_orcamentario_id
    if (!id || !p.data) continue
    if (p.data < de || p.data > ate) continue
    let mi = ctx.get(id)
    if (!mi) {
      mi = new Map()
      ctx.set(id, mi)
    }
    let e = mi.get(p.data)
    if (!e) {
      e = { frentes: new Set(), equipes: new Set(), estacas: new Set(), materiais: new Set(), obs: new Set() }
      mi.set(p.data, e)
    }
    if (p.frente) e.frentes.add(p.frente)
    const eq = p.equipe_display_nome ?? p.siga_equipe_nome
    if (eq) e.equipes.add(eq)
    const ini = (p.estaca_inicial ?? '').trim()
    const fim = (p.estaca_final ?? '').trim()
    const estaca = ini && fim ? `${ini} a ${fim}` : ini || fim
    if (estaca) e.estacas.add(estaca)
    const mat = materialPorId.get(p.id)
    if (mat) e.materiais.add(mat)
    const obs = (p.obs ?? '').trim()
    if (obs) e.obs.add(obs)
  }

  const out: MemoriaServicoExport[] = []
  for (const g of grupos) {
    if (servicoItemId && g.id !== servicoItemId) continue
    const diaMap = aggDia.get(g.id)
    if (!diaMap || diaMap.size === 0 || g.quantidade_referencia <= 0) continue
    const datas = [...diaMap.keys()].sort()
    const ctxItem = ctx.get(g.id)
    for (const f of g.filhos) {
      const dias: MemoriaDiaExport[] = datas.map((data) => {
        const aggQtd = diaMap.get(data) ?? 0
        const pct = aggQtd / g.quantidade_referencia
        const qtd = pct * f.quantidade
        const c = ctxItem?.get(data)
        const contexto = c ? [...c.frentes, ...c.equipes].filter(Boolean).join(', ') : ''
        const estaca = c ? [...c.estacas].filter(Boolean).join('; ') : ''
        const material = c ? [...c.materiais].filter(Boolean).join('; ') : ''
        const observacao = c ? [...c.obs].filter(Boolean).join('; ') : ''
        return {
          data: fmtDataBR(data),
          aggQtd,
          pct,
          qtd,
          valor: qtd * f.venda_unitaria,
          estaca,
          material,
          observacao,
          contexto
        }
      })
      out.push({
        codigo: f.codigo,
        descricao: f.descricao,
        unidade: f.unidade,
        agregadorCodigo: g.codigo,
        agregadorDescricao: g.descricao,
        agregadorUnidade: g.unidade_referencia,
        qtdContratual: f.quantidade,
        vendaUnitaria: f.venda_unitaria,
        dias
      })
    }
  }
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/**
 * Mapa id-de-produção → rótulo de material, lido do `payload_bruto` SIGA da
 * tabela bruta `acompanhamento_producao` (o material não está na view
 * enriquecida). Rótulo: "Nome (qtd unidade)".
 */
export async function carregarMateriaisProducao(
  obraId: string,
  de: string,
  ate: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!SUPABASE_ENABLED || !supabase) return out
  const { data, error } = await supabase
    .from('acompanhamento_producao')
    .select('id, payload_bruto')
    .eq('obra_id', obraId)
    .gte('data', de)
    .lte('data', ate)
    .limit(20_000)
  if (error || !data) return out
  for (const r of data) {
    const pb = (r.payload_bruto ?? {}) as Record<string, unknown>
    const nome = pb.controle_producao_material_nome
    if (nome == null || String(nome).trim() === '') continue
    const qtd = pb.controle_producao_material_qtd
    const un = pb.controle_producao_material_unidade_nome
    const qtdNum = qtd == null ? null : Number(qtd)
    const sufixo =
      qtdNum && Number.isFinite(qtdNum) && qtdNum > 0
        ? ` (${qtdNum}${un ? ' ' + String(un) : ''})`
        : ''
    out.set(r.id as string, `${String(nome).trim()}${sufixo}`)
  }
  return out
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Lista as fotos do período (com URLs assinadas redimensionadas), baixa os
 * bytes e converte para base64 para embutir no relatório fotográfico.
 */
export async function carregarFotosExport(
  obraId: string,
  de: string,
  ate: string,
  maxFotos = 60
): Promise<FotoExportItem[]> {
  const resp = await adminApi.acompanhamentoFotosListar({
    obra_id: obraId,
    filtros: { data_de: de, data_ate: ate },
    page: 0,
    page_size: maxFotos,
    with_urls: true,
    url_transform: { width: 900, quality: 80, resize: 'contain' }
  })
  const urlById = new Map(resp.urls.map((u) => [u.foto_id, u.url]))

  const fotos = await Promise.all(
    resp.fotos.map(async (f): Promise<FotoExportItem | null> => {
      const url = urlById.get(f.id)
      if (!url) return null
      try {
        const r = await fetch(url)
        if (!r.ok) return null
        const buf = await r.arrayBuffer()
        const extension: 'jpeg' | 'png' = f.mime?.includes('png') ? 'png' : 'jpeg'
        return {
          base64: arrayBufferToBase64(buf),
          extension,
          data: f.captured_date ? fmtDataBR(f.captured_date) : '',
          servico: f.servico_display_nome ?? f.siga_servico_nome ?? '',
          frente: f.frente ?? '',
          obs: f.obs ?? ''
        }
      } catch {
        return null
      }
    })
  )
  return fotos.filter((x): x is FotoExportItem => x != null)
}
