import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import {
  addDays,
  diffDays,
  fmtDataMonoBR,
  isoDate,
  parseISO,
  startOfMonth,
  startOfNextMonth,
  fmtMesAnoBR
} from '../lib/dates'
import { EquipeChip } from './EquipeChip'

type Escala = 'dia' | 'semana' | 'mes'

interface Props {
  tarefas: PlanejamentoTarefaCompleta[]
  /** ids do caminho crítico (vindos da última execução do calcular-cronograma). */
  caminhoCriticoIds?: string[]
  /** id da tarefa selecionada para destaque + para abrir detail panel. */
  selectedId?: string | null
  onSelect?: (tarefaId: string) => void
  readOnly?: boolean
  dataReferencia?: string | null
}

const COL_ESQ_W = 360

const ESCALA_PX_POR_DIA: Record<Escala, number> = {
  dia: 32,
  semana: 12,
  mes: 4
}

export function GanttChart({
  tarefas,
  caminhoCriticoIds = [],
  selectedId,
  onSelect,
  readOnly = false,
  dataReferencia
}: Props): ReactNode {
  const [escala, setEscala] = useState<Escala>('semana')
  const containerRef = useRef<HTMLDivElement>(null)
  const criticoSet = useMemo(() => new Set(caminhoCriticoIds), [caminhoCriticoIds])

  // Calcula range temporal: min(data_inicio) — max(data_fim), com padding
  const { rangeInicio, rangeFim, totalDias } = useMemo(() => {
    let min: Date | null = null
    let max: Date | null = null
    for (const t of tarefas) {
      if (t.data_inicio) {
        const d = parseISO(t.data_inicio)
        if (!min || d < min) min = d
      }
      if (t.data_fim) {
        const d = parseISO(t.data_fim)
        if (!max || d > max) max = d
      }
    }
    if (dataReferencia) {
      const ref = parseISO(dataReferencia)
      if (!min || ref < min) min = ref
    }
    if (!min) min = new Date()
    if (!max) max = addDays(min, 30)

    // Padding semana antes / depois
    const pad = startOfMonth(addDays(min, -7))
    const padFim = startOfNextMonth(addDays(max, 7))
    return {
      rangeInicio: pad,
      rangeFim: padFim,
      totalDias: diffDays(pad, padFim) + 1
    }
  }, [tarefas, dataReferencia])

  const pxPorDia = ESCALA_PX_POR_DIA[escala]
  const larguraTotal = totalDias * pxPorDia

  // Header de mês + secundário (semana ou dia)
  const headerSegments = useMemo(() => {
    const meses: { left: number; width: number; label: string }[] = []
    let cur = new Date(rangeInicio)
    while (cur < rangeFim) {
      const proxMes = startOfNextMonth(cur)
      const fim = proxMes < rangeFim ? proxMes : rangeFim
      const left = diffDays(rangeInicio, cur) * pxPorDia
      const width = diffDays(cur, fim) * pxPorDia
      meses.push({ left, width, label: fmtMesAnoBR(cur) })
      cur = proxMes
    }
    return { meses }
  }, [rangeInicio, rangeFim, pxPorDia])

  // Virtualização do eixo Y
  const rowVirtualizer = useVirtualizer({
    count: tarefas.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 64,
    overscan: 8
  })

  // Linha "hoje"
  const hojeIso = isoDate(new Date())
  const hojeOffset =
    hojeIso >= isoDate(rangeInicio) && hojeIso <= isoDate(rangeFim)
      ? diffDays(rangeInicio, parseISO(hojeIso)) * pxPorDia
      : null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-bg-panel">
        <div className="flex items-center gap-2 text-2xs font-mono text-text-dim uppercase tracking-wider">
          <span>{tarefas.length} tarefas</span>
          {caminhoCriticoIds.length > 0 ? (
            <span className="text-red-400">· {caminhoCriticoIds.length} crítica(s)</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(['dia', 'semana', 'mes'] as Escala[]).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEscala(e)}
              className={cn(
                'px-2 py-0.5 rounded font-mono uppercase text-2xs border',
                escala === e
                  ? 'border-accent text-accent bg-accent-glow'
                  : 'border-border text-text-dim hover:text-text'
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Lado esquerdo: lista virtualizada de tarefas */}
        <div
          className="border-r border-border bg-bg-panel shrink-0 overflow-y-auto"
          style={{ width: COL_ESQ_W }}
          onScroll={(e) => {
            // sincroniza scroll-vertical com containerRef
            const t = e.currentTarget
            if (containerRef.current && containerRef.current.scrollTop !== t.scrollTop) {
              containerRef.current.scrollTop = t.scrollTop
            }
          }}
        >
          <div className="sticky top-0 z-10 bg-bg-panel border-b border-border h-[44px] flex items-end px-3 pb-1 text-2xs font-mono text-text-dim uppercase">
            Tarefa
          </div>
          <div style={{ height: rowVirtualizer.getTotalSize() }} className="relative">
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const t = tarefas[vi.index]
              const ativo = selectedId === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect?.(t.id)}
                  className={cn(
                    'absolute inset-x-0 px-3 text-left flex flex-col justify-center gap-0.5',
                    'border-b border-border/50 hover:bg-bg-hover',
                    ativo && 'bg-accent-glow'
                  )}
                  style={{ top: vi.start, height: vi.size }}
                >
                  <div className="flex items-center gap-2 text-2xs font-mono text-text-dim">
                    <span>{t.servico_grupo_codigo}</span>
                    {criticoSet.has(t.id) ? (
                      <span className="text-red-400 text-[10px]">CRÍTICA</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-text truncate flex-1">
                      {t.servico_grupo_descricao}
                    </span>
                    {t.duracao_dias_uteis_calc ? (
                      <span className="text-2xs font-mono text-text-dim shrink-0">
                        {Math.ceil(t.duracao_dias_uteis_calc)}d
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-2xs font-mono text-text-dim">
                    {t.producao_diaria_qtde ? (
                      <span>
                        {t.producao_diaria_qtde.toLocaleString('pt-BR')} /
                        {t.producao_diaria_unidade ?? 'dia'}
                      </span>
                    ) : (
                      <span className="text-amber-400">sem CPU</span>
                    )}
                    {t.quantidade_referencia ? (
                      <span>
                        · qtd {t.quantidade_referencia.toLocaleString('pt-BR')}{' '}
                        {t.unidade_servico ?? ''}
                      </span>
                    ) : null}
                  </div>
                  {t.equipes?.length > 0 ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      {t.equipes.slice(0, 3).map((e) => (
                        <EquipeChip
                          key={e.id}
                          nome={e.nome}
                          cor={e.cor}
                          qtd={e.qtd_equipes}
                          size="sm"
                        />
                      ))}
                      {t.equipes.length > 3 ? (
                        <span className="text-2xs text-text-dim font-mono">
                          +{t.equipes.length - 3}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-2xs text-text-dim italic">sem equipe</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Lado direito: timeline */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto relative"
          onScroll={(e) => {
            // sincroniza scroll-vertical com a coluna esquerda
            const parent = e.currentTarget.parentElement
            if (parent) {
              const left = parent.querySelector('.bg-bg-panel.shrink-0') as HTMLElement | null
              if (left && left.scrollTop !== e.currentTarget.scrollTop) {
                left.scrollTop = e.currentTarget.scrollTop
              }
            }
          }}
        >
          {/* Header de tempo (sticky) */}
          <div
            className="sticky top-0 z-10 bg-bg-panel border-b border-border h-[44px]"
            style={{ width: larguraTotal }}
          >
            {headerSegments.meses.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-r border-border flex items-center px-2 text-2xs font-mono text-text-dim uppercase"
                style={{ left: m.left, width: m.width }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {/* Área de barras */}
          <div
            className="relative"
            style={{ height: rowVirtualizer.getTotalSize(), width: larguraTotal }}
          >
            {/* Linha hoje */}
            {hojeOffset !== null ? (
              <div
                className="absolute top-0 bottom-0 w-px bg-amber-400/60 pointer-events-none z-20"
                style={{ left: hojeOffset }}
                title={`Hoje: ${fmtDataMonoBR(hojeIso)}`}
              />
            ) : null}

            {rowVirtualizer.getVirtualItems().map((vi) => {
              const t = tarefas[vi.index]
              if (!t.data_inicio || !t.data_fim) {
                return (
                  <div
                    key={t.id}
                    className="absolute inset-x-0 border-b border-border/30 flex items-center text-2xs font-mono text-text-dim px-3"
                    style={{ top: vi.start, height: vi.size }}
                  >
                    sem datas: atribua equipe + recalcule
                  </div>
                )
              }
              const inicio = parseISO(t.data_inicio)
              const fim = parseISO(t.data_fim)
              const offset = diffDays(rangeInicio, inicio) * pxPorDia
              const largura = Math.max(2, (diffDays(inicio, fim) + 1) * pxPorDia)
              const corBarra = t.equipes?.[0]?.cor ?? '#6b7280'
              const ehCritica = criticoSet.has(t.id)
              const ativo = selectedId === t.id

              return (
                <div
                  key={t.id}
                  className="absolute inset-x-0 border-b border-border/30"
                  style={{ top: vi.start, height: vi.size }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect?.(t.id)}
                    title={`${t.servico_grupo_descricao}\n${fmtDataMonoBR(t.data_inicio)} → ${fmtDataMonoBR(
                      t.data_fim
                    )}\nCusto: ${fmtBRL(t.custo_total_tarefa)}`}
                    disabled={readOnly}
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 rounded h-[20px] flex items-center px-2 text-2xs font-mono',
                      'border transition-all',
                      ativo
                        ? 'ring-1 ring-accent shadow-md'
                        : 'hover:brightness-110',
                      ehCritica ? 'border-red-400/70' : 'border-black/30',
                      t.data_inicio_manual ? 'border-2' : 'border'
                    )}
                    style={{
                      left: offset,
                      width: largura,
                      background: corBarra,
                      color: 'var(--text)'
                    }}
                  >
                    <span className="truncate">
                      {t.servico_grupo_codigo}
                      {t.data_inicio_manual ? ' 📌' : ''}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
