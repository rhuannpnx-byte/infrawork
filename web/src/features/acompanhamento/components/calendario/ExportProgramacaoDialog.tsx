import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { gerarProgramacaoMensalXlsx } from '@/features/acompanhamento/lib/programacao-mensal-xlsx'
import { contar } from '@/lib/rotulos'
import type { ServicoInfo } from './CalendarioPrevExec'
import { cn } from '@/lib/utils'

export interface MesOpcao {
  ano: number
  mes: number // 0-11
  /** 'YYYY-MM' */
  key: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Meses disponíveis (ordenados asc) derivados dos dados da obra. */
  meses: MesOpcao[]
  /** Índice do mês atualmente exibido no calendário (seleção inicial). */
  mesAtualIdx: number
  servicos: ServicoInfo[]
  /** Map itemId → (iso → { plan, real }). */
  aggByItem: Map<string, Map<string, { plan: number; real: number }>>
  obraNome: string
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
const MES_CURTO = [
  'JAN',
  'FEV',
  'MAR',
  'ABR',
  'MAI',
  'JUN',
  'JUL',
  'AGO',
  'SET',
  'OUT',
  'NOV',
  'DEZ'
]
const MES_CURTO_LC = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez'
]

function isoDia(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}
function trunc2(v: number): number {
  return Math.trunc(v * 100) / 100
}

