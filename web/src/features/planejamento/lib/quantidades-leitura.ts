/**
 * O que o banco entrega das quantidades por local e como as telas leem.
 *
 * As quantidades de um local saem de `trecho_quantidades_atual` (a versão atual inteira num JSON) e o resumo da obra
 * de `trechos_quantidades_resumo`. Nenhuma tela lê as tabelas de faixas e valores direto: a API corta toda consulta
 * em 1.000 linhas sem avisar, e um eixo comprido tem milhares de faixas e dezenas de milhares de valores.
 */
import type { ModoQuantidade, TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

/** Resposta de `trecho_quantidades_atual`: a versão atual inteira, em formato compacto. */
export interface QuantidadesAtualBruto {
  versao: {
    id: string
    template_id: string
    numero: number
    is_atual: boolean
    comentario: string | null
    criado_por: string | null
    created_at: string
  }
  modo: ModoQuantidade
  /** Na ordem das colunas; a posição nesta lista é a chave dos valores de cada faixa. */
  colunas: Array<{
    id: string
    item_orcamentario_id: string
    ordem: number
    codigo: string | null
    descricao: string | null
    unidade: string | null
  }>
  /** Uma faixa: [início, fim, rótulo inicial, rótulo final, {posição da coluna: valor}], na ordem do eixo. */
  segmentos: Array<[number, number, string | null, string | null, Record<string, number>]>
}

/** Abre a resposta compacta no formato das telas (valores de cada faixa por id da coluna). */
export function montarTemplate(b: QuantidadesAtualBruto): TrechoQuantidadeVersaoCompleta {
  const colunas = b.colunas.map((c) => ({
    id: c.id,
    versao_id: b.versao.id,
    item_orcamentario_id: c.item_orcamentario_id,
    ordem: c.ordem,
    codigo: c.codigo ?? '',
    nome: c.codigo || c.descricao ? `${c.codigo ?? ''} ${c.descricao ?? ''}`.trim() : '?',
    unidade: c.unidade ?? ''
  }))
  return {
    ...b.versao,
    modo: b.modo,
    colunas,
    segmentos: b.segmentos.map(([inicio, fim, rotuloInicio, rotuloFim, porColuna], ordem) => {
      const valores: Record<string, number> = {}
      for (const k in porColuna) {
        const coluna = colunas[Number(k)]
        if (coluna) valores[coluna.id] = Number(porColuna[k])
      }
      return {
        ordem,
        posicao_inicio_m: Number(inicio),
        posicao_fim_m: Number(fim),
        unidade_inicio_label: rotuloInicio,
        unidade_fim_label: rotuloFim,
        valores
      }
    })
  }
}

/** Uma linha de `trechos_quantidades_resumo`: um local com quantidades. */
export interface ResumoQuantidadesBruto {
  trecho_id: string
  versao_id: string
  numero: number
  faixas: number
  servicos: number
  /** id do serviço → total no local */
  totais: Record<string, number>
}

/** O que a página de Locais mostra de cada local, sem trazer as faixas: versão, contagens e total por serviço. */
export type ResumoQuantidadesLocal = ResumoQuantidadesBruto

/** Resumo da obra por id do local, com os números já como número. */
export function montarResumo(
  linhas: readonly ResumoQuantidadesBruto[] | null | undefined
): Map<string, ResumoQuantidadesLocal> {
  return new Map(
    (linhas ?? []).map((r) => [
      r.trecho_id,
      {
        ...r,
        numero: Number(r.numero),
        faixas: Number(r.faixas),
        servicos: Number(r.servicos),
        totais: Object.fromEntries(Object.entries(r.totais ?? {}).map(([k, v]) => [k, Number(v)]))
      }
    ])
  )
}
