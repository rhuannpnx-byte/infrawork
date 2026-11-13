import { type ReactNode, useMemo } from 'react'
import { CurvaS } from '@/components/charts/CurvaS'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import type { CurvaSPonto } from '@/types/acompanhamento'
import { formatNumber } from '@/lib/format'
import { hojeLocalISO } from '@/lib/format/local-date'

interface Props {
  /** Pontos de um serviço só (a soma de serviços de unidades diferentes não tem sentido físico). */
  pontos: CurvaSPonto[]
  unidade?: string | null
  altura?: number
}

interface AggPonto {
  data: string
  planejado_acumulado: number
  /** null depois de hoje (o realizado não se projeta) */
  realizado_acumulado: number | null
}

export function CurvaSAcompanhamento({ pontos, unidade, altura = 280 }: Props): ReactNode {
  const hojeIso = hojeLocalISO()
  const data = useMemo<AggPonto[]>(() => {
    if (!pontos || pontos.length === 0) return []
    // A view emite uma linha por item só nos dias com atividade — então em dias
    // sem atividade de um item (ex.: sábado) ele "some" da soma e o acumulado
    // agregado afunda. Acumulado é função-degrau: forward-fill o último valor
    // conhecido de cada item antes de somar, garantindo monotonia.
    const datas = Array.from(new Set(pontos.map((p) => p.data))).sort((a, b) => a.localeCompare(b))
    // o eixo é por categoria: hoje entra como ponto (para a linha "Hoje" e o fim do realizado)
    if (
      datas.length &&
      hojeIso > datas[0]! &&
      hojeIso < datas[datas.length - 1]! &&
      !datas.includes(hojeIso)
    ) {
      datas.push(hojeIso)
      datas.sort((a, b) => a.localeCompare(b))
    }
    const porItem = new Map<string, Map<string, { plan: number; real: number }>>()
    for (const p of pontos) {
      const k = p.item_orcamentario_id ?? '∅'
      let m = porItem.get(k)
      if (!m) {
        m = new Map()
        porItem.set(k, m)
      }
      m.set(p.data, {
        plan: Number(p.planejado_acumulado ?? 0),
        real: Number(p.realizado_acumulado ?? 0)
      })
    }
    const ultimo = new Map<string, { plan: number; real: number }>()
    return datas.map((d) => {
      let plan = 0
      let real = 0
      for (const [k, serie] of porItem) {
        const v = serie.get(d)
        if (v) ultimo.set(k, v)
        const lv = ultimo.get(k) // 0 antes do 1º registro do item (ainda não iniciado)
        if (lv) {
          plan += lv.plan
          real += lv.real
        }
      }
      return { data: d, planejado_acumulado: plan, realizado_acumulado: d <= hojeIso ? real : null }
    })
  }, [pontos, hojeIso])

  if (data.length === 0) {
    return (
      <ChartEmptyState
        height={altura}
        className="border-0"
        message="A curva S deste serviço ainda não tem pontos"
        hint="Ela aparece quando há linha de base vigente, cronograma calculado e produção lançada."
      />
    )
  }

  const sufixo = unidade ? ` ${unidade}` : ''
  return (
    <CurvaS
      altura={altura}
      pontos={data.map((d) => ({
        data: d.data,
        previsto: d.planejado_acumulado,
        realizado: d.realizado_acumulado
      }))}
      formatar={(v) => `${formatNumber(v, 0)}${sufixo}`}
      formatarEixo={(v) => formatNumber(v, 0)}
    />
  )
}
