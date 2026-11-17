import type { Lancamento, TrechoPlano } from './estado'

const SEMANA = 7 * 86_400_000

type Um<T> = T | T[] | null
const um = <T>(v: Um<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

/** Colunas lidas de `planejamento_tarefa_wp` para o 4D. */
export const COLUNAS_WP =
  'tarefa_id, trecho_id, inicio_m, fim_m, quantidade, inicio_em, fim_em, tarefa:tarefa_id(item_orcamentario_id, sentido, nome_custom, codigo_eap)'

export interface LinhaWp {
  tarefa_id: string
  trecho_id: string | null
  inicio_m: number | null
  fim_m: number | null
  quantidade: number | null
  inicio_em: string
  fim_em: string
  tarefa: Um<{
    item_orcamentario_id: string | null
    sentido: string | null
    nome_custom: string | null
    codigo_eap: string | null
  }>
}

export interface LinhaSemana {
  tarefa_id: string
  semana_segunda: string
  quantidade_planejada: number
}

export interface PlanoNoTempo {
  trechos: TrechoPlano[]
  /** Por tarefa: pontos [instante, quantidade acumulada até ele]. */
  perfis: Map<string, [number, number][]>
}

/** Trechos de tarefa do plano com os instantes em ms, e o perfil semanal de cada tarefa como curva acumulada. */
export function montarPlano(wps: LinhaWp[], semanas: LinhaSemana[]): PlanoNoTempo {
  const trechos: TrechoPlano[] = []
  for (const w of wps) {
    const t = um(w.tarefa)
    if (!t?.item_orcamentario_id) continue
    trechos.push({
      tarefa_id: w.tarefa_id,
      item_id: t.item_orcamentario_id,
      trecho_id: w.trecho_id,
      inicio_m: w.inicio_m == null ? null : Number(w.inicio_m),
      fim_m: w.fim_m == null ? null : Number(w.fim_m),
      inicio: new Date(w.inicio_em).getTime(),
      fim: new Date(w.fim_em).getTime(),
      quantidade: Number(w.quantidade ?? 0),
      crescente: t.sentido !== 'decrescente'
    })
  }
  const perfis: PlanoNoTempo['perfis'] = new Map()
  const ordenadas = [...semanas].sort(
    (a, b) =>
      a.tarefa_id.localeCompare(b.tarefa_id) || a.semana_segunda.localeCompare(b.semana_segunda)
  )
  for (const s of ordenadas) {
    const t0 = new Date(`${s.semana_segunda}T00:00:00`).getTime()
    let p = perfis.get(s.tarefa_id)
    if (!p) perfis.set(s.tarefa_id, (p = [[t0, 0]]))
    const antes = p[p.length - 1]
    if (antes[0] < t0) p.push([t0, antes[1]])
    p.push([t0 + SEMANA, p[p.length - 1][1] + Number(s.quantidade_planejada)])
  }
  return { trechos, perfis }
}

export interface LinhaProducao {
  id: string
  data: string
  item_orcamentario_id: string | null
  trecho_id?: string | null
  posicao_inicio_m?: number | null
  posicao_fim_m?: number | null
  qtd?: number | null
  qtd_convertida?: number | null
}

/** Produção lançada (view enriquecida) no formato do motor de estado. */
export function montarLancamentos(producao: LinhaProducao[]): Lancamento[] {
  return producao.flatMap((p) =>
    p.item_orcamentario_id
      ? [
          {
            id: p.id,
            item_id: p.item_orcamentario_id,
            trecho_id: p.trecho_id ?? null,
            inicio_m: p.posicao_inicio_m == null ? null : Number(p.posicao_inicio_m),
            fim_m: p.posicao_fim_m == null ? null : Number(p.posicao_fim_m),
            dia: new Date(`${p.data}T12:00:00`).getTime(),
            quantidade: Number(p.qtd_convertida ?? p.qtd ?? 0)
          }
        ]
      : []
  )
}
