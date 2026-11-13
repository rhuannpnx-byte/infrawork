import { type ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react'
import type { CurvaSPonto } from '@/types/acompanhamento'
import { ExportProgramacaoDialog, type MesOpcao } from './ExportProgramacaoDialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Carregando, Vazio } from '@/components/ui/estado'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface ServicoInfo {
  item_orcamentario_id: string
  codigo: string
  descricao: string
  unidade: string | null
}

interface Props {
  /** Pontos da curva S (por item e dia): planejado_dia/realizado_dia. */
  pontos: CurvaSPonto[]
  /** Serviços da linha de base (código, descrição e unidade por item). */
  servicos: ServicoInfo[]
  obraNome: string
  loading?: boolean
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro'
]

const TH =
  'border border-border px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

function isoDia(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Trunca (não arredonda) em no máximo 2 casas decimais. */
function trunc2(v: number): number {
  return Math.trunc(v * 100) / 100
}

function fmtCell(v: number): string {
  if (v <= 0) return ''
  const t = trunc2(v)
  return formatNumber(t, Number.isInteger(t) ? 0 : 2)
}

/**
 * Programação Mensal (modelo Contratada), sem pista/lado: cada serviço distinto
 * em duas linhas — Previsto e Realizado — com uma coluna por dia do mês.
 * Dados vêm da curva-S (planejado_dia/realizado_dia agregados por item × dia).
 */
export function CalendarioPrevExec({ pontos, servicos, obraNome, loading }: Props): ReactNode {
  // Agrega planejado/realizado por (item, dia).
  const aggByItem = useMemo(() => {
    const m = new Map<string, Map<string, { plan: number; real: number }>>()
    for (const p of pontos) {
      if (!p.item_orcamentario_id) continue
      let dias = m.get(p.item_orcamentario_id)
      if (!dias) {
        dias = new Map()
        m.set(p.item_orcamentario_id, dias)
      }
      const cur = dias.get(p.data) ?? { plan: 0, real: 0 }
      cur.plan += Number(p.planejado_dia ?? 0)
      cur.real += Number(p.realizado_dia ?? 0)
      dias.set(p.data, cur)
    }
    return m
  }, [pontos])

  // Sempre abre no mês atual (navegável para frente/trás).
  const hoje = new Date()
  const mesInicial = { ano: hoje.getFullYear(), mes: hoje.getMonth() }

  const [cursor, setCursor] = useState<{ ano: number; mes: number } | null>(null)
  const ano = cursor?.ano ?? mesInicial.ano
  const mes = cursor?.mes ?? mesInicial.mes
  const irMes = (delta: number): void => {
    const d = new Date(ano, mes + delta, 1)
    setCursor({ ano: d.getFullYear(), mes: d.getMonth() })
  }

  // Dias do mês selecionado.
  const dias = useMemo(() => {
    const n = new Date(ano, mes + 1, 0).getDate()
    return Array.from({ length: n }, (_, i) => {
      const dia = i + 1
      const iso = isoDia(ano, mes, dia)
      return { dia, iso, weekday: WEEKDAYS[new Date(ano, mes, dia).getDay()] }
    })
  }, [ano, mes])

  // Serviços ordenados por código, cada um com prev[]/real[] alinhados aos dias.
  const linhas = useMemo(() => {
    const ord = [...servicos].sort((a, b) =>
      a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })
    )
    return ord.map((s) => {
      const dmap = aggByItem.get(s.item_orcamentario_id)
      const prev = dias.map((d) => dmap?.get(d.iso)?.plan ?? 0)
      const real = dias.map((d) => dmap?.get(d.iso)?.real ?? 0)
      return {
        servico: s,
        prev,
        real,
        totPrev: prev.reduce((a, b) => a + b, 0),
        totReal: real.reduce((a, b) => a + b, 0)
      }
    })
  }, [servicos, aggByItem, dias])

  const hojeIso = isoDia(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())

  // Meses disponíveis (do menor ao maior com dados na curva-S) p/ o filtro de export.
  const meses = useMemo<MesOpcao[]>(() => {
    let min = ''
    let max = ''
    for (const p of pontos) {
      if (!min || p.data < min) min = p.data
      if (!max || p.data > max) max = p.data
    }
    if (!min) {
      // Sem dados → oferece ao menos o mês exibido.
      return [{ ano, mes, key: `${ano}-${String(mes + 1).padStart(2, '0')}` }]
    }
    const ini = new Date(Number(min.slice(0, 4)), Number(min.slice(5, 7)) - 1, 1)
    const fim = new Date(Number(max.slice(0, 4)), Number(max.slice(5, 7)) - 1, 1)
    const out: MesOpcao[] = []
    const cur = new Date(ini)
    while (cur <= fim) {
      out.push({
        ano: cur.getFullYear(),
        mes: cur.getMonth(),
        key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
      })
      cur.setMonth(cur.getMonth() + 1)
    }
    return out
  }, [pontos, ano, mes])

  const mesAtualIdx = useMemo(() => {
    const k = `${ano}-${String(mes + 1).padStart(2, '0')}`
    const i = meses.findIndex((m) => m.key === k)
    return i >= 0 ? i : meses.length - 1
  }, [meses, ano, mes])

  const [exportOpen, setExportOpen] = useState(false)

  return (
    <section
      aria-label="Programação do mês"
      className="rounded border border-border bg-bg-panel flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border flex-wrap">
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            onClick={() => irMes(-1)}
            aria-label="Mês anterior"
            title="Mês anterior"
          >
            <ChevronLeft size={16} />
          </IconButton>
          <h2
            className="text-lg font-semibold text-text min-w-[150px] text-center"
            aria-live="polite"
          >
            {MESES[mes]} {ano}
          </h2>
          <IconButton
            size="sm"
            onClick={() => irMes(1)}
            aria-label="Próximo mês"
            title="Próximo mês"
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExportOpen(true)}
          disabled={servicos.length === 0}
          title={
            servicos.length === 0 ? 'Não há serviço na linha de base para exportar.' : undefined
          }
        >
          <FileSpreadsheet size={14} /> Exportar para Excel
        </Button>
      </div>

      {loading ? (
        <Carregando texto="Carregando a programação…" className="px-4" />
      ) : linhas.length === 0 ? (
        <Vazio className="px-4">
          A linha de base desta obra ainda não tem serviços. Trave um plano como linha de base no
          cronograma para ver aqui o previsto e o realizado de cada dia.
        </Vazio>
      ) : (
        <div
          data-density="compact"
          tabIndex={0}
          role="region"
          aria-label={`Previsto e realizado por dia em ${MESES[mes]} de ${ano}`}
          className="overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-bg-elevated">
                <th
                  scope="col"
                  className={cn(
                    TH,
                    'sticky left-0 z-30 bg-bg-elevated text-left w-[220px] min-w-[220px] max-w-[220px]'
                  )}
                >
                  Serviço
                </th>
                <th
                  scope="col"
                  className={cn(
                    TH,
                    'sticky left-[220px] z-30 bg-bg-elevated text-center w-[52px] min-w-[52px] max-w-[52px]'
                  )}
                >
                  Un.
                </th>
                <th
                  scope="col"
                  className={cn(
                    TH,
                    'sticky left-[272px] z-30 bg-bg-elevated text-left w-[80px] min-w-[80px] max-w-[80px]'
                  )}
                >
                  Linha
                </th>
                {dias.map((d) => (
                  <th
                    key={d.iso}
                    scope="col"
                    aria-current={d.iso === hojeIso ? 'date' : undefined}
                    className={cn(
                      'border border-border px-1 py-1 text-center min-w-[38px] font-semibold',
                      d.iso === hojeIso ? 'bg-accent-glow-strong text-accent' : 'text-text'
                    )}
                  >
                    <div className="tabular">{d.dia}</div>
                    <div
                      className={cn(
                        'text-2xs font-normal',
                        d.iso === hojeIso ? 'text-accent' : 'text-text-muted'
                      )}
                    >
                      {d.weekday}
                    </div>
                  </th>
                ))}
                <th scope="col" className={cn(TH, 'text-right min-w-[72px]')}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <LinhaServico
                  key={l.servico.item_orcamentario_id}
                  linha={l}
                  dias={dias}
                  hojeIso={hojeIso}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-4 py-2.5 border-t border-border text-sm text-text-muted">
        Quantidades na unidade de cada serviço. O dia de hoje aparece em destaque.
      </p>

      <ExportProgramacaoDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        meses={meses}
        mesAtualIdx={mesAtualIdx}
        servicos={servicos}
        aggByItem={aggByItem}
        obraNome={obraNome}
      />
    </section>
  )
}

