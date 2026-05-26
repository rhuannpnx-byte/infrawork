import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DIAS_LABEL,
  bitmaskToDias,
  diasToBitmask,
  isWorkDayByBitmask,
  type ObraCalendario,
  type ObraCalendarioExcecao
} from '@/types/planejamento'
import { fmtDataBR } from '../lib/dates'

interface Props {
  obraId: string
  calendario: ObraCalendario | null
  excecoes: ObraCalendarioExcecao[]
  onChangeBitmask: (b: number) => void
  onAddExcecao: (data: string, motivo: string, ehUtil: boolean) => void
  onRemoveExcecao: (id: string) => void
  readOnly: boolean
}

function buildGridMes(ano: number, mes: number): Date[] {
  // Mes: 0-11
  const primeiro = new Date(Date.UTC(ano, mes, 1))
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
  const dowPrim = primeiro.getUTCDay() // 0=dom
  // Começa do domingo da semana do dia 1
  const inicioGrid = new Date(primeiro)
  inicioGrid.setUTCDate(1 - dowPrim)
  // 42 células (6 semanas × 7)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicioGrid)
    d.setUTCDate(inicioGrid.getUTCDate() + i)
    cells.push(d)
    // Se já passou do último dia E completou a última semana, pode parar
    if (i >= 27 && d.getUTCMonth() !== mes && d.getUTCDate() > 7) {
      if (cells.length % 7 === 0 && d.getUTCDate() > ultimoDia) break
    }
  }
  return cells
}

