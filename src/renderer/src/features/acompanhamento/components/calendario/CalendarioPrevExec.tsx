import { type ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react'
import type { CurvaSPonto } from '@/types/acompanhamento'
import { ExportProgramacaoDialog, type MesOpcao } from './ExportProgramacaoDialog'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface ServicoInfo {
  item_orcamentario_id: string
  codigo: string
  descricao: string
  unidade: string | null
}

interface Props {
  /** Pontos da curva-S (por item × dia) — planejado_dia/realizado_dia. */
  pontos: CurvaSPonto[]
  /** Lista de serviços do baseline (código/descrição/unidade por item). */
  servicos: ServicoInfo[]
  obraNome: string
  loading?: boolean
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

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
      if (!dias) { dias = new Map(); m.set(p.item_orcamentario_id, dias) }
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
    const ord = [...servicos].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
    return ord.map((s) => {
      const dmap = aggByItem.get(s.item_orcamentario_id)
      const prev = dias.map((d) => dmap?.get(d.iso)?.plan ?? 0)
      const real = dias.map((d) => dmap?.get(d.iso)?.real ?? 0)
      return { servico: s, prev, real, totPrev: prev.reduce((a, b) => a + b, 0), totReal: real.reduce((a, b) => a + b, 0) }
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
    <div className="rounded border border-border bg-bg-panel flex flex-col min-h-0">
      {/* Cabeçalho: navegação de mês + export */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => irMes(-1)}
            className="size-6 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <h3 className="text-sm font-semibold text-text min-w-[140px] text-center">
            {MESES[mes]} {ano}
          </h3>
          <button
            onClick={() => irMes(1)}
            className="size-6 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover"
            aria-label="Próximo mês"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <button
          onClick={() => setExportOpen(true)}
          disabled={servicos.length === 0}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-2xs font-mono text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-50"
        >
          <FileSpreadsheet size={12} /> Exportar Excel
        </button>
      </div>

      {loading ? (
        <div className="px-3 py-16 text-center text-xs font-mono text-text-dim">Carregando programação…</div>
      ) : linhas.length === 0 ? (
        <div className="px-3 py-16 text-center text-xs font-mono text-text-dim">
          Sem serviços no baseline desta obra.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="text-2xs font-mono border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-bg-elevated">
                <th className="sticky left-0 z-30 bg-bg-elevated border border-border px-2 py-1 text-left w-[200px] min-w-[200px] max-w-[200px]">Atividade</th>
                <th className="sticky left-[200px] z-30 bg-bg-elevated border border-border px-1 py-1 text-center w-[48px] min-w-[48px] max-w-[48px]">Unid.</th>
                <th className="sticky left-[248px] z-30 bg-bg-elevated border border-border px-1 py-1 text-center w-[44px] min-w-[44px] max-w-[44px]">P/R</th>
                {dias.map((d) => (
                  <th
                    key={d.iso}
                    className={cn(
                      'border border-border px-1 py-1 text-center min-w-[34px]',
                      d.iso === hojeIso && 'bg-accent-glow text-accent'
                    )}
                  >
                    <div className="tabular-nums">{d.dia}</div>
                    <div className="text-text-dim font-normal">{d.weekday}</div>
                  </th>
                ))}
                <th className="border border-border px-2 py-1 text-center min-w-[60px]">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <LinhaServico key={l.servico.item_orcamentario_id} linha={l} dias={dias} hojeIso={hojeIso} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-border flex items-center gap-4 text-2xs font-mono text-text-dim flex-wrap">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-sky-400/40 border border-sky-400/60" /> Prev (planejado)</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-400/40 border border-emerald-400/60" /> Real (executado)</span>
      </div>

      <ExportProgramacaoDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        meses={meses}
        mesAtualIdx={mesAtualIdx}
        servicos={servicos}
        aggByItem={aggByItem}
        obraNome={obraNome}
      />
    </div>
  )
}

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
      <tr className="bg-sky-500/[0.04]">
        <td
          rowSpan={2}
          className="sticky left-0 z-10 bg-bg-panel border border-border px-2 py-1 align-middle font-semibold text-text w-[200px] min-w-[200px] max-w-[200px]"
        >
          {s.descricao}
        </td>
        <td
          rowSpan={2}
          className="sticky left-[200px] z-10 bg-bg-panel border border-border px-1 py-1 text-center align-middle text-text-dim w-[48px] min-w-[48px] max-w-[48px]"
        >
          {s.unidade ?? ''}
        </td>
        <td className="sticky left-[248px] z-10 bg-bg-panel border border-border px-1 py-1 text-center text-sky-300 font-semibold w-[44px] min-w-[44px] max-w-[44px]">Prev</td>
        {dias.map((d, i) => (
          <td
            key={d.iso}
            className={cn(
              'border border-border px-1 py-1 text-center tabular-nums text-sky-300',
              d.iso === hojeIso && 'bg-accent-glow'
            )}
          >
            {fmtCell(prev[i])}
          </td>
        ))}
        <td className="border border-border px-2 py-1 text-center tabular-nums font-semibold text-sky-300">
          {fmtCell(totPrev)}
        </td>
      </tr>
      <tr className="bg-emerald-500/[0.04]">
        <td className="sticky left-[248px] z-10 bg-bg-panel border border-border px-1 py-1 text-center text-emerald-300 font-semibold w-[44px] min-w-[44px] max-w-[44px]">Real</td>
        {dias.map((d, i) => (
          <td
            key={d.iso}
            className={cn(
              'border border-border px-1 py-1 text-center tabular-nums text-emerald-300',
              d.iso === hojeIso && 'bg-accent-glow'
            )}
          >
            {fmtCell(real[i])}
          </td>
        ))}
        <td className="border border-border px-2 py-1 text-center tabular-nums font-semibold text-emerald-300">
          {fmtCell(totReal)}
        </td>
      </tr>
    </>
  )
}