const CELULA_DIA = 'border border-border px-1 py-1 text-center tabular'

function LinhaServico({
  linha,
  dias,
  hojeIso
}: {
  linha: { servico: ServicoInfo; prev: number[]; real: number[]; totPrev: number; totReal: number }
  dias: Array<{ iso: string }>
  hojeIso: string
}): ReactNode {
  const { servico: s, prev, real, totPrev, totReal } = linha
  return (
    <>
      <tr>
        <th
          scope="rowgroup"
          rowSpan={2}
          className="sticky left-0 z-10 bg-bg-panel border border-border px-2 py-1 text-left align-middle font-semibold text-text w-[220px] min-w-[220px] max-w-[220px]"
        >
          {s.descricao}
        </th>
        <td
          rowSpan={2}
          className="sticky left-[220px] z-10 bg-bg-panel border border-border px-1 py-1 text-center align-middle text-text-muted w-[52px] min-w-[52px] max-w-[52px]"
        >
          {s.unidade ?? ''}
        </td>
        <th
          scope="row"
          className="sticky left-[272px] z-10 bg-bg-panel border border-border px-2 py-1 text-left font-semibold text-accent w-[80px] min-w-[80px] max-w-[80px]"
        >
          Previsto
        </th>
        {dias.map((d, i) => (
          <td
            key={d.iso}
            className={cn(
              CELULA_DIA,
              'text-accent',
              d.iso === hojeIso ? 'bg-accent-glow-strong' : 'bg-accent/5'
            )}
          >
            {fmtCell(prev[i])}
          </td>
        ))}
        <td className="border border-border px-2 py-1 text-right tabular font-semibold text-accent bg-accent/5">
          {fmtCell(totPrev)}
        </td>
      </tr>
      <tr>
        <th
          scope="row"
          className="sticky left-[272px] z-10 bg-bg-panel border border-border px-2 py-1 text-left font-semibold text-success w-[80px] min-w-[80px] max-w-[80px]"
        >
          Realizado
        </th>
        {dias.map((d, i) => (
          <td
            key={d.iso}
            className={cn(
              CELULA_DIA,
              'text-success',
              d.iso === hojeIso ? 'bg-accent-glow-strong' : 'bg-success/5'
            )}
          >
            {fmtCell(real[i])}
          </td>
        ))}
        <td className="border border-border px-2 py-1 text-right tabular font-semibold text-success bg-success/5">
          {fmtCell(totReal)}
        </td>
      </tr>
    </>
  )
}
