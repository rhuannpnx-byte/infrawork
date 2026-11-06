// Coleta de dados auxiliares para o export .xlsx do Valor Agregado:
//   - memórias de cálculo POR FILHO do agregador (aplica o % diário do
//     agregador sobre a quantidade contratual de cada filho)
//   - fotos do período (baixa os bytes e converte p/ base64 p/ embutir no xlsx)

import { adminApi } from '@/lib/supabase/functions'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { ctxObraTrecho } from '@/features/planejamento/lib/trecho'
import { formatMarcadorCompacto } from '@/lib/format/posicao'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import type { ObraTrecho } from '@/types/gerencial'
import type { EapGrupo, CurvaSDiaRow } from './valor-agregado-calc'
import {
  montarQuadroViagens,
  type OrigemDmt,
  type PontoViagem,
  type QuadroViagens,
  type ViagemExport
} from './qdm-viagens'

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
  /** Material(is) do dia (informados no lançamento: nome + qtd + unidade). */
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
  /** Serviço lançado por viagens: a memória é o quadro de distribuição das viagens. */
  qdm?: QuadroViagens
}

/** Viagens do período e os serviços lançados por viagens (memória em forma de QDM). */
export interface ViagensExport {
  itens: Set<string>
  viagens: ViagemExport[]
  formatarPosicao: (trechoId: string, metros: number) => string
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
  /** Material por id de produção — ver carregarMateriaisProducao. */
  materialPorId: Map<string, string>,
  servicoItemId: string | null,
  de: string,
  ate: string,
  viagens?: ViagensExport
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
  // produção enriquecida + materiais do lançamento (mapa por id de produção).
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
      e = {
        frentes: new Set(),
        equipes: new Set(),
        estacas: new Set(),
        materiais: new Set(),
        obs: new Set()
      }
      mi.set(p.data, e)
    }
    if (p.frente) e.frentes.add(p.frente)
    const eq = p.equipe_display_nome
    if (eq) e.equipes.add(eq)
    const ini = (p.estaca_inicial ?? '').trim()
    const fim = (p.estaca_final ?? '').trim()
    const local = p.trecho_nome
      ? p.trecho_tipo === 'area'
        ? `Área ${p.trecho_nome}`
        : p.trecho_nome
      : ''
    const faixa = p.trecho_tipo === 'area' ? '' : ini && fim ? `${ini} a ${fim}` : ini || fim
    const estaca = [local, faixa].filter(Boolean).join(' ')
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
    const porViagens = viagens?.itens.has(g.id) ?? false
    const producaoPeriodo = [...diaMap.values()].reduce((a, q) => a + q, 0)
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
        dias,
        qdm:
          porViagens && viagens
            ? montarQuadroViagens({
                grupo: g,
                filho: f,
                viagens: viagens.viagens,
                producaoPeriodo,
                formatarPosicao: viagens.formatarPosicao
              })
            : undefined
      })
    }
  }
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/**
 * Mapa id-de-produção → rótulo de material, lido de
 * `acompanhamento_producao_material` (materiais informados no lançamento).
 * Rótulo: "Nome (qtd unidade)"; vários materiais separados por "; ".
 */
export async function carregarMateriaisProducao(
  obraId: string,
  de: string,
  ate: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!SUPABASE_ENABLED || !supabase) return out
  const { data, error } = await supabase
    .from('acompanhamento_producao_material')
    .select(
      'producao_id, nome, quantidade, unidade, producao:acompanhamento_producao!inner(obra_id, data)'
    )
    .eq('producao.obra_id', obraId)
    .gte('producao.data', de)
    .lte('producao.data', ate)
    .limit(20_000)
  if (error || !data) return out
  const rows = data as unknown as Array<{
    producao_id: string
    nome: string
    quantidade: number | null
    unidade: string | null
  }>
  for (const r of rows) {
    const nome = (r.nome ?? '').trim()
    if (!nome) continue
    const qtdNum = r.quantidade == null ? null : Number(r.quantidade)
    const sufixo =
      qtdNum && Number.isFinite(qtdNum) && qtdNum > 0
        ? ` (${qtdNum}${r.unidade ? ' ' + r.unidade : ''})`
        : ''
    const rotulo = `${nome}${sufixo}`
    const prev = out.get(r.producao_id)
    out.set(r.producao_id, prev ? `${prev}; ${rotulo}` : rotulo)
  }
  return out
}

