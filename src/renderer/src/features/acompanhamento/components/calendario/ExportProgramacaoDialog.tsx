import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, CalendarRange } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { gerarProgramacaoMensalXlsx } from '@/features/acompanhamento/lib/programacao-mensal-xlsx'
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
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]
const MES_CURTO = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
const MES_CURTO_LC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

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
      const sufixo = lo === hi ? `${MESES[meses[lo].mes]} ${meses[lo].ano}` : periodoLabel.replace(/[\\/]/g, '-')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Programação Mensal - ${obraNome} - ${sufixo}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Programação exportada.')
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={exporting}>
      <DialogHeader>
        <DialogTitle>Exportar Programação — Previsto × Realizado</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <p className="text-xs text-text-muted">
          Arraste sobre a linha do tempo para marcar o período a exportar — como selecionar
          colunas no Excel. Ou use os atalhos ao lado.
        </p>

        {meses.length === 0 ? (
          <div className="rounded border border-border bg-bg-panel py-8 text-center text-2xs font-mono text-text-dim">
            Sem dados de programação nesta obra.
          </div>
        ) : (
          <div className="rounded-md border border-border bg-bg-elevated/40 p-3.5 space-y-3">
            {/* Cabeçalho da régua */}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-2xs font-mono uppercase tracking-wider text-text-dim">
                <CalendarRange size={12} /> Linha do tempo
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { anchorRef.current = 0; setA(0); setB(lastIdx); setDragging(false) }}
                  className="px-2 py-0.5 rounded border border-border text-2xs font-mono text-text-dim hover:text-text hover:border-border-strong transition-colors"
                >
                  Obra toda
                </button>
                <button
                  type="button"
                  onClick={() => { anchorRef.current = inicial; setA(inicial); setB(inicial); setDragging(false) }}
                  className="px-2 py-0.5 rounded border border-border text-2xs font-mono text-text-dim hover:text-text hover:border-border-strong transition-colors"
                >
                  Mês atual
                </button>
              </div>
            </div>

            {/* Linha do tempo: um único elemento. Faixa de anos alinhada acima dos
                slots; arraste sobre os slots para marcar (a seleção azul é a régua). */}
            <div className="select-none rounded-md border border-border-strong overflow-hidden bg-gradient-to-b from-bg-elevated to-bg-panel shadow-inner">
              {/* Faixa de anos (proporcional à qtde de meses de cada ano) */}
              <div className="flex border-b border-border-strong/70 bg-black/20">
                {anoGroups.map((g, i) => (
                  <div
                    key={g.ano}
                    style={{ flex: g.count }}
                    className={cn(
                      'py-0.5 text-center text-[10px] font-mono tracking-wider text-text-faint',
                      i > 0 && 'border-l border-border-strong/60'
                    )}
                  >
                    {g.ano}
                  </div>
                ))}
              </div>

              {/* Slots metálicos */}
              <div className="flex">
                {meses.map((m, idx) => {
                  const sel = idx >= lo && idx <= hi
                  const isLo = idx === lo
                  const isHi = idx === hi
                  const primeiroDoAno = idx === 0 || meses[idx - 1].ano !== m.ano
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); iniDrag(idx) }}
                      onMouseEnter={() => extDrag(idx)}
                      title={`${MESES[m.mes]} ${m.ano}`}
                      className={cn(
                        'relative flex-1 min-w-[40px] h-7 flex items-center justify-center',
                        'text-sm font-mono font-semibold tracking-wide cursor-pointer transition-all duration-100',
                        'border-r last:border-r-0',
                        sel
                          ? [
                              'text-white border-[oklch(45%_0.15_255)]',
                              'bg-gradient-to-b from-[oklch(72%_0.16_255)] via-[oklch(64%_0.18_255)] to-[oklch(50%_0.17_255)]',
                              'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_3px_rgba(0,0,0,0.35)]',
                              'drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]'
                            ]
                          : [
                              'text-text-muted border-border',
                              'bg-gradient-to-b from-bg-elevated to-[#15181e]',
                              'shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
                              'hover:from-bg-hover hover:to-bg-elevated hover:text-text'
                            ],
                        !sel && primeiroDoAno && idx !== 0 && 'border-l border-l-border-strong/60'
                      )}
                    >
                      {MES_CURTO[m.mes]}
                      {/* Alças metálicas nas extremidades da faixa selecionada */}
                      {sel && isLo && (
                        <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 size-4 rounded-full border border-[oklch(45%_0.15_255)] bg-gradient-to-b from-white to-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.5)] z-10" />
                      )}
                      {sel && isHi && (
                        <span className="absolute -right-1.5 top-1/2 -translate-y-1/2 size-4 rounded-full border border-[oklch(45%_0.15_255)] bg-gradient-to-b from-white to-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.5)] z-10" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Rodapé: período + resumo */}
            <div className="flex items-center justify-between text-2xs font-mono pt-0.5">
              <span className="text-text-dim">
                Período:{' '}
                <span className="text-accent font-semibold">{periodoLabel || '—'}</span>
              </span>
              <span className="text-text-faint">
                {hi - lo + 1} {hi - lo === 0 ? 'mês' : 'meses'} · {totalDias} dias · {servicos.length} serviços
              </span>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={exporting}>
          Cancelar
        </Button>
        <Button type="button" variant="default" onClick={exportar} disabled={exporting || meses.length === 0}>
          <FileSpreadsheet size={12} /> {exporting ? 'Exportando…' : 'Exportar Excel'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