const NOMES_MES = [
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

export function CalendarioMensalView({
  calendario,
  excecoes,
  onChangeBitmask,
  onAddExcecao,
  onRemoveExcecao,
  readOnly
}: Props): ReactNode {
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())
  const [novaData, setNovaData] = useState('')
  const [novoMotivo, setNovoMotivo] = useState('')
  const [novoEhUtil, setNovoEhUtil] = useState(false)

  const bitmask = calendario?.dias_uteis_bitmask ?? 62
  const diasUteis = bitmaskToDias(bitmask)

  const excecoesPorData = useMemo(() => {
    const m = new Map<string, ObraCalendarioExcecao>()
    for (const e of excecoes) m.set(e.data, e)
    return m
  }, [excecoes])

  const grid = useMemo(() => buildGridMes(ano, mes), [ano, mes])

  const goPrev = (): void => {
    if (mes === 0) {
      setAno((a) => a - 1)
      setMes(11)
    } else setMes((m) => m - 1)
  }
  const goNext = (): void => {
    if (mes === 11) {
      setAno((a) => a + 1)
      setMes(0)
    } else setMes((m) => m + 1)
  }

  const excDoMes = excecoes
    .filter((e) => e.data.slice(0, 7) === `${ano}-${String(mes + 1).padStart(2, '0')}`)
    .sort((a, b) => a.data.localeCompare(b.data))

  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      <div className="col-span-2 rounded border border-border bg-bg-panel">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <IconButton size="sm" aria-label="Mês anterior" onClick={goPrev}>
            <ChevronLeft size={14} />
          </IconButton>
          <div className="text-sm font-semibold text-text font-mono">
            {NOMES_MES[mes]} {ano}
          </div>
          <IconButton size="sm" aria-label="Próximo mês" onClick={goNext}>
            <ChevronRight size={14} />
          </IconButton>
        </div>

        <div className="grid grid-cols-7 gap-px bg-border">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
            <div
              key={d}
              className="bg-bg-panel text-2xs font-mono text-text-dim uppercase py-2 text-center"
            >
              {d}
            </div>
          ))}
          {grid.map((d) => {
            const inMonth = d.getUTCMonth() === mes
            const iso = d.toISOString().slice(0, 10)
            const exc = excecoesPorData.get(iso)
            const ehUtilBase = isWorkDayByBitmask(d, bitmask)
            const efetivamenteUtil = exc !== undefined ? exc.eh_util : ehUtilBase
            const isHoje = iso === hoje.toISOString().slice(0, 10)
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setNovaData(iso)}
                className={cn(
                  'bg-bg-panel py-2 text-center text-xs font-mono relative transition-colors hover:bg-bg-hover',
                  !inMonth && 'opacity-30',
                  isHoje && 'ring-1 ring-amber-400 ring-inset',
                  efetivamenteUtil ? 'text-text' : 'text-text-dim bg-bg/40'
                )}
                title={
                  exc
                    ? `${exc.motivo} (${exc.eh_util ? 'liberado' : 'bloqueado'})`
                    : efetivamenteUtil
                      ? 'Dia útil'
                      : 'Dia não-útil'
                }
              >
                {d.getUTCDate()}
                {exc ? (
                  <span
                    className={cn(
                      'absolute bottom-1 left-1/2 -translate-x-1/2 inline-block w-1 h-1 rounded-full',
                      exc.eh_util ? 'bg-emerald-400' : 'bg-red-400'
                    )}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-border bg-bg-panel p-3">
          <div className="text-2xs font-mono text-text-dim uppercase mb-2">Dias úteis</div>
          <div className="flex flex-wrap gap-1">
            {DIAS_LABEL.map((label, i) => {
              const ativo = diasUteis.includes(i)
              return (
                <button
                  key={label}
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const novo = ativo
                      ? diasUteis.filter((x) => x !== i)
                      : [...diasUteis, i]
                    onChangeBitmask(diasToBitmask(novo))
                  }}
                  className={cn(
                    'px-2 py-1 rounded text-2xs font-mono uppercase border',
                    ativo
                      ? 'border-accent text-accent bg-accent-glow'
                      : 'border-border text-text-dim hover:text-text'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded border border-border bg-bg-panel p-3 space-y-2">
          <div className="text-2xs font-mono text-text-dim uppercase">Nova exceção</div>
          <div>
            <Label htmlFor="exc-data">Data</Label>
            <Input
              id="exc-data"
              type="date"
              value={novaData}
              onChange={(e) => setNovaData(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div>
            <Label htmlFor="exc-motivo">Motivo</Label>
            <Input
              id="exc-motivo"
              value={novoMotivo}
              onChange={(e) => setNovoMotivo(e.target.value)}
              placeholder="Ex.: Feriado, Chuva, Paralisação"
              disabled={readOnly}
            />
          </div>
          <label className="flex items-center gap-2 text-2xs font-mono text-text-muted">
            <input
              type="checkbox"
              checked={novoEhUtil}
              onChange={(e) => setNovoEhUtil(e.target.checked)}
              disabled={readOnly}
            />
            Marcar como útil (liberar fim-de-semana)
          </label>
          <Button
            size="sm"
            variant="default"
            disabled={readOnly || !novaData || !novoMotivo}
            onClick={() => {
              onAddExcecao(novaData, novoMotivo.trim(), novoEhUtil)
              setNovaData('')
              setNovoMotivo('')
              setNovoEhUtil(false)
            }}
          >
            Adicionar
          </Button>
        </div>

        {excDoMes.length > 0 ? (
          <div className="rounded border border-border bg-bg-panel p-3 space-y-1.5">
            <div className="text-2xs font-mono text-text-dim uppercase">Exceções do mês</div>
            {excDoMes.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 text-2xs font-mono px-2 py-1 bg-bg rounded border border-border/50"
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    e.eh_util ? 'bg-emerald-400' : 'bg-red-400'
                  )}
                />
                <span className="text-text-dim">{fmtDataBR(e.data)}</span>
                <span className="flex-1 truncate">{e.motivo}</span>
                {!readOnly ? (
                  <IconButton
                    size="sm"
                    variant="danger"
                    aria-label="Remover exceção"
                    onClick={() => onRemoveExcecao(e.id)}
                  >
                    <X size={10} />
                  </IconButton>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
