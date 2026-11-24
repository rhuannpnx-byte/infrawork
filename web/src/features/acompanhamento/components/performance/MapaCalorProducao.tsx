import { type ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Vazio } from '@/components/ui/estado'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { diasDoMes, mesesDosDias, nomeDoMes } from '@/features/acompanhamento/lib/mapa-calor-mes'

interface Props {
  /** Produção por dia (ISO → qtd) da entidade focada (ou geral). */
  porDia: Map<string, number>
  /** Dias do período (ISO), em ordem. */
  dias: string[]
  unidade: string | null
}

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const dow = (iso: string): number => new Date(iso + 'T00:00:00').getDay()

// Rampa do verde de "realizado" sobre a folha. Até o nível 3 a tinta do texto tem contraste; no nível 4
// (cor cheia) o texto usa a cor da folha. As proporções foram medidas nos dois temas.
const FUNDO = ['bg-bg', 'bg-success/15', 'bg-success/30', 'bg-success/45', 'bg-success']
function nivel(qtd: number, max: number): number {
  if (qtd <= 0) return 0
  const r = qtd / max
  if (r < 0.25) return 1
  if (r < 0.5) return 2
  if (r < 0.75) return 3
  return 4
}

/**
 * Mapa de calor da produção diária: um mês de calendário por tela, navegável quando o período passa de um mês. A
 * cor é relativa ao maior dia do período inteiro, para os meses ficarem comparáveis; o dia do mês que está fora do
 * período aparece apagado.
 */
export function MapaCalorProducao({ porDia, dias, unidade }: Props): ReactNode {
  const meses = useMemo(() => mesesDosDias(dias), [dias])
  // 0 = o mês mais recente do período. O recuo vale para o período em que foi escolhido: mudou o período, volta ao
  // mês mais recente (guardar a chave junto evita mostrar por um instante o mês da escolha anterior).
  const chave = `${dias[0] ?? ''}|${dias.length}`
  const [nav, setNav] = useState({ chave, recuo: 0 })
  const recuo = nav.chave === chave ? nav.recuo : 0
  const setRecuo = (f: (atual: number) => number): void => setNav({ chave, recuo: f(recuo) })

  const maxPeriodo = useMemo(() => {
    let m = 1
    for (const d of dias) {
      const q = porDia.get(d) ?? 0
      if (q > m) m = q
    }
    return m
  }, [porDia, dias])

  const mes = meses[Math.max(0, meses.length - 1 - recuo)] ?? null
  const { celulas, total, diasTrab } = useMemo(() => {
    const noPeriodo = new Set(dias)
    const cels: Array<{ iso: string; qtd: number; fora: boolean } | null> = []
    let t = 0
    let dt = 0
    if (mes) {
      const doMes = diasDoMes(mes)
      for (let i = 0; i < dow(doMes[0]); i++) cels.push(null) // alinha o dia 1 à coluna do dia da semana
      for (const iso of doMes) {
        const fora = !noPeriodo.has(iso)
        const q = fora ? 0 : (porDia.get(iso) ?? 0)
        cels.push({ iso, qtd: q, fora })
        if (q > 0) {
          t += q
          dt++
        }
      }
    }
    return { celulas: cels, total: t, diasTrab: dt }
  }, [dias, mes, porDia])

  if (dias.length === 0 || !mes) {
    return <Vazio>Sem produção no período escolhido.</Vazio>
  }

  const un = unidade ?? ''
  const temAnterior = recuo < meses.length - 1
  const temSeguinte = recuo > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-2 min-h-7">
        <span className="text-sm text-text first-letter:uppercase">{nomeDoMes(mes)}</span>
        {meses.length > 1 ? (
          <div className="flex items-center gap-1">
            <span className="text-sm text-text-muted tabular mr-1">
              {meses.length - recuo} de {meses.length}
            </span>
            <IconButton
              size="sm"
              onClick={() => setRecuo((o) => o + 1)}
              disabled={!temAnterior}
              className="border border-border-strong"
              aria-label="Mês anterior"
              title={temAnterior ? 'Mês anterior' : 'O período escolhido começa neste mês'}
            >
              <ChevronLeft size={14} />
            </IconButton>
            <IconButton
              size="sm"
              onClick={() => setRecuo((o) => Math.max(0, o - 1))}
              disabled={!temSeguinte}
              className="border border-border-strong"
              aria-label="Mês seguinte"
              title={temSeguinte ? 'Mês seguinte' : 'Este já é o último mês do período'}
            >
              <ChevronRight size={14} />
            </IconButton>
          </div>
        ) : null}
      </div>

      <div
        className="grid grid-cols-7 gap-1 mb-1 text-2xs font-semibold text-text-dim text-center"
        aria-hidden
      >
        {WEEK.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celulas.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />
          if (c.fora)
            return (
              <div
                key={i}
                className="rounded-sm aspect-square min-h-9 border border-dashed border-border px-1 py-0.5"
                title={`${c.iso.split('-').reverse().join('/')}: fora do período escolhido`}
              >
                <span className="block text-2xs tabular leading-none text-text-muted">
                  {Number(c.iso.split('-')[2])}
                </span>
              </div>
            )
          const n = nivel(c.qtd, maxPeriodo)
          const tinta = n === 4 ? 'text-bg-panel' : 'text-text'
          return (
            <div
              key={i}
              className={cn(
                'rounded-sm aspect-square min-h-9 flex flex-col justify-between overflow-hidden px-1 py-0.5',
                FUNDO[n]
              )}
              title={`${c.iso.split('-').reverse().join('/')}: ${formatNumber(c.qtd, 1)} ${un}`}
            >
              <span
                className={cn('text-2xs tabular leading-none', n === 0 ? 'text-text-muted' : tinta)}
              >
                {Number(c.iso.split('-')[2])}
              </span>
              {c.qtd > 0 ? (
                <span
                  className={cn('text-xs tabular font-semibold leading-none text-center', tinta)}
                >
                  {formatNumber(c.qtd, 0)}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="pt-3 mt-auto text-sm text-text-muted flex flex-wrap items-center justify-between gap-x-3">
        <span className="tabular">
          {formatNumber(total, 0)} {un} neste mês
        </span>
        <span>{contar(diasTrab, 'dia com produção', 'dias com produção')}</span>
      </div>
    </div>
  )
}