interface ViagemRow {
  id: string
  item_orcamentario_id: string
  data: string
  ficha_id: string
  ordem: number
  quantidade: number | string
  dmt_km: number | string | null
  dmt_calculada_km: number | string | null
  dmt_origem: OrigemDmt | null
  nf_ticket: string | null
  estaca_carga_m: number | string | null
  estaca_descarga_m: number | string | null
  origem_id: string | null
  destino_id: string | null
  origem: { nome: string; trecho_id: string | null } | null
  destino: { nome: string; trecho_id: string | null } | null
  ficha: {
    motorista: string | null
    veiculo: { prefixo: string | null; placa: string | null } | null
    equipe: { nome: string } | null
  } | null
}

const numOuNull = (v: number | string | null | undefined): number | null =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)

/** Viagens do período, os serviços parametrizados por viagens e o formatador de estaca dos locais da obra. */
export async function carregarViagensExport(
  obraId: string,
  de: string,
  ate: string
): Promise<ViagensExport> {
  const vazio: ViagensExport = { itens: new Set(), viagens: [], formatarPosicao: () => '' }
  if (!SUPABASE_ENABLED || !supabase) return vazio
  const { data: params, error: e1 } = await supabase
    .from('servico_parametro')
    .select('item_orcamentario_id')
    .eq('obra_id', obraId)
    .eq('modo_lancamento', 'viagens')
  if (e1) throw e1
  const itens = new Set((params ?? []).map((p) => p.item_orcamentario_id as string))
  if (itens.size === 0) return vazio

  const sb = supabase
  // o PostgREST devolve no máximo 1000 linhas por chamada: pagina
  const carregarViagens = async (): Promise<ViagemRow[]> => {
    const passo = 1000
    const out: ViagemRow[] = []
    for (let ini = 0; ; ini += passo) {
      const { data, error } = await sb
        .from('viagem')
        .select(
          'id, item_orcamentario_id, data, ficha_id, ordem, quantidade, dmt_km, ' +
            'dmt_calculada_km, dmt_origem, nf_ticket, estaca_carga_m, estaca_descarga_m, origem_id, destino_id, ' +
            'origem:transporte_local!viagem_origem_id_fkey(nome, trecho_id), ' +
            'destino:transporte_local!viagem_destino_id_fkey(nome, trecho_id), ' +
            'ficha:viagem_ficha!inner(motorista, veiculo:frota_veiculo(prefixo, placa), equipe:equipe(nome))'
        )
        .eq('obra_id', obraId)
        .gte('data', de)
        .lte('data', ate)
        .order('id')
        .range(ini, ini + passo - 1)
      if (error) throw error
      out.push(...((data ?? []) as unknown as ViagemRow[]))
      if ((data ?? []).length < passo) return out
    }
  }
  const [linhas, trechosRes] = await Promise.all([
    carregarViagens(),
    sb.from('obra_trecho').select('*').eq('obra_id', obraId)
  ])
  if (trechosRes.error) throw trechosRes.error
  const trechos = new Map(
    ((trechosRes.data ?? []) as unknown as ObraTrecho[]).map((t) => [t.id, t])
  )

  const ponto = (trechoId: string | null | undefined, m: number | null): PontoViagem | null => {
    const t = trechoId ? trechos.get(trechoId) : undefined
    return t && m !== null ? { trechoId: t.id, trechoNome: t.nome, m } : null
  }
  const viagens: ViagemExport[] = linhas.map((v) => {
    const vei = v.ficha?.veiculo
    return {
      id: v.id,
      itemId: v.item_orcamentario_id,
      data: v.data,
      fichaId: v.ficha_id,
      ordem: v.ordem,
      veiculo: vei ? [vei.prefixo, vei.placa].filter(Boolean).join(' · ') : '',
      motorista: v.ficha?.motorista ?? '',
      equipe: v.ficha?.equipe?.nome ?? '',
      origemId: v.origem_id,
      origem: v.origem?.nome ?? '—',
      destinoId: v.destino_id,
      destino: v.destino?.nome ?? '—',
      carga: ponto(v.origem?.trecho_id, numOuNull(v.estaca_carga_m)),
      descarga: ponto(v.destino?.trecho_id, numOuNull(v.estaca_descarga_m)),
      quantidade: Number(v.quantidade) || 0,
      dmtKm: numOuNull(v.dmt_km),
      dmtOrigem: v.dmt_origem,
      dmtCalculadaKm: numOuNull(v.dmt_calculada_km),
      nfTicket: v.nf_ticket ?? ''
    }
  })
  return {
    itens,
    viagens,
    formatarPosicao: (trechoId, metros) => {
      const t = trechos.get(trechoId)
      return t ? formatMarcadorCompacto(metros, ctxObraTrecho(t)) : ''
    }
  }
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
          servico: f.servico_display_nome ?? f.servico_nome ?? '',
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