export function ExportProgramacaoDialog({
  open,
  onOpenChange,
  meses,
  mesAtualIdx,
  servicos,
  aggByItem,
  obraNome
}: Props): ReactNode {
  const lastIdx = Math.max(0, meses.length - 1)
  const inicial = Math.min(Math.max(0, mesAtualIdx), lastIdx)
  const [a, setA] = useState(inicial)
  const [b, setB] = useState(inicial)
  const [exporting, setExporting] = useState(false)

  // Seleção por arraste (estilo Excel): mousedown fixa a âncora, mousemove
  // estende, mouseup encerra. anchorRef guarda o ponto de origem do arraste.
  const [dragging, setDragging] = useState(false)
  const anchorRef = useRef(inicial)

  // Reabriu o modal → reseta a seleção para o mês atual exibido.
  useEffect(() => {
    if (open) {
      setA(inicial)
      setB(inicial)
      anchorRef.current = inicial
      setDragging(false)
    }
  }, [open, inicial])

  // Encerra o arraste mesmo se o mouse soltar fora da régua.
  useEffect(() => {
    if (!dragging) return
    const up = (): void => setDragging(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [dragging])

  const lo = Math.min(a, b)
  const hi = Math.max(a, b)

  const periodoLabel = useMemo(() => {
    if (!meses.length) return ''
    const m0 = meses[lo]
    const m1 = meses[hi]
    if (lo === hi) return `${MESES[m0.mes]} ${m0.ano}`
    return `${MES_CURTO_LC[m0.mes]}/${m0.ano} – ${MES_CURTO_LC[m1.mes]}/${m1.ano}`
  }, [meses, lo, hi])

  const totalDias = useMemo(() => {
    let n = 0
    for (let i = lo; i <= hi; i++) n += new Date(meses[i].ano, meses[i].mes + 1, 0).getDate()
    return n
  }, [meses, lo, hi])

  // Agrupa meses por ano (p/ a faixa de anos alinhada acima dos slots).
  const anoGroups = useMemo(() => {
    const g: Array<{ ano: number; count: number }> = []
    for (const m of meses) {
      const last = g[g.length - 1]
      if (last && last.ano === m.ano) last.count++
      else g.push({ ano: m.ano, count: 1 })
    }
    return g
  }, [meses])

  const iniDrag = (idx: number): void => {
    anchorRef.current = idx
    setA(idx)
    setB(idx)
    setDragging(true)
  }
  const extDrag = (idx: number): void => {
    if (!dragging) return
    setA(anchorRef.current)
    setB(idx)
  }
  // Teclado: Enter ou espaço marca o mês; com Shift, estende a seleção até ele.
  const aoTeclarMes = (e: KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (e.shiftKey) {
      setA(anchorRef.current)
      setB(idx)
    } else {
      anchorRef.current = idx
      setA(idx)
      setB(idx)
    }
  }

  const exportar = async (): Promise<void> => {
    if (!meses.length) return
    setExporting(true)
    try {
      // Monta todos os dias do período [lo..hi].
      const dias: Array<{ dia: number; weekday: string; iso: string }> = []
      for (let i = lo; i <= hi; i++) {
        const { ano, mes } = meses[i]
        const nd = new Date(ano, mes + 1, 0).getDate()
        for (let d = 1; d <= nd; d++) {
          const iso = isoDia(ano, mes, d)
          dias.push({ dia: d, iso, weekday: WEEKDAYS[new Date(ano, mes, d).getDay()] })
        }
      }
      const ord = [...servicos].sort((x, y) =>
        x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true })
      )
      const servicosPayload = ord.map((s) => {
        const dmap = aggByItem.get(s.item_orcamentario_id)
        return {
          nome: s.descricao,
          unidade: s.unidade ?? '',
          prev: dias.map((d) => trunc2(dmap?.get(d.iso)?.plan ?? 0)),
          real: dias.map((d) => trunc2(dmap?.get(d.iso)?.real ?? 0))
        }
      })
      const blob = await gerarProgramacaoMensalXlsx({
        obraNome,
        periodoLabel,
        dias,
        servicos: servicosPayload
      })
      const sufixo =
        lo === hi ? `${MESES[meses[lo].mes]} ${meses[lo].ano}` : periodoLabel.replace(/[\\/]/g, '-')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Programação Mensal - ${obraNome} - ${sufixo}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Programação exportada.')
      onOpenChange(false)
    } catch (e) {
      toast.error(
        `Não foi possível exportar a programação.${e instanceof Error ? ` ${e.message}` : ''}`
      )
    } finally {
      setExporting(false)
    }
  }

  const ATALHO =
    'h-7 px-2.5 rounded border border-border-strong bg-bg-panel text-xs text-text hover:bg-bg-hover hover:border-border-accent transition-colors'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={exporting}>
      <DialogHeader>
        <DialogTitle>Exportar a programação para Excel</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <p className="text-sm text-text-muted">
          Arraste sobre os meses para marcar o período, como ao selecionar colunas numa planilha, ou
          use os atalhos. No teclado, Enter marca o mês e Shift + Enter estende a seleção até ele.
        </p>

        {meses.length === 0 ? (
          <p className="rounded border border-border bg-bg-elevated px-3 py-6 text-sm text-text-muted">
            Esta obra ainda não tem programação para exportar.
          </p>
        ) : (
          <div className="rounded border border-border bg-bg-elevated p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                Meses da obra
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    anchorRef.current = 0
                    setA(0)
                    setB(lastIdx)
                    setDragging(false)
                  }}
                  className={ATALHO}
                >
                  Obra toda
                </button>
                <button
                  type="button"
                  onClick={() => {
                    anchorRef.current = inicial
                    setA(inicial)
                    setB(inicial)
                    setDragging(false)
                  }}
                  className={ATALHO}
                >
                  Mês do calendário
                </button>
              </div>
            </div>

            {/* Faixa de anos alinhada acima dos meses; arrastar sobre os meses marca o período. */}
            <div className="select-none rounded border border-border-strong overflow-x-auto bg-bg-panel">
              <div className="min-w-max">
                <div className="flex border-b border-border">
                  {anoGroups.map((g, i) => (
                    <div
                      key={g.ano}
                      style={{ flex: g.count }}
                      className={cn(
                        'py-1 text-center text-2xs font-semibold tabular text-text-dim',
                        i > 0 && 'border-l border-border-strong'
                      )}
                    >
                      {g.ano}
                    </div>
                  ))}
                </div>

                <div className="flex" role="group" aria-label="Meses a exportar">
                  {meses.map((m, idx) => {
                    const sel = idx >= lo && idx <= hi
                    const primeiroDoAno = idx !== 0 && meses[idx - 1].ano !== m.ano
                    return (
                      <button
                        key={m.key}
                        type="button"
                        aria-pressed={sel}
                        aria-label={`${MESES[m.mes]} de ${m.ano}`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          iniDrag(idx)
                        }}
                        onMouseEnter={() => extDrag(idx)}
                        onKeyDown={(e) => aoTeclarMes(e, idx)}
                        title={`${MESES[m.mes]} de ${m.ano}`}
                        className={cn(
                          'flex-1 min-w-[44px] h-8 flex items-center justify-center text-xs font-semibold cursor-pointer transition-colors',
                          'border-r border-border last:border-r-0',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                          sel
                            ? 'bg-accent text-[color:var(--on-accent)] focus-visible:ring-[color:var(--on-accent)]'
                            : 'text-text-muted hover:bg-bg-hover hover:text-text',
                          primeiroDoAno && 'border-l border-l-border-strong'
                        )}
                      >
                        {MES_CURTO[m.mes]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-text-muted">
              <span>
                Período: <span className="text-text font-semibold">{periodoLabel || '—'}</span>
              </span>
              <span className="tabular">
                {contar(hi - lo + 1, 'mês', 'meses')}, {contar(totalDias, 'dia', 'dias')},{' '}
                {contar(servicos.length, 'serviço', 'serviços')}
              </span>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={exporting}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={exportar}
          disabled={exporting || meses.length === 0}
          title={meses.length === 0 ? 'Não há programação para exportar.' : undefined}
        >
          <FileSpreadsheet size={14} /> {exporting ? 'Exportando…' : 'Exportar para Excel'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
